# PLAN_REMOTE.md — serving a directory that lives on another machine

Implementation plan for one feature:

```
pdrive serve ssh://foo@bar.com
```

The server, the UI, the jobs and the WebSocket stay exactly where they are
today: on the machine the user typed the command on. Only the *filesystem*
moves. `bar.com` needs no pdrive, no Python, no agent and no open port — only
`sh`, `stat`, `find`, `cat`, `cp`, `mv`, `rm`, `mkdir`, `tail`, `head` and
`head -c`, which every POSIX box and every busybox box has.

## 1. Goal

`pdrive serve ssh://foo@bar.com` should feel like `pdrive` in a local
directory: the same listing, the same previews, the same upload, rename, trash,
zip, delete, the same banner, the same 127.0.0.1:9999.

Two things follow from that and are not negotiable:

- **The browser never talks to the remote.** There is no tunnel for the page, no
  token on the wire, nothing listening on the remote. The trust model is
  unchanged: whoever reaches 127.0.0.1:9999 gets what `ssh foo@bar.com` gets.
- **No frontend change.** Nodes already carry opaque absolute paths
  (`kernel/nodes.py`), so `/var/log/syslog` is just a string the UI passes back
  to whatever endpoint produced it. `api.js` and every component keep working
  untouched.

## 2. Non-goals

- A server on the remote (`-H 0.0.0.0` + token already covers that).
- `sshfs`/FUSE: needs macFUSE on the client, and an unmounted mount point reads
  as an empty directory, which is data-loss-shaped.
- Windows and other non-POSIX remotes.
- Several ssh targets in one window, cross-host copy, a saved-targets file.
- Authentication: `ssh` does it. pdrive passes the host string through verbatim,
  so `~/.ssh/config`, keys, agent forwarding, `ProxyJump` and 2FA all work for
  free and pdrive never parses an ssh config itself.

## 3. The seam

`kernel/fs.py` stops calling `os.*` and becomes a facade over a backend. The
function names stay, so `commands.py` and `server.py` keep calling the same
things.

```
kernel/backends/__init__.py   from_target("ssh://…") -> Local | SSH   (+ TargetError)
kernel/backends/local.py      today's bodies, moved verbatim from fs.py
kernel/backends/ssh.py        the same interface over one ssh
kernel/fs.py                  facade: dispatch to the active backend
```

Interface:

```python
kind, hostname, root, describe()
listing(path)                  -> {basedir, cwd, hostname, nodes}
info(path)                     -> {type, size, created, modified}   raises OSError
node(path)                     -> the UI's node dict               raises OSError
isdir(path) / exists(path)     -> bool
read(path, start, length)      -> iterator of bytes, for /serve and /download
write(path)                    -> sink with write()/close(), for /upload
mkdir(path) / move(paths, d) / copy(paths, d)
trash(paths) / remove(paths)   -> {…, failed}
zip(payload, progress) / unzip(payload, progress)   -> (body, status)
```

## 4. Each operation, as a command

| op | local | ssh |
| --- | --- | --- |
| `listing` | `os.listdir` + `os.stat` | one `find … -exec sh -c '…stat…' {} +` |
| `info`/`node` | `os.stat` | one `stat` |
| `mkdir` | `os.makedirs` | `mkdir -p` |
| `move` | `shutil.move` | `mv` |
| `copy` | `copytree`/`copy` | `cp -R` |
| `remove` | `rmtree`/`unlink` | `rm -rf` |
| `trash` | `kernel/trash.py` | `gio trash`, else `trash-put`, else a per-path error |
| `read` | `open` + `seek` | `tail -c +N \| head -c M` |
| `write` | `open(…, "wb")` | stdin of `cat > path` |
| `zip`/`unzip` | `zipfile` | `zip -r` / `unzip -Z1` + `unzip -o` |
| `hostname` | `platform.node()` | `uname -n` |

### 4.1 Listing

The node shape needs name, type, size, birth and mtime, and names may contain
anything. `ls -l` parsing is out. `stat`'s own `\0` escape is GNU-only, and BSD
`stat` has no NUL field at all, so the record separator comes from the shell,
which always has one:

```
find <dir> -mindepth 1 -maxdepth 1 -exec sh -c '
  for f do
    printf "%s\000" "$f"
    stat -L -c "%F %s %Y %W %Z" "$f" 2>/dev/null || printf "? 0 0 0 0"
    printf "\000"
  done' sh {} +
```

