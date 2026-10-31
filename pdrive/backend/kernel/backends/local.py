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

"""The filesystem this process is sitting on.

This is the code pdrive has always run: `os.listdir`, `shutil`, the local trash
implementation, and `zipfile` for archives. It is a backend now only so that the
ssh backend can stand in the same place, and the function bodies are the ones
that were in `fs.py`.
"""

import os
import os.path as pth
import platform
import shutil
import stat

from .. import archive
from ..nodes import process
from ..trash import move_to_trash


class Local:
    kind = "local"

    def __init__(self, root=None):
        self.root = os.path.abspath(root or os.curdir)
        self.hostname = platform.node()

    def describe(self):
        return self.root

    # -----------------------------------------------------------------
    # Reading
    # -----------------------------------------------------------------

    def listing(self, path):
        nodes = []
        for name in os.listdir(path):
            try:
                nodes.append(process(pth.join(path, name)))
            except OSError:
                # an entry `listdir` gave us and `stat` would not: it went away
                # between the two calls, it is a broken symlink, or its name is
                # one this process may not look at. The ssh backend skips those
                # too - a whole directory is not worth failing over one entry it
                # could not read, and the root of a macOS volume carries a
                # `/.VolumeIcon.icns` that is often exactly such an entry.
                continue
        return {
            "basedir": self.root,
            "cwd": path,
            "hostname": self.hostname,
            "nodes": nodes
        }

    def info(self, path):
        statinfo = os.stat(path)
        is_dir = stat.S_ISDIR(statinfo.st_mode)
        created = getattr(statinfo, "st_birthtime", None) or statinfo.st_ctime
        return {
            "type": "dir" if is_dir else "file",
            "size": statinfo.st_size,
            "created": created,
            "modified": statinfo.st_mtime,
        }

    def node(self, path):
        return process(path)

    def exists(self, path):
        return os.path.exists(path)

    def isdir(self, path):
        return os.path.isdir(path)

    def read(self, path, start=0, length=None):
        handle = open(path, "rb")
        if start:
            handle.seek(start)

        def chunks():
            try:
                remaining = length
                while remaining is None or remaining > 0:
                    size = 64 * 1024 if remaining is None else min(64 * 1024, remaining)
                    data = handle.read(size)
                    if not data:
                        break
                    if remaining is not None:
                        remaining -= len(data)
                    yield data
            finally:
                handle.close()

        return chunks()

    def write(self, path):
        return open(path, "wb")

    # -----------------------------------------------------------------
    # Changing
    # -----------------------------------------------------------------

    def trash(self, paths):
        # Deleting is a move to the trash of the host system (the Recycle Bin,
        # ~/.Trash, the freedesktop trash, ...), so an accidental click is always
        # undoable. Every path is reported back: some may have made it while others
        # did not, and the UI says so.
        trashed = []
        failed = []
        for path in paths:
            try:
                trashed.append(move_to_trash(path) or path)
            except OSError as error:
                failed.append({"path": path, "error": str(error)})
        return {"trashed": trashed, "failed": failed}

    def remove(self, paths):
        # Permanent deletion. The UI only sends this after it has asked the user to
        # confirm, because there is nothing to recover from here.
        deleted = []
        failed = []
        for path in paths:
            try:
                if os.path.isdir(path) and not os.path.islink(path):
                    shutil.rmtree(path)
                else:
                    os.unlink(path)
                deleted.append(path)
            except OSError as error:
                failed.append({"path": path, "error": str(error)})
        return {"deleted": deleted, "failed": failed}

    def move(self, paths, destination):
        for path in paths:
            shutil.move(path, destination)

    def copy(self, paths, destination):
        for path in paths:
            name = os.path.split(path)[1]
            copy = shutil.copytree if os.path.isdir(path) else shutil.copy
            dest = pth.join(destination, name) if os.path.isdir(
                destination) and os.path.isdir(path) else destination
            copy(path, dest)

    def mkdir(self, path):
        if not os.path.exists(path):
            os.makedirs(path)
        return process(path)

    # -----------------------------------------------------------------
    # Archives: the Python implementation, which needs nothing installed
    # -----------------------------------------------------------------

    def zip(self, payload, progress=None):
        return archive.zip_paths(payload, progress)

    def unzip(self, payload, progress=None):
        return archive.unzip_archive(payload, progress)
