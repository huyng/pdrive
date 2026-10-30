# pdrive

pdrive is a browser-based file manager. If you need a quick way of browsing files on a remote server, this is the tool for you.

Long operations - uploading a file, compressing a folder, unpacking an archive - run as jobs in the server rather than in the request that started them, so the interface stays usable while they work and reports their progress instead of freezing on a spinner.


![pdrive](https://user-images.githubusercontent.com/121183/87987433-7e86fb00-ca93-11ea-9236-14823d0650c2.gif)


### Installation

```
# If you want to install with pip
pip install pdrive

# Or if you want to install with uv
uv tool install pdrive

# Or you can even run the tool without installing using uv's uvx:
uvx pdrive
```

### Usage

You can start a server for browsing or modifying a given directory with the following command

```
cd /path/to/my/directory
pdrive
```

Or name the directory on the command line: `pdrive serve /path/to/my/directory`.

### A directory on another machine

pdrive can serve a directory that lives on another machine over ssh, without
installing anything there:

```
pdrive serve ssh://you@example.com              # your home directory there
pdrive serve ssh://you@example.com/var/log      # a directory you can read
pdrive serve ssh://you@example.com/~/notes      # one in your home
pdrive serve ssh://you@example.com:2222/srv     # a non-default ssh port
```

A path in the address is absolute (`/var/log`); prefix it with `~/` for a
directory in your home directory on that machine. A target that does not
exist, or is a file, is refused at start-up with one sentence rather than
producing an empty page.

The server, the UI and the jobs all run on the machine you typed the command
on; the other machine only runs `find`, `stat`, `cat`, `cp`, `mv`, `rm`,
`mkdir`, `tail`, `head`, `zip` and `unzip`. Nothing listens there and no token
is involved: ssh is the authentication, and the host is handed to `ssh`
unchanged, so `~/.ssh/config`, keys, agent forwarding and `ProxyJump` all keep
working. `PDRIVE_SSH` may name a wrapper (`PDRIVE_SSH="ssh -J bastion"`).

Two features need something on the other side and say so when it is missing:
trash wants `gio` or `trash-put` (permanent Delete still works), and archives
want the `zip` and `unzip` binaries. Hosts need a POSIX userland - GNU, BSD or
busybox - which every Linux, macOS and BSD box has.

### Previews

Text, images, PDF, audio, video, CSV and markdown are read by pdrive itself.
An HTML file is not a picture of a page, it is one, so it runs in a sandboxed
frame: its own scripts work, on an origin of its own. It cannot read this app's
storage, its DOM or its API, it cannot submit a form or open a window, and the
server refuses any state-changing request a sandboxed page - or another site -
makes the browser send. Files next to the page are served from the same route,
so a report that loads `style.css` or `logo.png` renders; one that calls
`fetch()` for data does not, and the bar's other reading shows the source.

### Getting started

You can run pdrive by calling the `python -m pdrive` command within a directory you want to explore. Once running, you can visit the web interface at `http://127.0.0.1:9999`.

If you're running this on a remote server, you can use ssh port forwarding to access the web interface over an ssh connection:

```
ssh -N -L 9999:localhost:9999 your@host.com
```

**SECURITY NOTE:** pdrive will have all the same permissions to modify your file system as the user who started the program - for an `ssh://` target, the permissions of the user you connected as, on that machine.

### Documentation

```
usage: pdrive [-h] [-H HOST] [-p PORT] [target]

positional arguments:
  target                Directory to serve (default: the current one), or
                        ssh://[user@]host[:port][/path] for a directory on
                        another machine, reached over ssh

optional arguments:
  -h, --help            show this help message and exit
  -H HOST, --host HOST
  -p PORT, --port PORT
```
