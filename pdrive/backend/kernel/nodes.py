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

"""The shape the UI sees a file or directory as."""

import os.path as pth


def process(path):
    import os
    import stat
    import datetime
    import mimetypes

    def timestamp(seconds):
        # local time, and a format that also sorts correctly as a string
        return datetime.datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")

    name = pth.split(path)[1]
    statinfo = os.stat(path)

    if stat.S_ISDIR(statinfo.st_mode):
        node_type = "dir"
    else:
        node_type = "file"

    mimetype = None
    if node_type == "file":
        mimetype, _ = mimetypes.guess_type(path)

    # st_birthtime is the real creation time (macOS, Windows, some BSDs).
    # Platforms without it (Linux) fall back to st_ctime, the last inode
    # change, which is the closest thing they have.
    created = getattr(statinfo, "st_birthtime", None) or statinfo.st_ctime

    return {
        "name": name,
        "path": path,
        "type": node_type,
        "mimetype": mimetype,
        "size": statinfo.st_size,
        "ctime": timestamp(created),
        "mtime": timestamp(statinfo.st_mtime)
    }
