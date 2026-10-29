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

"""Every change pdrive makes to the filesystem.

Each function takes what the frontend asked for and returns the part of the
answer that is its own work; the caller puts it together with the request it
echoes back. `basedir` and `hostname` live here too: they describe the directory
being served, which is kernel state and not a property of a request.
"""

import os
import os.path as pth
import platform
import shutil

from .nodes import process
from .trash import move_to_trash

basedir = os.path.abspath(os.curdir)
hostname = platform.node()


def list_dir(path):
    """The contents of one directory, as the `/api` listing shape."""
    nodes = [process(pth.join(path, n)) for n in os.listdir(path)]
    return {
        "basedir": basedir,
        "cwd": path,
        "hostname": hostname,
        "nodes": nodes
    }


def trash_paths(paths):
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


def remove_paths(paths):
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


def move_paths(paths, destination):
    for path in paths:
        shutil.move(path, destination)


def copy_paths(paths, destination):
    for path in paths:
        name = os.path.split(path)[1]
        copy = shutil.copytree if os.path.isdir(path) else shutil.copy
        dest = pth.join(destination, name) if os.path.isdir(
            destination) and os.path.isdir(path) else destination
        copy(path, dest)


def make_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)
    return process(path)
