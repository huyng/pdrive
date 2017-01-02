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

frontend_path = pth.join(pth.split(pth.split(__file__)[0])[0], "frontend")

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
        nodes_dirs = sorted((n for n in nodes if n["type"] == "dir"), key=lambda n: n['name'])
        nodes_files = sorted((n for n in nodes if n["type"] == "file"), key=lambda n: n['name'])
        nodes = nodes_dirs + nodes_files
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
            nodes_dirs = sorted((n for n in nodes if n["type"] == "dir"), key=lambda n: n['name'])
            nodes_files = sorted((n for n in nodes if n["type"] == "file"), key=lambda n: n['name'])
            nodes = nodes_dirs + nodes_files
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
                dest = pth.join(destination, name) if os.path.isdir(destination) and os.path.isdir(p) else destination
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

    name = pth.split(path)[1]
    statinfo = os.stat(path)
    node_type = "dir" if stat.S_ISDIR(statinfo.st_mode) else "file"
    return {
        "name": name,
        "path": path,
        "type": node_type,
        "size": statinfo.st_size,
        "mtime": datetime.datetime.utcfromtimestamp(statinfo.st_mtime).strftime("%Y-%M-%d %I:%M:%S %p")
    }


def main():
    p = ArgumentParser()
    p.add_argument("-H", "--host", default="127.0.0.1")
    p.add_argument("-p", "--port", default=9999)
    a = p.parse_args()
    app.run(host=a.host, port=a.port)

if __name__ == '__main__':
    main()







# =======================================



# register additional static paths
# blueprint = Blueprint('site', __name__, static_url_path='/static/site', static_folder='path/to/files')
# app.register_blueprint(blueprint)

# safely send file with user generated string
# @app.route("/photos/fname.jpg")
# def photo_files(fname):
#     return send_from_directory(dpath, fname)

# send  any file
# @app.route("/photos/fname.jpg")
# def photo_files(fname):
#     return send_file(fname)

# @app.route("/images/view/")
# def image_view():
#     img_id = request.args.get("img_id").strip()
#     print img_id
#     rec = rdd.lookup(img_id)
#     response = make_response(rec[0].decode("base64"))
#     response.headers['Content-Type'] = 'image/jpeg'
#     return response
