#!/usr/bin/env python
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

import logging
from flask import cli
import sys
import platform
import os.path as pth
import os
import hmac
import ipaddress
import json
import secrets
import shutil
import string
import zipfile

from argparse import ArgumentParser
from urllib.parse import urlencode

from flask import Flask
from flask import make_response
from flask import redirect
from flask import request
from flask import render_template
from flask import send_file
from flask import send_from_directory

try:
    from .trash import move_to_trash
except ImportError:  # running this file as a plain script, not a package
    from trash import move_to_trash

frontend_path = pth.join(
    pth.split(pth.split(pth.abspath(__file__))[0])[0], "frontend")

print(frontend_path)

app = Flask(__name__,
            static_folder=pth.join(frontend_path, "dist"),
            static_url_path="")


basedir = os.path.abspath(os.curdir)
hostname = platform.node()


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------
# Binding to anything but the loopback interface puts this machine's filesystem
# on the network, so those servers ask for a token - the way Jupyter Notebook
# does it. On loopback the browser is exactly as trusted as the terminal that
# started the server, so no token is asked for unless one is given explicitly.

TOKEN = None                    # the secret, or None when nothing is asked for
TOKEN_COOKIE = "pdrive_token"

# 12 characters of base62: about 71 bits. Nobody guesses this by trying - even
# at a thousand attempts a second from every port on the internet it is millions
# of years - and there is no stored hash to grind against offline. It is short
# enough to read off the screen and type, which 43 characters of base64 are not.
# `-` and `_` are left out: they are base64url's, not a word's, and a token with
# one in it is read aloud, copied out of a PDF or retyped wrongly.
TOKEN_LENGTH = 12
TOKEN_ALPHABET = string.ascii_letters + string.digits


def is_loopback(host):
    """True when `host` only accepts connections made on this machine."""
    host = (host or "").strip().strip("[]")
    if not host:
        # an empty host means every interface, which is the opposite of this
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        # a name we cannot place: assume it is reachable, so ask for a token
        return False


def new_token():
    """A fresh token for this run of the server, like `Kq7dR2xTm9Za`.

    Nothing is written to disk: the secret lives in this process only, so a
    restart makes every token handed out so far worthless, and the address the
    server printed has to be opened again. That is the price of not leaving the
    way in behind on the filesystem.
    """
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(TOKEN_LENGTH))


def configure_auth(args):
    """Decide whether this server needs a token, and which token it is.

    One rule, no switches: a server the network can reach gets a token, a server
    only this machine can reach does not. Turning the token into a choice would
    put the deciding vote in the hands of whoever is typing the command line,
    which is exactly the moment the risk is easiest to get wrong.
    """
    global TOKEN
    TOKEN = None if is_loopback(args.host) else new_token()


def presented_tokens():
    """Every token this request carries, in the order they should be tried."""
    tokens = []
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        tokens.append(authorization[len("Bearer "):].strip())
    # the cookie goes before the query string: a token left behind in a
    # bookmarked URL must not shadow the one the browser signed in with
    cookie = request.cookies.get(TOKEN_COOKIE)
    if cookie:
        tokens.append(cookie)
    query = request.args.get("token")
    if query:
        tokens.append(query)
    return tokens


def is_authenticated():
    # compare_digest, so that a wrong token cannot be found one byte at a time
    return any(hmac.compare_digest(token, TOKEN) for token in presented_tokens())


def remember_token(response):
    # Lax rather than Strict: the cookie still rides along when the app is
    # opened from a link or a bookmark, but not on a cross-site form post, which
    # is the request that could be made to change something. No max_age: the
    # token dies with the server, so a cookie outliving the browser session
    # would only carry a secret that can no longer be accepted
    response.set_cookie(TOKEN_COOKIE, TOKEN,
                        httponly=True, samesite="Lax", path="/")
    return response


def wants_json():
    """Whether the caller can only make sense of a JSON answer.

    The frontend and anything scripted gets a 401 it can act on; a browser
    clicking a link gets a page that says what a token is instead.
    """
    path = request.path
    if path.startswith(("/api", "/serve", "/download", "/upload")):
        return True
    return "application/json" in request.headers.get("Accept", "")


def this_url_without_token():
    """The URL of this request with any `token` taken out of the query."""
    keep = [(key, value) for key, value in request.args.items(multi=True)
            if key != "token"]
    return request.path + ("?" + urlencode(keep) if keep else "")


