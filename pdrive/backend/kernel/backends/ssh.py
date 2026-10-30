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

"""Another machine's filesystem, through its own tools and nothing else.

The remote needs no pdrive, no Python, no agent and no open port: every
operation is a command run over ssh, using `find`, `stat`, `cat`, `cp`, `mv`,
`rm`, `mkdir`, `tail` and `head`. That is what makes `ssh://foo@bar.com` work on
any box the user can already log into.

One `ControlMaster` carries all of them, so the second command onwards costs a
round trip and no handshake. `PDRIVE_SSH` may name a wrapper (`ssh -J bastion`),
the way `GIT_SSH` does, and the destination string is handed to ssh untouched so
`~/.ssh/config`, keys, agent forwarding and 2FA keep working.

`stat` is the one thing that is not portable, so its format is probed once at
connect time - GNU first, then BSD - and the first one that returns the fields
we need is the one used for the life of the process. The record separator comes
from the shell (`printf '\000'`) rather than from `stat`, because only GNU's
`stat` can be asked for a NUL and file names may contain anything else.
"""

import hashlib
import os
import os.path as pth
import shlex
import subprocess
import tempfile

from .. import archive
from ..nodes import node as make_node
from . import TargetError

# The fields of a `stat` line, per flavour. The name is never one of them: it is
# printed by the shell next to the line, so a file called `%s` cannot confuse it.
STAT_FORMATS = (
    ("gnu", ["-L", "-c", "%F %s %Y %W %Z"]),
    ("bsd", ["-L", "-f", "%HT %z %m %B %c"]),
    ("gnu", ["-c", "%F %s %Y %W %Z"]),
    ("bsd", ["-f", "%HT %z %m %B %c"]),
)

# What a `[ -e ]` check is worth against: an archive with more members than
# this is unpacked without asking, because the question would cost a round trip
# per member.
CONFLICT_LIMIT = 300

# Keys of the tools we may need, and the command each answers to.
TOOLS = ("zip", "unzip", "gio", "trash-put")

# One `stat` record: the name on its own, then the fields, both NUL terminated.
# `{opts}` and `{fmt}` are filled in with the stat flavour the host speaks; the
# shell is the source of the NUL, because only GNU's stat can be asked for one.
LIST_SCRIPT = ('for f do printf "%s\\000" "$f"; '
               'stat {opts} "{fmt}" "$f" 2>/dev/null || printf "? 0 0 0 0"; '
               'printf "\\000"; done')

EXISTS_SCRIPT = "for f do if [ -e \"$f\" ]; then printf \"%s\\000\" \"$f\"; fi; done"

TOOLS_SCRIPT = ("for c in %s; do printf \"%%s=\" \"$c\"; command -v \"$c\" || true; "
                "printf \"\\n\"; done" % " ".join(TOOLS))


def _decode(data):
    # names come from another machine's filesystem, so undecodable bytes are
    # carried through rather than turning into an exception in the middle of a
    # listing
    return data.decode("utf-8", "surrogateescape")


def _int(text, default=0):
    try:
        return int(text)
    except (TypeError, ValueError):
        return default


