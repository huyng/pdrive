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

"""The event transport: one socket per page, named topics on it.

HTTP is for asking one question and getting one answer. Everything that moves
on its own - job progress now, terminal output in phase 3, file changes in
phase 5 - is published to a topic instead, so that a page does not have to poll
and a job does not have to remember who is watching it.

A client subscribes by name ("job:j_1a2b") and never sees a socket id or a
connection count: the topic is the whole address, which is what lets the kernel
restart, the page reconnect and the same topic be picked up again.

`publish` is called from wherever the state changes. Every subscriber has its
own queue and one writer task, so a slow page cannot hold up a publisher: it
falls behind in its own queue and the kernel never awaits a socket.
"""

import asyncio
import json

from starlette.websockets import WebSocket
from starlette.websockets import WebSocketDisconnect

# The topic kinds that exist. A subscription to anything else is refused rather
# than silently accepted, because a socket that never says anything looks the
# same as work that never happened. Phase 3 adds "session:", phase 5 "file:".
TOPIC_PREFIXES = ("job:",)

# How much a single subscriber may fall behind before new events for it are
# dropped. A page that is this far behind is not going to catch up on stale
# progress bars anyway, and the next event carries the current state.
QUEUE_LIMIT = 256


def is_topic(topic):
    """Whether `topic` names something this kernel publishes."""
    if not isinstance(topic, str):
        return False
    for prefix in TOPIC_PREFIXES:
        if topic.startswith(prefix) and len(topic) > len(prefix):
            return True
    return False


class Subscriber:
    """One socket, the topics it asked for and the frames waiting for it."""

    def __init__(self, websocket):
        self.websocket = websocket
        self.topics = set()
        self.queue = asyncio.Queue(maxsize=QUEUE_LIMIT)

    def offer(self, message):
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:
            # dropping is better than stalling the publisher, and the client
            # gets a fresh snapshot the moment it subscribes again
            pass

    async def write_loop(self):
        while True:
            message = await self.queue.get()
            await self.websocket.send_json(message)


class Hub:

    def __init__(self):
        self._subscribers = {}

    def subscribe(self, subscriber, topic):
        self._subscribers.setdefault(topic, set()).add(subscriber)
        subscriber.topics.add(topic)

    def unsubscribe(self, subscriber, topic):
        subscribers = self._subscribers.get(topic)
        if subscribers is not None:
            subscribers.discard(subscriber)
            if not subscribers:
                del self._subscribers[topic]
        subscriber.topics.discard(topic)

    def forget(self, subscriber):
        for topic in list(subscriber.topics):
            self.unsubscribe(subscriber, topic)

    def publish(self, topic, data):
        """Send `data` to everyone watching `topic`. Never blocks."""
        for subscriber in tuple(self._subscribers.get(topic, ())):
            subscriber.offer({"t": "event", "topic": topic, "d": data})


hub = Hub()

# Filled in by whoever owns a topic kind: a function from topic to the state
# worth sending to a client that has just subscribed. Without it a page that
# subscribes after a job started would wait for the next progress tick and
# could miss a job that has already finished.
_snapshot_providers = []


def provide_snapshot(provider):
    """Register `provider(topic) -> dict | None` for snapshot-on-subscribe."""
    _snapshot_providers.append(provider)


def snapshot(topic):
    for provider in _snapshot_providers:
        data = provider(topic)
        if data is not None:
            return data
    return None


async def _reader(subscriber):
    """Answer the requests on one socket until it goes away."""
    websocket = subscriber.websocket
    while True:
        try:
            message = json.loads(await websocket.receive_text())
        except WebSocketDisconnect:
            break
        except (ValueError, TypeError):
            await websocket.send_json(
                {"t": "err", "id": None, "code": "bad_request",
                 "msg": "frames are JSON objects"})
            continue

        request_id = message.get("id") if isinstance(message, dict) else None
        if not isinstance(message, dict) or message.get("t") != "req":
            await websocket.send_json(
                {"t": "err", "id": request_id, "code": "bad_request",
                 "msg": "expected {\"t\": \"req\", ...}"})
            continue

        op = message.get("op")
        topic = message.get("topic")
        if op == "sub":
            if not is_topic(topic):
                await websocket.send_json(
                    {"t": "err", "id": request_id, "code": "bad_topic",
                     "msg": "no such topic: %s" % topic})
                continue
            hub.subscribe(subscriber, topic)
            await websocket.send_json(
                {"t": "res", "id": request_id, "ok": True})
            state = snapshot(topic)
            if state is not None:
                subscriber.offer({"t": "event", "topic": topic, "d": state})
        elif op == "unsub":
            hub.unsubscribe(subscriber, topic)
            await websocket.send_json(
                {"t": "res", "id": request_id, "ok": True})
        else:
            await websocket.send_json(
                {"t": "err", "id": request_id, "code": "bad_request",
                 "msg": "unknown op: %s" % op})


async def serve(websocket):
    """The `/ws` route: one socket, one reader, one writer."""
    await websocket.accept()
    subscriber = Subscriber(websocket)
    writer = asyncio.create_task(subscriber.write_loop())
    try:
        await _reader(subscriber)
    finally:
        # a page that closes a tab leaves its subscriptions behind otherwise,
        # and every job event would keep queueing for a socket nobody reads
        hub.forget(subscriber)
        writer.cancel()
