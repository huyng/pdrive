#!/usr/bin/env python
# pdrive - a web based document browser
# Copyright (C) 2017 Huy Nguyen
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""Move files and folders to the trash of the operating system.

Deleting from a file manager should be undoable, so nothing is unlinked here:
every item is handed to the trash the desktop itself uses. One backend per
platform, all of them standard library only:

* macOS - a rename into the trash of the volume the item lives on: ~/.Trash
  for the boot volume, /Volumes/<volume>/.Trashes/<uid> for anything else.
* Windows - SHFileOperationW with FOF_ALLOWUNDO, the call Explorer itself
  makes, so the item lands in the Recycle Bin of its own drive and keeps
  working with "Restore".
* Linux and the BSDs - the freedesktop.org Trash specification that GNOME,
  KDE and XFCE read: a move into $XDG_DATA_HOME/Trash (usually
  ~/.local/share/Trash) plus a .trashinfo record holding the original path.
  Items on another filesystem go to the per user trash at the top of their
  own mount, as the specification asks.
"""

import datetime
import errno
import os
import shutil
import stat
import sys
import urllib.parse


def move_to_trash(path):
    """Move `path` to the trash and return where it ended up.

    The Windows Recycle Bin does not report the name it gave the item, so the
    return value is None there. Raises OSError when the move fails, e.g. when
    the file is gone or the trash folder is not writable.
    """
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.lexists(path):
        raise FileNotFoundError(
            errno.ENOENT, "no such file or directory", path)

    if sys.platform == "darwin":
        return _trash_macos(path)
    if os.name == "nt":
        return _trash_windows(path)
    return _trash_freedesktop(path)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _split_name(name):
    """Split a file name into a stem and an extension, dot files included.

    "notes" -> ("notes", ""), "notes.txt" -> ("notes", ".txt"),
    ".bashrc" -> (".bashrc", "")
    """
    stem, dot, extension = name.rpartition(".")
    if not stem:
        return name, ""
    return stem, dot + extension


def _free_name(directory, name):
    """A variant of `name` that is not taken in `directory` yet.

    Finder's habit is copied here: "report.pdf", "report 2.pdf", ...
    """
    stem, extension = _split_name(name)
    candidate = name
    counter = 1
    while os.path.lexists(os.path.join(directory, candidate)):
        counter += 1
        candidate = "%s %d%s" % (stem, counter, extension)
    return candidate


def _free_trash_name(files_dir, info_dir, name):
    """A name free in both halves of a freedesktop trash, since the item and
    its .trashinfo record have to share it."""
    stem, extension = _split_name(name)
    candidate = name
    counter = 1
    while (os.path.lexists(os.path.join(files_dir, candidate)) or
           os.path.lexists(os.path.join(info_dir, candidate + ".trashinfo"))):
        counter += 1
        candidate = "%s %d%s" % (stem, counter, extension)
    return candidate


def _move_into(directory, path):
    """Move `path` into `directory`, giving it a free name, and return the new
    path. rename() keeps it atomic; a copy is only made when the trash sits on
    another filesystem."""
    name = _free_name(directory, os.path.basename(path.rstrip("/\\")))
    destination = os.path.join(directory, name)
    try:
        os.rename(path, destination)
    except OSError as error:
        if error.errno != errno.EXDEV:
            raise
        shutil.move(path, destination)
    return destination


def _mount_point(path):
    """The top of the filesystem `path` lives on."""
    path = os.path.dirname(os.path.abspath(path))
    while not os.path.ismount(path):
        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent
    return path


def _on_same_device(path, other):
    """True when `path` sits on the same filesystem as `other`, so that it can
    be renamed instead of copied."""
    try:
        return os.stat(path).st_dev == os.stat(other).st_dev
    except OSError:
        return False


def _usable_directory(directory):
    """Create `directory` if needed and report whether it can be written to."""
    try:
        os.makedirs(directory, exist_ok=True)
        return os.access(directory, os.W_OK | os.X_OK)
    except OSError:
        return False


# ---------------------------------------------------------------------------
# macOS
# ---------------------------------------------------------------------------

def _trash_macos(path):
    home = os.path.expanduser("~")
    home_trash = os.path.join(home, ".Trash")

    if _on_same_device(path, home):
        os.makedirs(home_trash, exist_ok=True)
        return _move_into(home_trash, path)

    # another volume: macOS keeps its items in the volume's own trash so that
    # emptying the Trash does not have to copy gigabytes across drives
    volume_trash = os.path.join(
        _mount_point(path), ".Trashes", str(os.getuid()))
    if _usable_directory(volume_trash):
        return _move_into(volume_trash, path)

    # a volume the user cannot write a .Trashes folder into: the home trash is
    # a copy across filesystems, which still beats destroying the item
    os.makedirs(home_trash, exist_ok=True)
    return _move_into(home_trash, path)


# ---------------------------------------------------------------------------
# Windows
# ---------------------------------------------------------------------------

def _trash_windows(path):
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", ctypes.c_uint16),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", ctypes.c_void_p),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    FO_DELETE = 3
    FOF_SILENT = 0x0004
    FOF_NOCONFIRMATION = 0x0010
    FOF_ALLOWUNDO = 0x0040  # the flag that turns a delete into a recycle
    FOF_NOERRORUI = 0x0400
    FOF_NOCONFIRMMKDIR = 0x0200

    # SHFileOperationW only understands the old MAX_PATH (260) interface, so a
    # long path is handed over through its 8.3 short name when it has one
    if len(path) >= 260:
        buffer = ctypes.create_unicode_buffer(260)
        if ctypes.windll.kernel32.GetShortPathNameW(path, buffer, 260):
            path = buffer.value

    operation = SHFILEOPSTRUCTW()
    operation.wFunc = FO_DELETE
    # the source list is NUL terminated, and ctypes adds the second NUL
    operation.pFrom = path + "\0"
    operation.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT |
                        FOF_NOERRORUI | FOF_NOCONFIRMMKDIR)

    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    if result != 0 or operation.fAnyOperationsAborted:
        raise OSError(
            errno.EIO,
            "the Recycle Bin refused the item (SHFileOperationW code %d)"
            % result, path)
    # the Recycle Bin does not tell us the name the item was given
    return None


# ---------------------------------------------------------------------------
# Linux, BSD - freedesktop.org Trash specification
# ---------------------------------------------------------------------------

def _freedesktop_trash_dir(path):
    data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "share")
    home_trash = os.path.join(data_home, "Trash")

    if _on_same_device(path, data_home):
        return home_trash

    # The specification prefers a trash on the item's own mount, and only then
    # a copy into the home trash. ".Trash" is shared between users when it is
    # sticky and owned by root, in which case each user gets a subfolder.
    mount = _mount_point(path)
    shared = os.path.join(mount, ".Trash")
    try:
        info = os.stat(shared)
        shared_ok = (stat.S_ISDIR(info.st_mode) and
                     info.st_uid == 0 and
                     info.st_mode & stat.S_ISVTX)
    except OSError:
        shared_ok = False

    if shared_ok:
        candidate = os.path.join(shared, str(os.getuid()))
    else:
        candidate = os.path.join(mount, ".Trash-%d" % os.getuid())

    if _usable_directory(candidate):
        return candidate
    return home_trash


def _trash_freedesktop(path):
    trash = _freedesktop_trash_dir(path)
    files_dir = os.path.join(trash, "files")
    info_dir = os.path.join(trash, "info")
    os.makedirs(files_dir, exist_ok=True)
    os.makedirs(info_dir, exist_ok=True)

    # written before the move, as the specification requires, so that a crash
    # halfway through leaves a record behind instead of an orphan
    name = _free_trash_name(files_dir, info_dir,
                            os.path.basename(path.rstrip("/\\")))
    record = "[Trash Info]\nPath=%s\nDeletionDate=%s\n" % (
        urllib.parse.quote(path, safe="/"),
        datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    )
    info_path = os.path.join(info_dir, name + ".trashinfo")
    with open(info_path, "w", encoding="utf-8") as handle:
        handle.write(record)

    try:
        destination = os.path.join(files_dir, name)
        try:
            os.rename(path, destination)
        except OSError as error:
            if error.errno != errno.EXDEV:
                raise
            shutil.move(path, destination)
    except OSError:
        # do not leave a .trashinfo pointing at nothing
        try:
            os.unlink(info_path)
        except OSError:
            pass
        raise
    return destination