class SSH:
    kind = "ssh"

    def __init__(self, user, host, port, path=None):
        self.user = user
        self.host = host
        self.port = port
        self.dest = "%s@%s" % (user, host) if user else host
        self.transport = self.command_prefix(self.dest, port)
        self.tools = {}
        self.hostname = self.probe_hostname()
        self.root = self.resolve_root(path)
        self.stat_args, self.flavour = self.probe_stat()

    # -----------------------------------------------------------------
    # The connection
    # -----------------------------------------------------------------

    @staticmethod
    def command_prefix(dest, port):
        """The `ssh` argv every command is appended to.

        `ControlMaster` keeps one authenticated connection open for the life of
        the process and answers later commands on it, which is the difference
        between a listing that takes a second and one that takes a millisecond.
        """
        prefix = shlex.split(os.environ.get("PDRIVE_SSH") or "ssh")
        digest = hashlib.sha1(dest.encode("utf-8")).hexdigest()[:12]
        control = pth.join(tempfile.gettempdir(), "pdrive-%s" % digest)
        prefix += [
            "-o", "ControlMaster=auto",
            "-o", "ControlPath=%s" % control,
            "-o", "ControlPersist=2m",
            "-o", "ConnectTimeout=10",
            "-T",
        ]
        if port:
            prefix += ["-p", str(port)]
        prefix.append(dest)
        return prefix

    def run(self, argv, stdin=None, timeout=60, check=False):
        """One command, quoted, on the other machine."""
        command = shlex.join(argv)
        try:
            done = subprocess.run(self.transport + [command],
                                  input=stdin,
                                  stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE,
                                  timeout=timeout)
        except FileNotFoundError:
            raise TargetError("could not run %r: is ssh installed?"
                              % self.transport[0])
        except subprocess.TimeoutExpired:
            raise OSError("timed out running %s on %s" % (argv[0], self.dest))
        done.stdout = _decode(done.stdout)
        done.stderr = _decode(done.stderr)
        if check and done.returncode != 0:
            raise OSError(done.stderr.strip() or done.stdout.strip()
                          or "%s failed on %s" % (argv[0], self.dest))
        return done

    def shell(self, script, timeout=60):
        """One command as written, for the pipes and loops that need a shell."""
        try:
            done = subprocess.run(self.transport + [script],
                                  stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE,
                                  timeout=timeout)
        except subprocess.TimeoutExpired:
            raise OSError("timed out on %s" % self.dest)
        done.stdout = _decode(done.stdout)
        done.stderr = _decode(done.stderr)
        return done

    def popen(self, script):
        return subprocess.Popen(self.transport + [script],
                                stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE)

    # -----------------------------------------------------------------
    # What this host is
    # -----------------------------------------------------------------

    def probe_hostname(self):
        done = self.run(["uname", "-n"], timeout=20)
        if done.returncode != 0:
            raise TargetError("could not connect to %s: %s" % (
                self.dest, done.stderr.strip() or done.stdout.strip()
                or "ssh failed"))
        return done.stdout.strip() or self.host

    def probe_home(self):
        # `ssh host cmd` starts in the login home, but not every transport does
        # (a wrapper, a container): ask for $HOME and fall back to where we are
        done = self.run(["sh", "-c", 'cd "$HOME" 2>/dev/null && pwd -P || pwd -P'],
                        check=True)
        return done.stdout.strip() or "/"

    def resolve_root(self, path):
        """The directory to serve, checked before anything else is asked of it.

        A URL path always starts at `/`, so `ssh://host/var/log` is that absolute
        directory; `ssh://host/~/notes` is the one thing a user will type that
        is not, and ssh is the only side that can expand the tilde.
        """
        if not path:
            return self.checked(self.probe_home())
        if path == "/~" or path.startswith("/~/"):
            # a URL path always starts at `/`, so `~/notes` arrives as `/~/notes`.
            # Expanding it is the remote's business: `cd "$HOME"` and read the
            # shell's own idea of where that is.
            relative = path[2:].lstrip("/")
            done = self.run(["sh", "-c",
                             'cd "$HOME" && printf "%s/%s\\n" "$PWD" "$1"',
                             "sh", relative])
            resolved = done.stdout.strip()
            if done.returncode == 0 and resolved:
                return self.checked(pth.normpath(resolved), "~/%s" % relative)
            raise TargetError("no such directory on %s: ~/%s"
                              % (self.dest, relative))
        return self.checked(path)

    def checked(self, path, shown=None):
        """The path, verified to be a directory, or a sentence saying why not."""
        if self.run(["test", "-d", path]).returncode == 0:
            return path
        if self.run(["test", "-e", path]).returncode == 0:
            raise TargetError("%s on %s is a file, not a directory"
                              % (shown or path, self.dest))
        if shown:
            raise TargetError("no such directory on %s: %s" % (self.dest, shown))
        raise TargetError(
            "no such directory on %s: %s (a path in an ssh:// address is "
            "absolute; start it with ~/ for your home directory)"
            % (self.dest, path))

    def probe_stat(self):
        """Pick the `stat` this host speaks, once."""
        for flavour, args in STAT_FORMATS:
            done = self.run(["stat"] + args + [self.root], timeout=20)
            if done.returncode == 0 and parse_stat(done.stdout) is not None:
                return args, flavour
        raise TargetError(
            "%s has no `stat` pdrive can read (tried GNU and BSD); "
            "needs GNU coreutils, BSD or busybox" % self.dest)

    def probe_tools(self):
        """Which of the optional commands exist, in one round trip."""
        if self.tools:
            return self.tools
        done = self.shell(TOOLS_SCRIPT, timeout=20)
        found = {}
        for line in done.stdout.splitlines():
            name, _, location = line.partition("=")
            found[name] = location.strip() or None
        good = {name: location for name, location in found.items() if name}
        self.tools = good
        return good

    def describe(self):
        return "ssh://%s:%s" % (self.dest, self.root)

    # -----------------------------------------------------------------
    # Reading
    # -----------------------------------------------------------------

    def listing(self, path):
        script = LIST_SCRIPT.format(opts=" ".join(self.stat_args[:-1]),
                                    fmt=self.stat_args[-1])
        command = "find %s -mindepth 1 -maxdepth 1 -exec sh -c %s sh {} +" % (
            shlex.quote(path), shlex.quote(script))
        done = self.shell(command)
        if done.returncode != 0 and not done.stdout:
            # one extra round trip, only on the way out: a directory that is
            # gone and a host that stopped answering both look like a failed
            # `find` from here, and they are not the same answer
            if self.run(["test", "-d", path]).returncode != 0:
                raise FileNotFoundError(
                    "no such directory on %s: %s" % (self.dest, path))
            raise OSError(done.stderr.strip() or "could not list %s" % path)
        nodes = []
        fields = done.stdout.split("\0")
        for name, rest in zip(fields[0::2], fields[1::2]):
            if not name or rest.startswith("?"):
                # an entry that vanished between find and stat, or a broken
                # symlink: the local backend raises on those too, and a whole
                # listing is not worth failing over one
                continue
            parsed = parse_stat(rest)
            if parsed is None:
                continue
            node_type, size, modified, created = parsed
            nodes.append(make_node(pth.normpath(name), created, modified,
                                   node_type, size))
        return {
            "basedir": self.root,
            "cwd": path,
            "hostname": self.hostname,
            "nodes": nodes
        }

    def info(self, path):
        done = self.run(["stat"] + self.stat_args + [path], timeout=20)
        parsed = parse_stat(done.stdout) if done.returncode == 0 else None
        if parsed is None:
            raise FileNotFoundError(
                done.stderr.strip() or "no such file: %s" % path)
        node_type, size, modified, created = parsed
        return {"type": node_type, "size": size,
                "created": created, "modified": modified}

    def node(self, path):
        info = self.info(path)
        return make_node(path, info["created"], info["modified"],
                         info["type"], info["size"])

    def exists(self, path):
        return self.run(["test", "-e", path]).returncode == 0

    def isdir(self, path):
        return self.run(["test", "-d", path]).returncode == 0

    def read(self, path, start=0, length=None):
        """Bytes of a file, and only those bytes: a Range is a remote `tail`."""
        tail = "tail -c +%d -- %s" % (start + 1, shlex.quote(path))
        script = tail if length is None else "%s | head -c %d" % (tail, length)
        process = self.popen(script)

        def chunks():
            try:
                while True:
                    data = process.stdout.read(64 * 1024)
                    if not data:
                        break
                    yield data
            finally:
                if process.poll() is None:
                    process.kill()
                process.stdout.close()
                process.stderr.close()
                process.wait()

        return chunks()

    def write(self, path):
        return Sink(self, path)

    # -----------------------------------------------------------------
    # Changing
    # -----------------------------------------------------------------

    def trash(self, paths):
        found = self.probe_tools()
        if found.get("gio"):
            command = ["gio", "trash"]
        elif found.get("trash-put"):
            command = ["trash-put"]
        else:
            return {
                "trashed": [],
                "failed": [{
                    "path": path,
                    "error": "no trash on %s: install trash-cli or gio, "
                             "or use Delete" % self.hostname,
                } for path in paths],
            }
        trashed = []
        failed = []
        for path in paths:
            done = self.run(command + [path], timeout=120)
            if done.returncode == 0:
                trashed.append(path)
            else:
                failed.append({"path": path,
                               "error": done.stderr.strip() or "trash failed"})
        return {"trashed": trashed, "failed": failed}

    def remove(self, paths):
        deleted = []
        failed = []
        for path in paths:
            done = self.run(["rm", "-rf", path], timeout=120)
            if done.returncode == 0:
                deleted.append(path)
            else:
                failed.append({"path": path,
                               "error": done.stderr.strip() or "rm failed"})
        return {"deleted": deleted, "failed": failed}

    def move(self, paths, destination):
        for path in paths:
            self.run(["mv", path, destination], timeout=600, check=True)

    def copy(self, paths, destination):
        # `cp -R` gives the same result as the local copy_paths for both files
        # and directories, so the argument building stays out of this
        for path in paths:
            self.run(["cp", "-R", path, destination], timeout=3600, check=True)

    def mkdir(self, path):
        self.run(["mkdir", "-p", path], check=True)
        return self.node(path)

    # -----------------------------------------------------------------
    # Archives: the remote's zip, which is the only thing that can write there
    # -----------------------------------------------------------------

    def unique(self, path):
        """``path`` if it is free, else "name 2.ext", ... like the local one."""
        if not self.exists(path):
            return path
        stem, extension = pth.splitext(path)
        counter = 2
        while self.exists("%s %d%s" % (stem, counter, extension)):
            counter += 1
        return "%s %d%s" % (stem, counter, extension)

    def zip(self, payload, progress=None):
        found = self.probe_tools()
        if not found.get("zip"):
            return {"error": "no zip on %s: install zip, or use a local "
                             "directory" % self.hostname}, 501
        paths = [path for path in payload["paths"] if self.exists(path)]
        if not paths:
            return {"error": "nothing to compress"}, 400
        destination = payload.get("destination") or pth.dirname(paths[0])
        target = self.unique(pth.join(
            destination, payload.get("name") or archive.archive_name(paths)))
        # One `cd` per source directory, the names relative to it: that is the
        # entry layout the local backend writes (a file keeps its own name, a
        # folder its own tree). Later calls append to the same archive.
        groups = {}
        for path in paths:
            groups.setdefault(pth.dirname(path), []).append(
                pth.basename(path.rstrip("/")))
        steps = []
        for directory, names in groups.items():
            steps.append("cd %s && zip -r -q %s %s" % (
                shlex.quote(directory), shlex.quote(target),
                " ".join(shlex.quote(name) for name in names)))
        if progress is not None:
            progress(0.05)
        done = self.shell(" && ".join(steps), timeout=3600)
        if done.returncode != 0:
            self.run(["rm", "-f", target], timeout=60)
            return {"error": done.stderr.strip() or "zip failed"}, 500
        if progress is not None:
            progress(1.0)
        data = dict(payload)
        data["archive"] = target
        data["failed"] = []
        data["node"] = self.node(target)
        return data, 200

    def unzip(self, payload, progress=None):
        found = self.probe_tools()
        if not found.get("unzip"):
            return {"error": "no unzip on %s: install unzip" % self.hostname}, 501
        target = payload["path"]
        if not self.exists(target):
            return {"error": "no such file"}, 404
        listing = self.run(["unzip", "-Z1", target], timeout=120)
        if listing.returncode != 0:
            return {"error": "not a zip archive"}, 400
        members = [name for name in listing.stdout.splitlines()
                   if name.strip("/\\")]
        destination = archive.unzip_destination(target, members, self.unique)
        plans = []
        skipped = []
        for member in members:
            target_path = archive.safe_target(destination, member)
            if target_path is None:
                skipped.append(member)
            else:
                plans.append((member, target_path))
        conflicts = self.conflicts([target for _, target in plans])
        if conflicts and not payload.get("overwrite"):
            return {
                "error": "exists",
                "conflicts": conflicts[:20],
                "count": len(conflicts),
            }, 409
        if progress is not None:
            progress(0.05)
        done = self.run(["unzip", "-o", "-q", "-d", destination, target],
                        timeout=3600)
        failed = []
        if done.returncode != 0:
            failed.append({"path": target,
                           "error": done.stderr.strip() or "unzip failed"})
        if progress is not None:
            progress(1.0)
        data = dict(payload)
        data["destination"] = destination
        # the local backend counts files, not the directory entries an archive
        # may also carry
        data["extracted"] = sum(1 for member, _ in plans
                                 if not member.endswith(('/', '\\')))
        data["skipped"] = skipped
        data["failed"] = failed
        return data, 200

    def conflicts(self, paths):
        """Which of these exist, asked of the remote in one round trip."""
        if not paths:
            return []
        sample = paths[:CONFLICT_LIMIT]
        command = "sh -c %s sh %s" % (
            shlex.quote(EXISTS_SCRIPT),
            " ".join(shlex.quote(path) for path in sample))
        done = self.shell(command, timeout=120)
        return [name for name in done.stdout.split("\0") if name]


class Sink:
    """`/upload`'s destination: the stdin of a remote `cat`."""

    def __init__(self, backend, path):
        self.process = backend.popen("exec cat > %s" % shlex.quote(path))

    def write(self, data):
        self.process.stdin.write(data)

    def close(self):
        self.process.stdin.close()
        error = _decode(self.process.stderr.read()).strip()
        code = self.process.wait()
        self.process.stdout.close()
        self.process.stderr.close()
        if code != 0:
            raise OSError(error or "could not write to the remote file")


def parse_stat(text):
    """`(type, size, mtime, birth)` from one `stat` line, or None."""
    fields = text.strip().rsplit(" ", 4)
    if len(fields) != 5:
        return None
    kind, size, modified, born, changed = fields
    kind = kind.strip().lower()
    if "dir" in kind:
        node_type = "dir"
    elif kind in ("?", ""):
        return None
    else:
        node_type = "file"
    # a host that cannot report birth time prints `-` or 0; the inode change
    # time is the same fallback the local backend uses
    created = _int(born) or _int(changed)
    return node_type, _int(size), _int(modified), created
