// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// The transport between the page and the kernel: HTTP for a question, one
// WebSocket for everything that keeps moving.
//
// Both halves are here because they are one decision. A command either finishes
// inside its request and answers it, or it becomes a job whose answer arrives
// later on a topic - and the caller should not have to know which: api.js asks
// for what it wants, and this module knows whether that is a POST or a
// subscription.
//
// Nothing above this file knows about sockets, ids, frames or reconnection;
// nothing below it knows about files, listings or jobs.
//
//   HTTP     POST /api/cmd   {command, ...args} -> the command's answer
//            POST /api/jobs  {kind, ...args}    -> {job: "j_1a2b3c4d"}
//
//   socket   client -> kernel  {"t":"req","id":"r1","op":"sub","topic":"..."}
//                              {"t":"req","id":"r2","op":"unsub","topic":"..."}
//            kernel -> client  {"t":"res","id":"r1","ok":true}
//                              {"t":"err","id":"r2","code":"...","msg":"..."}
//                              {"t":"event","topic":"...","d":{...}}
//
// A topic ("job:j_1a2b3c4d") is an address the kernel looks up again, not a
// handle into one connection: the socket can drop and come back without the
// page noticing, because every topic still wanted is subscribed again on the
// new socket and the kernel answers a subscription with the current state. That
// is why no state here is per-connection, and why a reconnect is not something
// the components have to handle.

const RECONNECT_MIN = 500
const RECONNECT_MAX = 10000

// What the page wants from the kernel, by topic; a topic stays wanted until
// every callback watching it has gone. Kept across reconnects: it is the list
// of subscriptions the next socket has to carry.
const subscribers = new Map()   // topic -> Set of callbacks

// Everyone watching this module rather than the kernel: 'status' (the socket
// went connecting/open/closed) and 'reconnect' (it came back after being up).
const listeners = new Map()     // event name -> Set of callbacks

// The state of the one socket, and of the attempt to have one:
let socket = null            // the open WebSocket, or null while there is none
let keepOpen = false         // connect() was called: retry even with no topics
let requestId = 0            // every frame gets an id, so answers can be matched
let backoff = RECONNECT_MIN  // how long the next attempt waits
let retryTimer = null        // the pending attempt, if there is one
let everConnected = false    // whether a reconnect would be a re-connect
let status = 'closed'        // 'connecting' | 'open' | 'closed'

// ---------------------------------------------------------------------------
// Answers that arrive in the request
// ---------------------------------------------------------------------------

// Every response goes through here, so that a refusal looks the same wherever
// it comes from: an Error with the status and the body's own explanation.
export async function parseJson(response) {
    if (!response.ok) {
        // A 401 means this browser is not carrying a valid token. There is no
        // login screen to send the user to: the token is printed by the server,
        // so the address it printed is the way back in.
        const error = new Error(`${response.status} ${response.statusText}`)
        error.status = response.status
        // a refusal can say why ("these items exist", "not a zip archive"), and
        // the caller is expected to show that instead of the status line
        try {
            error.payload = await response.json()
        } catch (err) {
            error.payload = null
        }
        throw error
    }
    return response.json()
}

// POST /api/cmd. The command and its arguments travel as one JSON object, so a
// caller passes what it used to pass to `postCommand` and nothing changes at
// the call sites.
export async function request(command, args = {}) {
    const response = await fetch('/api/cmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, ...args }),
    })
    return parseJson(response)
}

// A job id the page can choose before it has anything to ask: an upload needs
// to be watched while its bytes are still on the way, and the kernel only mints
// ids for the requests that answer it in one piece.
export function newJobId() {
    const bytes = crypto.getRandomValues(new Uint8Array(4))
    return 'j_' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// POST /api/jobs: start work that outlives the request and returns its id. What
// the work produces arrives on `job:<id>`; jobs.js is what watches it.
export async function startJob(kind, args = {}) {
    const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...args }),
    })
    return (await parseJson(response)).job
}

// ---------------------------------------------------------------------------
// The socket
// ---------------------------------------------------------------------------

// Tell whoever is listening - components, and jobs.js - that something about
// this module changed. Copying the set first, because a listener is allowed to
// stop listening (or start) while it runs.
function emit(name, value) {
    for (const callback of listeners.get(name) ?? []) {
        callback(value)
    }
}

// Only report a change: 'closed' followed by 'closed' would make every
// listener that re-renders do it twice for nothing.
function setStatus(next) {
    if (status === next) {
        return
    }
    status = next
    emit('status', next)
}

