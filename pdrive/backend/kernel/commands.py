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

"""One entry point for everything the frontend asks the kernel to do.

The answer is the request echoed back with the work's own keys merged in, which
is how the frontend has always read it: a command that reports on paths it was
given can find those paths in the reply. `ls` and `mkdir` answer with what they
produced instead.
"""

from . import fs


def dispatch(payload, progress=None):
    """Run one command. Returns ``(body, http status)``.

    ``progress`` is passed through to the commands that can report it - the two
    archive operations - and called with a fraction between 0 and 1. Everything
    else finishes too quickly for the number to be worth a frame.
    """
    command = payload["command"]

    if command == "trash":
        return {**payload, **fs.trash_paths(payload["paths"])}, 200
    if command == "rm":
        return {**payload, **fs.remove_paths(payload["paths"])}, 200
    if command == "ls":
        return fs.list_dir(payload["path"]), 200
    if command == "mv":
        fs.move_paths(payload["paths"], payload["destination"])
        return payload, 200
    if command == "cp":
        fs.copy_paths(payload["paths"], payload["destination"])
        return payload, 200
    if command == "mkdir":
        return fs.make_dir(payload["path"]), 200
    if command == "zip":
        return fs.zip_paths(payload, progress)
    if command == "unzip":
        return fs.unzip_archive(payload, progress)

    # an unknown command is echoed back untouched, which is what the frontend
    # has always got and what tells it the kernel did not understand it
    return payload, 200
