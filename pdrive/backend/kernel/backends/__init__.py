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

"""The filesystem pdrive is looking at: this machine, or one reached over ssh.

A backend owns every byte pdrive reads or writes, and answers in the shapes the
kernel already uses, so nothing above `kernel/fs.py` knows which one is active.
The local backend is the whole of pdrive as it was; the ssh backend is the same
list of operations performed by the remote's own tools, which is what makes the
other machine need no pdrive of its own.
"""

from urllib.parse import unquote
from urllib.parse import urlsplit

from .local import Local


class TargetError(Exception):
    """A target that cannot be opened, said in one sentence for the terminal."""


def from_target(target):
    """The backend for a command-line target.

    ``.``, `/srv`, `C:\\data` are this machine; `ssh://user@host[:port][/path]`
    is another one. Anything else is a typo and refused, rather than quietly
    serving the current directory.
    """
    target = (target or ".").strip()
    if target.startswith("ssh://"):
        # imported here: the ssh backend pulls in subprocess and probes the
        # host, and a local run should not pay for either
        from .ssh import SSH

        parts = urlsplit(target)
        if not parts.hostname:
            raise TargetError("%r names no host to connect to" % target)
        try:
            port = parts.port
        except ValueError:
            raise TargetError("%r has a port that is not a number" % target)
        path = unquote(parts.path or "")
        return SSH(parts.username, parts.hostname, port, path or None)
    if "://" in target:
        raise TargetError("only ssh:// targets are understood, not %r" % target)
    return Local(target)
