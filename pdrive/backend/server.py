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

"""The transport: one process, HTTP for questions, a WebSocket for events.

Nothing here does work. A route parses the request, hands it to the kernel and
serialises the answer; the auth middleware is the only thing with a decision in
it, and that decision is about a token, not about files.

One process is a hard rule, not a tuning choice: jobs, terminals and handles
live in this process's memory, so a second worker would have half of them and
answer every other request with a shrug. `uvicorn` is therefore started with
`workers=1` and without reload, and there is deliberately no branch that falls
back to forking.
"""

import argparse
import asyncio
import hmac
import ipaddress
import json
import os
import os.path as pth
import platform
import secrets
import string
from urllib.parse import parse_qsl
from urllib.parse import urlencode

import uvicorn
from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.requests import cookie_parser
from starlette.responses import FileResponse
from starlette.responses import HTMLResponse
from starlette.responses import JSONResponse
from starlette.responses import PlainTextResponse
from starlette.responses import RedirectResponse
from starlette.routing import Mount
from starlette.routing import Route
from starlette.routing import WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket

from .kernel import archive
from .kernel import fs
from .kernel import jobs
from .kernel import ws
from .kernel.commands import dispatch
from .kernel.nodes import process

frontend_path = pth.join(
    pth.split(pth.split(pth.abspath(__file__))[0])[0], "frontend")
dist_path = pth.join(frontend_path, "dist")

# the directory this server was started in, and the machine it runs on: kernel
# state, not a property of a request
basedir = fs.basedir
hostname = fs.hostname


def package_version():
    # asked of the installed distribution, so that the number the UI shows is
    # the one that was built and not a second copy kept in the source
    from importlib.metadata import PackageNotFoundError
    from importlib.metadata import version
    try:
        return version("pdrive")
    except PackageNotFoundError:
        return None


VERSION = package_version()


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

# What a caller that can only make sense of JSON gets told instead of a page.
JSON_PREFIXES = ("/api", "/serve", "/download", "/upload", "/ws")


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


def query_pairs(scope):
    """The `?a=b` pairs of a request, in order, blanks kept."""
    raw = scope.get("query_string") or b""
    return parse_qsl(raw.decode("latin-1"), keep_blank_values=True)


def presented_tokens(scope):
    """Every token this request carries, in the order they should be tried."""
    headers = Headers(scope=scope)
    tokens = []
    authorization = headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        tokens.append(authorization[len("Bearer "):].strip())
    # the cookie goes before the query string: a token left behind in a
    # bookmarked URL must not shadow the one the browser signed in with
    cookie = cookie_parser(headers.get("cookie", "")).get(TOKEN_COOKIE)
    if cookie:
        tokens.append(cookie)
    for key, value in query_pairs(scope):
        if key == "token" and value:
            tokens.append(value)
    return tokens


def is_authenticated(scope):
    # compare_digest, so that a wrong token cannot be found one byte at a time
    return any(hmac.compare_digest(token, TOKEN)
               for token in presented_tokens(scope))


def remember_token(response):
    # Lax rather than Strict: the cookie still rides along when the app is
    # opened from a link or a bookmark, but not on a cross-site form post, which
    # is the request that could be made to change something. No max_age: the
    # token dies with the server, so a cookie outliving the browser session
    # would only carry a secret that can no longer be accepted
    response.set_cookie(TOKEN_COOKIE, TOKEN,
                        httponly=True, samesite="Lax", path="/")
    return response


def wants_json(scope):
    """Whether the caller can only make sense of a JSON answer.

    The frontend and anything scripted gets a 401 it can act on; a browser
    clicking a link gets a page that says what a token is instead.
    """
    if scope.get("path", "").startswith(JSON_PREFIXES):
        return True
    accept = Headers(scope=scope).get("accept", "")
    return "application/json" in accept


def this_url_without_token(scope):
    """The URL of this request with any `token` taken out of the query."""
    keep = [(key, value) for key, value in query_pairs(scope) if key != "token"]
    return scope.get("path", "/") + ("?" + urlencode(keep) if keep else "")


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


