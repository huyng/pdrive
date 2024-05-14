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

import gunicorn.app.base
import sys
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

frontend_path = pth.join(
    pth.split(pth.split(pth.abspath(__file__))[0])[0], "frontend")

app = Flask(__name__,
            static_folder=pth.join(frontend_path, "dist"),
            static_url_path="/dist")


basedir = os.path.abspath(os.curdir)


@app.route("/api", methods=["GET", "POST"])
def api():
    global basedir
    payload = request.form.get("payload")
    if payload is None:
        nodes = [process(pth.join(basedir, n)) for n in os.listdir(basedir)]
        data = {
            "basedir": basedir,
            "cwd": basedir,
            "nodes": nodes
        }
        return json.dumps(data)
    else:
        payload = json.loads(payload)
        print(payload)
        if payload["command"] == "rm":
            paths = payload["paths"]
            for p in paths:
                rmfn = shutil.rmtree if os.path.isdir(p) else os.unlink
                rmfn(p)
            return json.dumps(payload)
        elif payload["command"] == "ls":
            path = payload["path"]
            nodes = [process(pth.join(path, n)) for n in os.listdir(path)]
            data = {
                "basedir": basedir,
                "cwd": path,
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
    response = send_file(fpath)
    return response


@app.route("/download")
def download_file():
    fpath = request.args.get("file")
    name = os.path.split(fpath)[1]
    response = send_file(fpath)
    response.headers['Content-Disposition'] = "attachment; filename=%s" % name
    return response


@app.route("/upload", methods=["POST"])
def upload_file():
    fd = request.files['file']
    basedir = request.form["basedir"]
    fpath = os.path.join(basedir, fd.filename)
    fd.save(fpath)
    node = process(fpath)
    return json.dumps(node)


@app.route("/")
def index_page():
    return send_file(pth.join(frontend_path, "index.html"))


def process(path):
    import os
    import stat
    import datetime
    import mimetypes

    name = pth.split(path)[1]
    statinfo = os.stat(path)

    if stat.S_ISDIR(statinfo.st_mode):
        node_type = "dir"
    else:
        node_type = "file"

    mimetype = None
    if node_type == "file":
        mimetype, _ = mimetypes.guess_type(path)

    return {
        "name": name,
        "path": path,
        "type": node_type,
        "mimetype": mimetype,
        "size": statinfo.st_size,
        "mtime": datetime.datetime.utcfromtimestamp(statinfo.st_mtime).strftime("%Y-%M-%d %I:%M:%S %p")
    }


def main():
    p = ArgumentParser()
    p.add_argument("-H", "--host", default="127.0.0.1")
    p.add_argument("-p", "--port", default=9999)
    a = p.parse_args()

    # If gunicorn is available use it rather than the
    # default dev server
    try:
        import gunicorn
        import gunicorn.app.base

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
        options = {
            'bind': '%s:%s' % (a.host, a.port),
            'workers': 3,
            'timeout': 120,
        }
        Application(app, options).run()

    except ImportError:
        app.run(host=a.host, port=a.port)


if __name__ == '__main__':
    main()
