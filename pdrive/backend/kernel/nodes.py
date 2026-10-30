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

"""The shape the UI sees a file or directory as.

One builder, `node()`, so that a listing taken from `os.stat` and a listing
taken from a remote `stat` cannot drift apart: a backend hands over the values
it has and gets back the dict the frontend has always read.
"""

import datetime
import mimetypes
import os
import os.path as pth
import stat


def stamp(seconds):
    """The timestamp format of a node: local time, and sortable as a string."""
    return datetime.datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")


def node(path, created, modified, node_type=None, size=0):
    """One entry of a listing.

    ``created`` falls back to the inode change time on platforms that keep no
    birth time, which is the closest thing they have; the caller passes the
    birth time when it has one.
    """
    if node_type is None:
        node_type = "file"
    mimetype = None
    if node_type == "file":
        mimetype = mimetypes.guess_type(path)[0]
    return {
        "name": pth.basename(path.rstrip("/")) or path,
        "path": path,
        "type": node_type,
        "mimetype": mimetype,
        "size": size,
        "ctime": stamp(created),
        "mtime": stamp(modified)
    }


def process(path):
    """`os.stat` on this machine, as a node."""
    statinfo = os.stat(path)
    is_dir = stat.S_ISDIR(statinfo.st_mode)
    # st_birthtime is the real creation time (macOS, Windows, some BSDs).
    created = getattr(statinfo, "st_birthtime", None) or statinfo.st_ctime
    return node(path, created, statinfo.st_mtime,
                "dir" if is_dir else "file", statinfo.st_size)
