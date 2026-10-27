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
import json
import shutil

from argparse import ArgumentParser
from flask import Flask
from flask import make_response
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
    print("\x1b[32mYou can SSH Tunnel to this service in a "
          "separate terminal with:\x1b[0m")
    print("")
    print(f"\x1b[32m    ssh -N -L {args.port}:localhost:{args.port} "
          f"{hostname}\x1b[0m")
    print("")


def main():
    p = ArgumentParser()
    p.add_argument("-H", "--host", default="127.0.0.1",
                   help="Host address to bind server to (default: 127.0.0.1)")
    p.add_argument("-p", "--port", default=9999,
                   help="Host port to bind server to (default: 9999)")
    a = p.parse_args()

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
