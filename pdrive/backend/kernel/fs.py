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

"""Every change pdrive makes to the filesystem, wherever that filesystem is.

The backend decides where the bytes live - `backends/local.py` for this machine,
`backends/ssh.py` for one reached over ssh - and this module is the name the
rest of the kernel calls. Nothing above here knows which one is active, which is
what lets the same UI, the same jobs and the same routes serve a directory that
is on another machine.

`basedir` and `hostname` live here too: they describe the directory being
served, which is kernel state and not a property of a request.
"""

from .backends import from_target

# the directory being served, and the machine it is on. Assigned by
# `set_target`, which the server calls once before it starts answering.
backend = None
basedir = None
hostname = None
kind = None


def set_target(target):
    """Point the kernel at a directory, local or `ssh://user@host[:port][/path]`."""
    global backend, basedir, hostname, kind
    backend = from_target(target)
    basedir = backend.root
    hostname = backend.hostname
    kind = backend.kind
    return backend


def describe():
    """One line for the banner: where these files are."""
    return backend.describe()


def list_dir(path):
    """The contents of one directory, as the `/api` listing shape."""
    return backend.listing(path)


def isdir(path):
    return backend.isdir(path)


def exists(path):
    return backend.exists(path)


def info(path):
    """Type, size and times of one path; raises OSError when there is none."""
    return backend.info(path)


def node(path):
    return backend.node(path)


def read(path, start=0, length=None):
    """Bytes of a file, as an iterator: the response streams them, never holds them."""
    return backend.read(path, start, length)


def write(path):
    """A sink for `path`: `write(bytes)` and `close()`, local or remote."""
    return backend.write(path)


def trash_paths(paths):
    # Deleting is a move to the trash of the host system (the Recycle Bin,
    # ~/.Trash, the freedesktop trash, ...), so an accidental click is always
    # undoable. Every path is reported back: some may have made it while others
    # did not, and the UI says so.
    return backend.trash(paths)


def remove_paths(paths):
    # Permanent deletion. The UI only sends this after it has asked the user to
    # confirm, because there is nothing to recover from here.
    return backend.remove(paths)


def move_paths(paths, destination):
    backend.move(paths, destination)


def copy_paths(paths, destination):
    backend.copy(paths, destination)


def make_dir(path):
    return backend.mkdir(path)


def zip_paths(payload, progress=None):
    return backend.zip(payload, progress)


def unzip_archive(payload, progress=None):
    return backend.unzip(payload, progress)


# A local directory is the default, so that importing this module - in a test,
# or in the server before `main()` has parsed anything - gives the same kernel
# pdrive has always had.
set_target(".")