# Returned with a 401 to a browser that carried no valid token. There is no
# form here on purpose: the token is printed by the server at start-up, so
# there is nothing to fill in and nothing to guess at. It is also plain enough
# to render on a machine with no network and an outdated browser.
AUTH_FAILURE_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pdrive - unauthorized</title>
<style>
  body {
    max-width: 34em;
    margin: 0 auto;
    padding: 48px 24px;
    color: #1F2D3D;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text",
          "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  h1 { margin: 0 0 8px; font-size: 18px; }
  p { margin: 0 0 12px; color: #5A6879; }
  code {
    padding: 1px 4px;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #F1F4F8;
    border-radius: 4px;
  }
</style>
</head>
<body>
<h1>Unauthorized</h1>
<p>This pdrive server requires a token. Open the address printed in the terminal
where it started, which carries <code>?token=...</code>, or send the token as
<code>Authorization: Bearer ...</code>.</p>
</body>
</html>
"""


@app.before_request
def require_token():
    if TOKEN is None:
        # an unauthenticated server has nothing to protect
        return None

    if is_authenticated():
        # On a page load the token arrived on the URL: trade it for a cookie and
        # take it back out of the address bar, so that it does not end up in the
        # history, in a screenshot or in the Referer of what the page loads. A
        # script asking /api or /serve with ?token= is left alone: it gets its
        # answer instead of a redirect it does not follow.
        if (request.method == "GET" and request.args.get("token")
                and not wants_json()):
            return remember_token(redirect(this_url_without_token()))
        return None

    if wants_json():
        # a script gets the refusal in the shape it asked for. Without the
        # explicit type Flask would label a JSON body text/html
        return make_response(json.dumps({"error": "unauthorized"}), 401,
                             {"Content-Type": "application/json"})
    # no form and no way to ask again: the token is printed by the server, so
    # the answer is to go back to the address it printed
    return make_response(AUTH_FAILURE_PAGE, 401)


@app.route("/api", methods=["GET", "POST"])
def api():
    global basedir
    payload = request.form.get("payload")
    if payload is None:
        nodes = [process(pth.join(basedir, n)) for n in os.listdir(basedir)]
        data = {
            "basedir": basedir,
            "cwd": basedir,
            "hostname": hostname,
            "nodes": nodes
        }
        return json.dumps(data)
    else:
        payload = json.loads(payload)
        print(payload)
        if payload["command"] == "trash":
            # Deleting is a move to the trash of the host system (the Recycle
            # Bin, ~/.Trash, the freedesktop trash, ...), so an accidental
            # click is always undoable. Every path is reported back: some may
            # have made it while others did not, and the UI says so.
            trashed = []
            failed = []
            for path in payload["paths"]:
                try:
                    trashed.append(move_to_trash(path) or path)
                except OSError as error:
                    failed.append({"path": path, "error": str(error)})
            data = dict(payload)
            data["trashed"] = trashed
            data["failed"] = failed
            return json.dumps(data)
        elif payload["command"] == "rm":
            # Permanent deletion. The UI only sends this after it has asked the
            # user to confirm, because there is nothing to recover from here.
            deleted = []
            failed = []
            for path in payload["paths"]:
                try:
                    if os.path.isdir(path) and not os.path.islink(path):
                        shutil.rmtree(path)
                    else:
                        os.unlink(path)
                    deleted.append(path)
                except OSError as error:
                    failed.append({"path": path, "error": str(error)})
            data = dict(payload)
            data["deleted"] = deleted
            data["failed"] = failed
            return json.dumps(data)
        elif payload["command"] == "ls":
            path = payload["path"]
            nodes = [process(pth.join(path, n)) for n in os.listdir(path)]
            data = {
                "basedir": basedir,
                "cwd": path,
                "hostname": hostname,
                "nodes": nodes
            }
            return json.dumps(data)
        elif payload["command"] == "mv":
            paths = payload["paths"]
            destination = payload["destination"]
            for p in paths:
                shutil.move(p, destination)
            return json.dumps(payload)
        elif payload["command"] == "cp":
            paths = payload["paths"]
            destination = payload["destination"]
            for p in paths:
                name = os.path.split(p)[1]
                copy = shutil.copytree if os.path.isdir(p) else shutil.copy
                dest = pth.join(destination, name) if os.path.isdir(
                    destination) and os.path.isdir(p) else destination
                copy(p, dest)
            return json.dumps(payload)

        elif payload["command"] == "mkdir":
            path = payload["path"]
            if not os.path.exists(path):
                os.makedirs(path)
            return json.dumps(process(path))

        elif payload["command"] == "zip":
            paths = [path for path in payload["paths"] if os.path.exists(path)]
            if not paths:
                return json.dumps({"error": "nothing to compress"}), 400
            destination = payload.get("destination") or pth.dirname(paths[0])
            archive = unique_path(
                pth.join(destination, payload.get("name") or archive_name(paths)))
            failed = []
            try:
                with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
                    for path in paths:
                        try:
                            add_to_archive(zf, path, archive)
                        except OSError as error:
                            failed.append({"path": path, "error": str(error)})
            except OSError as error:
                # a half written archive is worse than none
                if os.path.exists(archive):
                    os.unlink(archive)
                return json.dumps({"error": str(error)}), 500
            data = dict(payload)
            data["archive"] = archive
            data["failed"] = failed
            data["node"] = process(archive)
            return json.dumps(data)

        elif payload["command"] == "unzip":
            archive = payload["path"]
            if not os.path.isfile(archive):
                return json.dumps({"error": "no such file"}), 404
            try:
                zf = zipfile.ZipFile(archive)
            except zipfile.BadZipFile:
                return json.dumps({"error": "not a zip archive"}), 400
            with zf:
                members = [name for name in zf.namelist() if name.strip("/\\")]
                base = pth.dirname(archive)
                # like the Finder: several items are unpacked into a folder
                # named after the archive, a single one next to it
                tops = set()
                for member in members:
                    entry = member.replace("\\", "/").strip("/").split("/")[0]
                    if entry:
                        tops.add(entry)
                destination = base
                if len(tops) > 1:
                    destination = unique_path(pth.join(
                        base, pth.splitext(pth.basename(archive))[0]))
                plans = []
                skipped = []
                for member in members:
                    target = safe_target(destination, member)
                    if target is None:
                        skipped.append(member)
                    else:
                        plans.append((member, target))
                conflicts = [target for _, target in plans if os.path.exists(target)]
                if conflicts and not payload.get("overwrite"):
                    # the caller asks the user and comes back with overwrite
                    return json.dumps({
                        "error": "exists",
                        "conflicts": conflicts[:20],
                        "count": len(conflicts),
                    }), 409
                failed = []
                extracted = 0
                for member, target in plans:
                    try:
                        if member.endswith(("/", "\\")) or zf.getinfo(member).is_dir():
                            os.makedirs(target, exist_ok=True)
                            continue
                        os.makedirs(pth.dirname(target), exist_ok=True)
                        with zf.open(member) as src, open(target, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        extracted += 1
                    except (OSError, RuntimeError) as error:
                        # RuntimeError is what an encrypted member raises
                        failed.append({"path": target, "error": str(error)})
            data = dict(payload)
            data["destination"] = destination
            data["extracted"] = extracted
            data["skipped"] = skipped
            data["failed"] = failed
            return json.dumps(data)

        return json.dumps(payload)


@app.route("/serve")
def serve_file():
    fpath = request.args.get("file")
    if not fpath or not os.path.isfile(fpath):
        return make_response("file not found", 404)
    response = send_file(fpath)
    return response


@app.route("/download")
def download_file():
    fpath = request.args.get("file")
    if not fpath or not os.path.isfile(fpath):
        return make_response("file not found", 404)
    name = os.path.split(fpath)[1]
    response = send_file(fpath)
    response.headers['Content-Disposition'] = "attachment; filename=%s" % name
    return response


@app.route("/upload", methods=["POST"])
def upload_file():
    fd = request.files['file']
    basedir = request.form["basedir"]
    if not os.path.isdir(basedir):
        # the folder was removed or renamed between the listing and the drop
        return json.dumps({"error": "no such directory"}), 400
    # Only the base name is used: the folder is decided by where the file was
    # dropped, and a name like "../x" must not be able to write outside it.
    fpath = os.path.join(basedir, pth.basename(fd.filename))
    fd.save(fpath)
    node = process(fpath)
    return json.dumps(node)


@app.route("/")
def index_page():
    return send_file(pth.join(frontend_path, "dist", "index.html"))


def unique_path(path):
    """``path`` if it is free, else "name 2.ext", "name 3.ext", ... (Finder's way)."""
    if not os.path.exists(path):
        return path
    stem, extension = pth.splitext(path)
    counter = 2
    while os.path.exists("%s %d%s" % (stem, counter, extension)):
        counter += 1
    return "%s %d%s" % (stem, counter, extension)


def archive_name(paths):
    """The name the Finder would give the archive of this selection."""
    if len(paths) != 1:
        return "Archive.zip"
    name = pth.basename(paths[0].rstrip("/\\")) or "Archive"
    return name if name.lower().endswith(".zip") else name + ".zip"


def add_to_archive(zf, path, archive):
    """Add ``path`` (a file, or a whole tree) to ``zf``, keeping its own name."""
    if os.path.isdir(path) and not os.path.islink(path):
        base = pth.dirname(path)
        for root, dirs, files in os.walk(path):
            relative = pth.relpath(root, base).replace(os.sep, "/")
            # an empty directory only survives as an entry of its own
            dirs[:] = [name for name in dirs
                       if pth.abspath(pth.join(root, name)) != pth.abspath(archive)]
            if not dirs and not files:
                zf.writestr(relative + "/", "")
            for name in files:
                full = pth.join(root, name)
                # the archive may be written into the tree it is archiving
                if pth.abspath(full) == pth.abspath(archive):
                    continue
                zf.write(full, pth.relpath(full, base).replace(os.sep, "/"))
    else:
        zf.write(path, pth.basename(path))


def safe_target(destination, member):
    """Where a zip member may be written, or None if it points outside.

    Archive entries are plain strings, so "../.." or an absolute path in one
    would otherwise write anywhere on the filesystem.
    """
    if member.startswith(("/", "\\")):
        return None
    components = []
    for component in member.replace("\\", "/").split("/"):
        if component in ("", "."):
            continue
        if component == ".." or ":" in component:
            return None
        components.append(component)
    if not components:
        return None
    root = pth.abspath(destination)
    target = pth.abspath(pth.join(root, *components))
    if target != root and not target.startswith(root + os.sep):
        return None
    return target


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


def print_banner(args):
    hostname = platform.node()



    print("")
    print("\x1b[32m================\x1b[0m")
    print("\x1b[32m-    PDrive    -\x1b[0m")
    print("\x1b[32m================\x1b[0m")
    print("")
    print(f"\x1b[32mStarting server at http://{args.host}:{args.port}\x1b[0m")
    print("")
    if TOKEN is not None:
        # 0.0.0.0 and :: are bind addresses, not addresses a browser can open
        # meaningfully, so the local one is printed and the rest is explained
        shown = "127.0.0.1" if args.host in ("0.0.0.0", "::", "") else args.host
        print("\x1b[32mThis server is protected by a token. Open:\x1b[0m")
        print("")
        print(f"\x1b[32m    http://{shown}:{args.port}/?token={TOKEN}\x1b[0m")
        print("")
        print(f"\x1b[32mFrom another machine, use this host's address instead of "
              f"{shown}. The token is not saved anywhere and a new one "
              "\x1b[0m")
        print("\x1b[32mis generated on every restart, so this printed address "
              "is the only way in.\x1b[0m")
        print("")
    print("\x1b[32mYou can SSH Tunnel to this service in a "
          "separate terminal with:\x1b[0m")
    print("")
    print(f"\x1b[32m    ssh -N -L {args.port}:localhost:{args.port} "
          f"{hostname}\x1b[0m")
    print("")


def main():
    p = ArgumentParser()
    p.add_argument("-H", "--host", default="127.0.0.1",
                   help="Host address to bind server to (default: 127.0.0.1). "
                        "Binding to anything but loopback generates a token "
                        "and prints the address that carries it")
    p.add_argument("-p", "--port", default=9999,
                   help="Host port to bind server to (default: 9999)")
    a = p.parse_args()
    configure_auth(a)

    # If gunicorn is available use it rather than the
    # default dev server
    import importlib
    import importlib.util
    gunicorn_import_available = importlib.util.find_spec("gunicorn")
    if gunicorn_import_available:
        import gunicorn.app.base
        import multiprocessing

        class Application(gunicorn.app.base.BaseApplication):

            def __init__(self, app, options=None):
                self.options = options or {}
                self.application = app
                super().__init__()

            def load_config(self):
                config = {key: value for key, value in self.options.items()
                          if key in self.cfg.settings and value is not None}
                for key, value in config.items():
                    self.cfg.set(key.lower(), value)

            def load(self):
                return self.application

        # start app
        print_banner(a)

        cpu_count = multiprocessing.cpu_count()
        options = {
            'bind': '%s:%s' % (a.host, a.port),
            'workers': min(cpu_count+1, 4),
            'timeout': 120,
        }
        Application(app, options).run()
    else:
        print_banner(a)

        print("")
        print("\x1b[33mYou are running PDrive using a built-in minimal web server. For \n"
              "better file upload & download performance, we recommend you install \n"
              "the gunicorn web server python package. PDrive will automatically \n"
              "use it if it is available:\x1b[0m")
        print("")
        print("    pip install gunicorn")
        print("")

        log = logging.getLogger('werkzeug')
        log.disabled = True
        cli.show_server_banner = lambda *_: None
        app.run(host=a.host, port=a.port)


if __name__ == '__main__':
    main()
