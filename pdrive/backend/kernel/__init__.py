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

"""The state of a running pdrive, split into the pieces that own it.

Everything the server knows or does lives here rather than in the web layer, so
that what answers a request stays a request-sized thing: `nodes` describe a file
or directory to the UI, `fs` changes the filesystem, `archive` writes and reads
zip files, and `commands` routes a command to one of them. The web layer is a
transport: it parses, calls one of these and serialises the answer.
"""
