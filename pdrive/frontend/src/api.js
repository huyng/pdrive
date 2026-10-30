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

// The file API, as the components know it: listing, inline and download URLs,
// the text preview and the commands. Requests and their answers are shaped by
// src/sdk/kernel.js, so a caller keeps asking for what it wants instead of
// knowing which of the two transports carries it.

import { parseJson, request } from './sdk/kernel.js'

// GET /api -> { basedir, cwd, nodes }
export async function fetchListing() {
    return parseJson(await fetch('/api'))
}

// Inline file URLs. The path is encoded: file names routinely contain spaces,
// '#', '?' and '&', all of which would otherwise break the query string.
export function serveUrl(path) {
    return '/serve?file=' + encodeURIComponent(path)
}

export function downloadUrl(path) {
    return '/download?file=' + encodeURIComponent(path)
}

// Inline URL for a page: a file the browser is asked to *run*, not to show.
//
// The path is the URL's path, not a query string, because a page is a document
// with neighbours: `logo.png` or `style.css` next to it resolve to
// `/preview/…/logo.png` and come back to the same route. The response is
// sandboxed by the server, so the page gets an origin of its own and cannot
// call this app's API - see `preview_file` in the backend.
export function previewUrl(path) {
    return '/preview' + path.split('/').map(encodeURIComponent).join('/')
}

// Two megabytes: enough that an ordinary source file, note, config or export is
// shown whole, and small enough that the string, the text node and the layout it
// costs stay in the range a browser handles without a pause. It is a preview, not
// a reader - the bar's download button is there for the rest of a big file.
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

// Reads the beginning of a file for the text preview. A Range request is used
// so that huge files (logs!) never get pulled into the browser in full.
export async function fetchTextPreview(path, maxBytes = TEXT_PREVIEW_MAX_BYTES) {
    const response = await fetch(serveUrl(path), {
        headers: { Range: 'bytes=0-' + (maxBytes - 1) },
    })
    // A file of no bytes answers 416 to a range request. That is the whole of the
    // answer and not a failure of the read: there is nothing there, and the
    // preview says so in its own words instead of reporting an error.
    if (response.status === 416) {
        return { text: '', binary: false, truncated: false, shownBytes: 0, totalBytes: 0 }
    }
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    // a NUL byte in the first kilobyte is a good enough "not text" signal
    const binary = bytes.subarray(0, 1024).includes(0)

    let total = null
    const contentRange = response.headers.get('Content-Range')  // bytes 0-65535/123456
    if (contentRange) {
        const parsed = Number(contentRange.split('/')[1])
        total = Number.isFinite(parsed) ? parsed : null
    }

    return {
        text: binary ? '' : new TextDecoder('utf-8').decode(bytes),
        binary,
        truncated: total !== null && total > bytes.length,
        shownBytes: bytes.length,
        totalBytes: total,
    }
}

// A filesystem command (ls, trash, mv, cp, mkdir, zip, unzip). The object keeps
// the shape the call sites already build, `command` first.
export async function postCommand(payload) {
    const { command, ...args } = payload
    return request(command, args)
}

// POST /upload as multipart form data. XMLHttpRequest is still used because the
// upload has to be sendable while the page keeps working, but the progress it
// can report is no longer read: the bytes are counted by the kernel, which
// publishes them on the job the page opened for this upload.
export function uploadFile(file, basedir, { job, onDone, onError } = {}) {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    const query = job
        ? `?job=${encodeURIComponent(job)}&name=${encodeURIComponent(file.name)}`
        : ''

    xhr.open('POST', '/upload' + query, true)
    xhr.onload = () => {
        if (xhr.status !== 200) {
            onError?.(new Error(`upload failed with status ${xhr.status}`))
            return
        }
        try {
            onDone?.(JSON.parse(xhr.responseText))
        } catch (err) {
            onError?.(err)
        }
    }
    xhr.onerror = () => onError?.(new Error('upload failed'))

    form.append('file', file)
    form.append('basedir', basedir)
    xhr.send(form)

    return xhr
}