class TokenGuard:
    """Refuse requests and sockets that carry no valid token.

    A pure ASGI middleware rather than a per-route check, because the check has
    to cover the WebSocket handshake too: a page is trusted through its cookie,
    and a socket opened without one would be a way around every route below.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if TOKEN is None or scope["type"] not in ("http", "websocket"):
            # nothing to protect, and lifespan messages are our own
            return await self.app(scope, receive, send)

        if is_authenticated(scope):
            if (scope["type"] == "http" and scope["method"] == "GET"
                    and dict(query_pairs(scope)).get("token")
                    and not wants_json(scope)):
                # On a page load the token arrived on the URL: trade it for a
                # cookie and take it back out of the address bar, so that it
                # does not end up in the history, in a screenshot or in the
                # Referer of what the page loads. A script asking /api or
                # /serve with ?token= is left alone: it gets its answer instead
                # of a redirect it does not follow.
                response = remember_token(
                    RedirectResponse(this_url_without_token(scope),
                                     status_code=302))
                return await response(scope, receive, send)
            return await self.app(scope, receive, send)

        if scope["type"] == "websocket":
            # closing before accept turns into a refused handshake, which is the
            # only honest answer to a socket: a browser cannot show a 401 page
            # on one, and an open socket is worse than a closed one
            await WebSocket(scope, receive, send).close(code=1008)
            return

        if wants_json(scope):
            response = JSONResponse({"error": "unauthorized"}, 401)
        else:
            # no form and no way to ask again: the token is printed by the
            # server, so the answer is to go back to the address it printed
            response = HTMLResponse(AUTH_FAILURE_PAGE, 401)
        return await response(scope, receive, send)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
# Every route below is a transport: parse the request, hand it to the kernel,
# serialise the answer. Anything that knows how to do work lives in `kernel/`.


def listing():
    """The `/api` answer: where we are, what is here, what this build is."""
    data = fs.list_dir(basedir)
    data["version"] = VERSION
    # filled in once apps exist; the field is here now so that the UI reads one
    # shape from the first phase on
    data["apps"] = []
    return data


async def api_listing(request):
    if request.method == "POST":
        # Deprecated: the form-encoded `payload` field this server has always
        # read. `POST /api/cmd` takes the same object as JSON. Kept for one
        # phase so that a script or a stale tab keeps working, removed in the
        # phase that introduces handles.
        form = await request.form()
        payload = form.get("payload")
        if payload is not None:
            data, status = await asyncio.to_thread(dispatch, json.loads(payload))
            return JSONResponse(data, status)
    return JSONResponse(await asyncio.to_thread(listing))


async def api_cmd(request):
    try:
        payload = await request.json()
    except ValueError:
        return JSONResponse({"error": "bad json"}, 400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "bad json"}, 400)
    # off the event loop: a zip or a copy of a large tree would otherwise hold
    # every socket and every other request for as long as it runs
    data, status = await asyncio.to_thread(dispatch, payload)
    return JSONResponse(data, status)


async def serve_file(request):
    fpath = request.query_params.get("file")
    if not fpath or not os.path.isfile(fpath):
        return PlainTextResponse("file not found", 404)
    return FileResponse(fpath, content_disposition_type="inline")


async def download_file(request):
    fpath = request.query_params.get("file")
    if not fpath or not os.path.isfile(fpath):
        return PlainTextResponse("file not found", 404)
    return FileResponse(fpath, filename=pth.basename(fpath),
                        content_disposition_type="attachment")


def save_upload(source, destination, size, report):
    # chunked, because the file may be larger than the memory this process is
    # allowed to use: the browser streams it in and it goes out to disk in the
    # same shape, never whole
    written = 0
    with open(destination, "wb") as out:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            written += len(chunk)
            if size:
                report(written / float(size))
    return written


async def upload_file(request):
    # The page names the job before it starts sending, so that the transfer
    # itself can be watched: it subscribes to `job:<id>` and then posts the file
    # with that id on the query string. Without one (a script) the job is minted
    # here and the caller still gets its id back.
    requested = request.query_params.get("job") or ""
    # the page knows the file's name before the body arrives, so the panel can
    # name the transfer from its first frame instead of its last
    announced = pth.basename(request.query_params.get("name") or "")
    job = jobs.get(requested)
    if job is None or job.state != "running":
        job = jobs.begin("upload", "Uploading %s" % (announced or "file"),
                         job_id=requested)

    length = request.headers.get("content-length", "")
    total = int(length) if length.isdigit() else 0
    received = [0]

    async def counting_receive():
        message = await request.receive()
        if message["type"] == "http.request":
            received[0] += len(message.get("body") or b"")
            if total:
                # the transfer is most of an upload and the write is the rest
                jobs.advance(job, 0.9 * min(received[0] / float(total), 1.0))
        return message

    try:
        form = await Request(request.scope, counting_receive).form()
    except Exception:
        jobs.fail(job, "could not read the upload", 400)
        raise
    upload = form.get("file")
    basedir_arg = form.get("basedir")
    if not isinstance(basedir_arg, str) or not os.path.isdir(basedir_arg):
        # the folder was removed or renamed between the listing and the drop
        jobs.fail(job, "no such directory", 400)
        return JSONResponse({"error": "no such directory"}, 400)
    if upload is None:
        jobs.fail(job, "no file", 400)
        return JSONResponse({"error": "no file"}, 400)
    name = pth.basename(upload.filename or "")
    jobs.relabel(job, "Uploading %s" % name)
    # Only the base name is used: the folder is decided by where the file was
    # dropped, and a name like "../x" must not be able to write outside it.
    fpath = os.path.join(basedir_arg, name)
    await asyncio.to_thread(save_upload, upload.file, fpath, upload.size,
                            lambda progress: jobs.advance(job, 0.9 + 0.1 * progress))
    node = await asyncio.to_thread(process, fpath)
    jobs.finish(job, {"node": node})
    return JSONResponse({"job": job.id, "node": node})


def job_label(payload):
    """What the progress panel calls this job."""
    if payload.get("command") == "zip":
        paths = payload.get("paths") or []
        return "Compressing %s" % (payload.get("name") or archive.archive_name(paths))
    return "Extracting %s" % pth.basename(payload.get("path") or "")


async def api_jobs(request):
    if request.method == "GET":
        return JSONResponse({"jobs": jobs.listing()})
    try:
        payload = await request.json()
    except ValueError:
        return JSONResponse({"error": "bad json"}, 400)
    if not isinstance(payload, dict) or payload.get("kind") not in ("zip", "unzip"):
        return JSONResponse({"error": "unknown job kind"}, 400)
    # the job runs the command the request described, so the result is the one
    # `/api/cmd` would have answered with: same shape, same status
    command = dict(payload)
    command["command"] = payload["kind"]
    job = jobs.begin(command["command"], job_label(command))
    jobs.start(job, lambda report: dispatch(command, report))
    return JSONResponse({"job": job.id})


async def index_page(request):
    return FileResponse(pth.join(dist_path, "index.html"),
                        content_disposition_type="inline")


routes = [
    Route("/api", api_listing, methods=["GET", "POST"]),
    Route("/api/cmd", api_cmd, methods=["POST"]),
    Route("/api/jobs", api_jobs, methods=["GET", "POST"]),
    Route("/serve", serve_file),
    Route("/download", download_file),
    Route("/upload", upload_file, methods=["POST"]),
    WebSocketRoute("/ws", ws.serve),
    Route("/", index_page),
    # last, because it answers every other path: the built UI's assets
    Mount("/", app=StaticFiles(directory=dist_path)),
]

app = Starlette(routes=routes, middleware=[Middleware(TokenGuard)])


# ---------------------------------------------------------------------------
# Starting up
# ---------------------------------------------------------------------------


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


def assert_single_process(workers):
    """Refuse to start with more than one worker.

    Jobs, terminals and handles are this process's memory. A second worker
    would answer requests with its own empty copy of them, and the symptom - a
    job that is there and then is not - reads like a bug in the job code rather
    than like a configuration someone added to "scale" the server. So the
    number is checked here, once, and anything above one is a refusal to start.
    """
    if workers != 1:
        raise RuntimeError(
            "pdrive runs in a single process: workers must be 1, got %r"
            % (workers,))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-H", "--host", default="127.0.0.1",
                   help="Host address to bind server to (default: 127.0.0.1). "
                        "Binding to anything but loopback generates a token "
                        "and prints the address that carries it")
    p.add_argument("-p", "--port", default=9999,
                   help="Host port to bind server to (default: 9999)")
    a = p.parse_args()
    configure_auth(a)
    print_banner(a)
    workers = 1
    assert_single_process(workers)
    uvicorn.run(app, host=a.host, port=int(a.port), workers=workers,
                log_level="warning", access_log=False)


if __name__ == '__main__':
    main()
