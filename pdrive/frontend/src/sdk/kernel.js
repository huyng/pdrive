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
// A topic is an address the kernel looks up again ("job:j_1a2b"), not a handle
// into one connection, so the socket can drop and come back without the page
// knowing: every topic still wanted is subscribed again on the new socket, and
// whatever happened while it was away arrives as the current state.

const RECONNECT_MIN = 500
const RECONNECT_MAX = 10000

const subscribers = new Map()   // topic -> Set of callbacks
const listeners = new Map()     // event name -> Set of callbacks

let socket = null
let keepOpen = false
let requestId = 0
let backoff = RECONNECT_MIN
let retryTimer = null
let everConnected = false
let status = 'closed'

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

// POST /api/jobs: start work that outlives the request and returns its id.
export async function startJob(kind, args = {}) {
    const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...args }),
    })
    return (await parseJson(response)).job
}

function emit(name, value) {
    for (const callback of listeners.get(name) ?? []) {
        callback(value)
    }
}

function setStatus(next) {
    if (status === next) {
        return
    }
    status = next
    emit('status', next)
}

function send(frame) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ ...frame, id: `r${++requestId}` }))
        return true
    }
    return false
}

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
        return socket
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    setStatus('connecting')
    socket = new WebSocket(`${scheme}://${window.location.host}/ws`)

    socket.onopen = () => {
        backoff = RECONNECT_MIN
        setStatus('open')
        for (const topic of subscribers.keys()) {
            send({ t: 'req', op: 'sub', topic })
        }
        if (everConnected) {
            emit('reconnect')
        }
        everConnected = true
    }

    socket.onmessage = (event) => {
        let frame
        try {
            frame = JSON.parse(event.data)
        } catch (err) {
            return
        }
        // `res` and `err` answer a request; only `event` carries news
        if (frame.t !== 'event') {
            return
        }
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
            send({ t: 'req', op: 'unsub', topic })
        }
    }
}

// 'reconnect' when a socket comes back after having been up, 'status' with
// 'connecting' | 'open' | 'closed' whenever that changes.
export function on(name, callback) {
    let callbacks = listeners.get(name)
    if (!callbacks) {
        callbacks = new Set()
        listeners.set(name, callbacks)
    }
    callbacks.add(callback)
    return () => callbacks.delete(callback)
}

export function connectionStatus() {
    return status
}

if (typeof window !== 'undefined') {
    // the browser knows before the backoff does
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