Records alternate name / fields; the name never goes through `stat`'s format, so
quotes, spaces, newlines and `%` in a file name cannot break the parse. The
format is probed once at connect (`stat -L -c` GNU, `stat -L -f` BSD, then the
same without `-L`) and the first one that returns the expected fields wins. A
host whose `stat` matches none of them fails at start-up with one sentence
instead of showing a wrong listing. `mimetype` is guessed locally from the name,
as today; timestamps are formatted by `nodes.stamp`, as today.

### 4.2 Streaming

`/serve` and `/download` stop returning `FileResponse` and stream from
`fs.read(path, start, length)`, so Range works for both backends. That is what
keeps the text preview (`api.js` sends `Range: bytes=0-2097151`, reads
`Content-Range`) and audio/video seeking working over ssh, and it is one code
path instead of two. A range on an empty file still answers 416, which the
preview relies on.

Uploads stream too: `save_upload` already reads 1 MB at a time, and the ssh sink
is the stdin pipe of `cat > path`. Nothing whole-file is ever held in memory,
and the existing per-chunk `jobs.advance` progress keeps working because it
counts request bytes, not writes.

### 4.3 Connection

One `ControlMaster`, everything else rides it:

```
ssh -o ControlMaster=auto -o ControlPath=$TMPDIR/pdrive-<hash>
    -o ControlPersist=2m -o ConnectTimeout=10 -T [user@]host <command>
```

So each operation is one `subprocess` at ~1 RTT, there is no protocol framing to
write, and `PDRIVE_SSH` may name a wrapper (`PDRIVE_SSH="ssh -J bastion"`)
the way `GIT_SSH` does. If the connection drops, that one command fails with
ssh's own message and the next one reconnects; the page stays up because the
WebSocket is local.

### 4.4 What degrades, and says so

- **trash**: no `gio` and no `trash-put` means the trash action reports
  "no trash on this host … use Delete" per path. `fs.trash_paths` already
  returns per-path failures and the UI already renders them; permanent delete
  already exists behind a confirmation.
- **zip/unzip**: no `zip`/`unzip` binaries (or no `unzip -Z1`) means the job
  fails with that sentence. This is the honest ceiling of "no agent".
- **zip progress** is start/finish only: the remote binary does not report
  entries, and polling `du` would cost more than the bar is worth.
- **symlinks in zip** are followed by `zip` where `zipfile` stores the target;
  and `cp -R` is not `copytree`. Documented, not chased.

## 5. CLI

```
pdrive                          serve cwd (unchanged)
pdrive serve                    same
pdrive serve /srv               serve a local directory
pdrive serve ssh://foo@bar.com          foo's home on bar.com
pdrive serve ssh://foo@bar.com/var/log  /var/log on bar.com
pdrive serve ssh://foo@bar.com/~/notes  ~/notes on bar.com
pdrive serve ssh://foo@bar.com:2222/srv a non-default ssh port
```

A path in an address is absolute, because a URL path always starts at `/`;
`~/` is the one exception a user will type, and the remote shell expands it.
The directory is checked (`test -d`) before anything else is asked of it, so a
typo is one sentence at start-up and not an empty page.

The word `serve` is stripped from argv, so `pdrive ssh://…` works as
sugar (a local path cannot contain `://`). `-H`/`-p` are unchanged, and the
banner gains the target: `Serving ssh://foo@bar.com/var/log — bar.com`.

## 6. Phases

Each phase keeps the tree runnable, one commit, `dist/` untouched (no frontend
change), `version` bumped where behaviour changes.

**P1 — the seam, local only.** `backends/local.py`, `fs.py` facade,
`read`/`write`/`info` used by `/serve`, `/download`, `/upload`, `--root`-ish
positional target.
*Accept:* the whole existing checklist (list, expand, preview text/image/video,
download, upload with progress, rename, copy, new folder, trash, zip, unzip)
passes unchanged on a local directory, and `pdrive serve /tmp` serves `/tmp`.

**P2 — read-only ssh.** `backends/ssh.py` with `listing`, `info`, `node`,
`read`, `hostname`, the stat probe, URL parsing, banner.
*Accept:* `pdrive serve ssh://foo@bar.com` lists the same entries as `ssh
foo@bar.com ls -la ~` with the same sizes and times; expand a folder in place;
text preview of a 500 MB log returns 2 MB; image preview, download, video seek;
names with spaces/quotes/`#`/`?`/unicode; a Linux host and a macOS host both
work; `ssh foo@bar.com which pdrive` prints nothing.

