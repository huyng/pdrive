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

"""Writing zips out of a selection and unpacking them again.

`safe_target` is the guard that both the unpacking here and the extension
installation of a later phase rely on: a member name is a string from an
archive, and nothing but a check of the resolved path keeps "../.." inside the
tree it belongs to.
"""

import os
import os.path as pth
import shutil
import zipfile

from .nodes import process


def unique_path(path):
    """``path`` if it is free, else "name 2.ext", "name 3.ext", ... (Finder's way)."""
    if not os.path.exists(path):
        return path
    stem, extension = pth.splitext(path)
    counter = 2
    while os.path.exists("%s %d%s" % (stem, counter, extension)):
        counter += 1
    return "%s %d%s" % (stem, counter, extension)


def archive_name(paths):
    """The name the Finder would give the archive of this selection."""
    if len(paths) != 1:
        return "Archive.zip"
    name = pth.basename(paths[0].rstrip("/\\")) or "Archive"
    return name if name.lower().endswith(".zip") else name + ".zip"


def add_to_archive(zf, path, archive):
    """Add ``path`` (a file, or a whole tree) to ``zf``, keeping its own name."""
    if os.path.isdir(path) and not os.path.islink(path):
        base = pth.dirname(path)
        for root, dirs, files in os.walk(path):
            relative = pth.relpath(root, base).replace(os.sep, "/")
            # an empty directory only survives as an entry of its own
            dirs[:] = [name for name in dirs
                       if pth.abspath(pth.join(root, name)) != pth.abspath(archive)]
            if not dirs and not files:
                zf.writestr(relative + "/", "")
            for name in files:
                full = pth.join(root, name)
                # the archive may be written into the tree it is archiving
                if pth.abspath(full) == pth.abspath(archive):
                    continue
                zf.write(full, pth.relpath(full, base).replace(os.sep, "/"))
    else:
        zf.write(path, pth.basename(path))


def safe_target(destination, member):
    """Where a zip member may be written, or None if it points outside.

    Archive entries are plain strings, so "../.." or an absolute path in one
    would otherwise write anywhere on the filesystem.
    """
    if member.startswith(("/", "\\")):
        return None
    components = []
    for component in member.replace("\\", "/").split("/"):
        if component in ("", "."):
            continue
        if component == ".." or ":" in component:
            return None
        components.append(component)
    if not components:
        return None
    root = pth.abspath(destination)
    target = pth.abspath(pth.join(root, *components))
    if target != root and not target.startswith(root + os.sep):
        return None
    return target


def zip_paths(payload):
    """Compress the selection, skipping anything that disappeared meanwhile.

    The archive goes next to the selection under a name that is free, so a
    second compression of the same folder does not overwrite the first.
    """
    paths = [path for path in payload["paths"] if os.path.exists(path)]
    if not paths:
        return {"error": "nothing to compress"}, 400
    destination = payload.get("destination") or pth.dirname(paths[0])
    archive = unique_path(
        pth.join(destination, payload.get("name") or archive_name(paths)))
    failed = []
    try:
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in paths:
                try:
                    add_to_archive(zf, path, archive)
                except OSError as error:
                    failed.append({"path": path, "error": str(error)})
    except OSError as error:
        # a half written archive is worse than none
        if os.path.exists(archive):
            os.unlink(archive)
        return {"error": str(error)}, 500
    data = dict(payload)
    data["archive"] = archive
    data["failed"] = failed
    data["node"] = process(archive)
    return data, 200


def unzip_archive(payload):
    """Unpack next to the archive, refusing to write outside that folder."""
    archive = payload["path"]
    if not os.path.isfile(archive):
        return {"error": "no such file"}, 404
    try:
        zf = zipfile.ZipFile(archive)
    except zipfile.BadZipFile:
        return {"error": "not a zip archive"}, 400
    with zf:
        members = [name for name in zf.namelist() if name.strip("/\\")]
        base = pth.dirname(archive)
        # like the Finder: several items are unpacked into a folder
        # named after the archive, a single one next to it
        tops = set()
        for member in members:
            entry = member.replace("\\", "/").strip("/").split("/")[0]
            if entry:
                tops.add(entry)
        destination = base
        if len(tops) > 1:
            destination = unique_path(pth.join(
                base, pth.splitext(pth.basename(archive))[0]))
        plans = []
        skipped = []
        for member in members:
            target = safe_target(destination, member)
            if target is None:
                skipped.append(member)
            else:
                plans.append((member, target))
        conflicts = [target for _, target in plans if os.path.exists(target)]
        if conflicts and not payload.get("overwrite"):
            # the caller asks the user and comes back with overwrite
            return {
                "error": "exists",
                "conflicts": conflicts[:20],
                "count": len(conflicts),
            }, 409
        failed = []
        extracted = 0
        for member, target in plans:
            try:
                if member.endswith(("/", "\\")) or zf.getinfo(member).is_dir():
                    os.makedirs(target, exist_ok=True)
                    continue
                os.makedirs(pth.dirname(target), exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                extracted += 1
            except (OSError, RuntimeError) as error:
                # RuntimeError is what an encrypted member raises
                failed.append({"path": target, "error": str(error)})
    data = dict(payload)
    data["destination"] = destination
    data["extracted"] = extracted
    data["skipped"] = skipped
    data["failed"] = failed
    return data, 200