// Send one frame, if there is a socket to send it on. The answer is what
// decides whether the caller has to remember the frame and repeat it later:
// subscriptions are re-sent on open, so their failure here is harmless, while a
// caller that depended on this frame has to hear about it.
function send(frame) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ ...frame, id: `r${++requestId}` }))
        return true
    }
    return false
}

// Wait, then try again. The wait doubles up to ten seconds: a server that is
// restarting is back in a second or two, and a laptop that has closed its lid
// should not wake up to a thousand queued attempts.
function scheduleReconnect() {
    // unless the page asked for a connection in the first place, nothing is
    // waiting on this socket and there is no reason to keep trying
    if (retryTimer || (!keepOpen && subscribers.size === 0)) {
        return
    }
    retryTimer = setTimeout(() => {
        retryTimer = null
        open()
    }, backoff)
    backoff = Math.min(backoff * 2, RECONNECT_MAX)
}

function open() {
    if (socket) {
        // already connecting or open: there is nothing to do
        return socket
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    setStatus('connecting')
    socket = new WebSocket(`${scheme}://${window.location.host}/ws`)

    socket.onopen = () => {
        backoff = RECONNECT_MIN
        setStatus('open')
        // A new socket knows nothing: every topic the page still wants is
        // subscribed again, and the kernel answers each one with its current
        // state, so nothing that happened while we were away is lost.
        for (const topic of subscribers.keys()) {
            send({ t: 'req', op: 'sub', topic })
        }
        if (everConnected) {
            // for whoever holds state the kernel no longer has (jobs.js drops
            // the jobs of a previous process)
            emit('reconnect')
        }
        everConnected = true
    }

    socket.onmessage = (event) => {
        let frame
        try {
            frame = JSON.parse(event.data)
        } catch (err) {
            // a frame we cannot read is one we cannot act on; the socket is
            // still fine, so this is not a reason to drop it
            return
        }
        // `res` and `err` answer a request; only `event` carries news
        if (frame.t !== 'event') {
            return
        }
        // copy: a callback may unsubscribe itself while it is being called
        for (const callback of [...(subscribers.get(frame.topic) ?? [])]) {
            callback(frame.d)
        }
    }

    socket.onclose = () => {
        socket = null
        setStatus('closed')
        scheduleReconnect()
    }

    return socket
}

// Open the transport for the life of the page, whether or not anything is
// subscribed yet: a page that only finds out the kernel is gone when it asks is
// a page that shows a broken listing instead of a reconnecting one.
export function connect() {
    keepOpen = true
    open()
}

// Watch a topic. The returned function stops watching; the connection stays
// open, because the next question is only a request away.
//
// Several callbacks may want the same topic (two windows on the same job), so
// the kernel is told about a topic once and told again only when the last
// callback for it has gone.
export function subscribe(topic, callback) {
    let callbacks = subscribers.get(topic)
    const first = !callbacks
    if (first) {
        callbacks = new Set()
        subscribers.set(topic, callbacks)
    }
    callbacks.add(callback)
    if (first && socket && socket.readyState === WebSocket.OPEN) {
        send({ t: 'req', op: 'sub', topic })
    } else if (!socket) {
        open()
    }
    return () => {
        const watched = subscribers.get(topic)
        if (!watched) {
            return
        }
        watched.delete(callback)
        if (watched.size === 0) {
            subscribers.delete(topic)
            // if the socket is gone this frame goes nowhere, which is correct:
            // the topic is not in `subscribers` any more, so the next socket
            // will not ask for it either
            send({ t: 'req', op: 'unsub', topic })
        }
    }
}

// 'reconnect' when a socket comes back after having been up, 'status' with
// 'connecting' | 'open' | 'closed' whenever that changes. Both return the
// function that stops listening, which is what a React effect returns.
export function on(name, callback) {
    let callbacks = listeners.get(name)
    if (!callbacks) {
        callbacks = new Set()
        listeners.set(name, callbacks)
    }
    callbacks.add(callback)
    return () => callbacks.delete(callback)
}

// The current state without subscribing: for the first render, before any
// status event has arrived.
export function connectionStatus() {
    return status
}

// ---------------------------------------------------------------------------
// What the browser knows before we do
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
    // Coming back from a dropped network can be seen at once, while the backoff
    // may be halfway through a ten second wait for no reason.
    window.addEventListener('online', () => {
        if (!retryTimer) {
            return
        }
        clearTimeout(retryTimer)
        retryTimer = null
        backoff = RECONNECT_MIN
        open()
    })
}