**P3 — writes.** `mkdir`, `move`, `copy`, `remove`, `trash` (+ fallback),
`write`, `zip`/`unzip` (+ probes), over the same probe cache.
*Accept:* upload with a live progress bar, rename, drag-move, new folder, zip a
folder, trash a file (or the fallback message), permanent delete — each verified
by a second `ssh … ls` while the UI is still open.

## 7. Risks

| risk | answer |
| --- | --- |
| a host whose `stat` matches no format | refuse at start-up with one sentence |
| names with newlines on BSD `stat` | NUL separators come from the shell, so they survive |
| `find` without `-mindepth` (Solaris/AIX) | documented requirement: GNU/BSD/busybox `find` |
| a login shell that is not POSIX (`csh`) | quoted commands are still fine; `find -exec sh -c` is not the login shell |
| one ssh round trip per operation | `ControlMaster`, so ~1 RTT; listing is one call |
| big uploads over a slow link | already chunked and progress-reporting; no buffering added |
| a dropped connection | the command fails with ssh's message; the next one reconnects; the page never disconnects |

## 8. Status

P1, P2 and P3 are implemented: `kernel/backends/{local,ssh}.py`, the `fs.py`
seam, streamed `/serve`/`/download` with Range, sink-based `/upload`, and the
`serve [target]` command line. No frontend file changed, so `dist/` is the same
bundle as before.

Known differences from the local backend, all deliberate:

- `zip` stores directory entries (`subtree/`, `subtree/deep/`) where `zipfile`
  stores only files and empty directories. Extraction is unaffected.
- `cp` is `cp -R`, not `shutil.copytree`: hardlinks and symlinks come across as
  `cp -R` copies them.
- archive progress is start/finish only; the remote binary reports no entries.
- a location without `gio`/`trash-put` has no trash, and the UI says so per file.

## 9. Verification recipe (no ssh host needed)

Both backends were exercised against a wrapper that runs the command locally,
which is what `PDRIVE_SSH` exists for:

```sh
# a macOS host (BSD stat, BSD-favoured userland)
cat > /tmp/fakessh <<'EOF'
#!/bin/sh
while [ $# -gt 1 ]; do shift; done
exec sh -c "$1"
EOF
chmod +x /tmp/fakessh

# a GNU host, without turning on sshd anywhere
docker run -d --name pdrive-gnu debian:stable sleep infinity
docker exec pdrive-gnu sh -c 'apt-get update && apt-get install -y zip unzip'
cat > /tmp/docker-ssh <<'EOF'
#!/bin/sh
while [ $# -gt 1 ]; do shift; done
exec docker exec -i pdrive-gnu sh -c "$1"
EOF
chmod +x /tmp/docker-ssh

PDRIVE_SSH=/tmp/docker-ssh pdrive serve ssh://root@gnu-box/srv/test -p 8127
```

Exercised that way: listing (sizes and times identical to `ls -la`), names with
spaces, quotes, `#`, `?`, `%`, a newline and non-ASCII, Range on a 20 MB file,
a 20 MB upload whose md5 matches on arrival, `mkdir`/`mv`/`cp`/`rm`/`trash`,
zip and unzip through the job panel including the 409 "these exist" answer, and
`PDRIVE_SSH` pointed at a host that is not there.

Then against a real remote: a Raspberry Pi 5 (`pecan.local`, Debian, aarch64,
GNU coreutils, `gio`, `zip`/`unzip`), over the LAN and the default `ssh`. Home
directory listing, `~/` targets, a 3 MB upload whose md5 matches on the Pi and
downloaded back, `mkdir`/`cp`/`mv`, `gio trash` leaving a proper
`~/.local/share/Trash/{files,info}` pair, zip and unzip as jobs, text preview
by Range, `image/png` served with the right content type, and the UI listing the
remote files in a headless browser. `stat` is the only part of that which was
not exercised: the Pi speaks GNU, so the BSD branch was only covered by the
macOS wrapper. Measured there: ~30 ms per command on an established
`ControlMaster` connection, ~125 ms for a listing of a 28-entry home directory
over Wi-Fi; the server's RSS stayed at 43 MB across a 20 MB transfer.

