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

// Thin wrapper around the Flask API exposed by pdrive/backend/web.py

async function parseJson(response) {
    if (!response.ok) {
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

const TEXT_PREVIEW_MAX_BYTES = 64 * 1024

// Reads the beginning of a file for the text preview. A Range request is used
// so that huge files (logs!) never get pulled into the browser in full.
export async function fetchTextPreview(path, maxBytes = TEXT_PREVIEW_MAX_BYTES) {
    const response = await fetch(serveUrl(path), {
        headers: { Range: 'bytes=0-' + (maxBytes - 1) },
    })
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

// POST /api with a JSON payload describing a filesystem command
// (ls, trash, mv, cp, mkdir). The backend reads it from the `payload` form field.
export async function postCommand(payload) {
    const body = new URLSearchParams({ payload: JSON.stringify(payload) })
    return parseJson(await fetch('/api', { method: 'POST', body }))
}

// POST /upload as multipart form data. XMLHttpRequest is used instead of fetch
// because it exposes upload progress events.
export function uploadFile(file, basedir, { onProgress, onDone, onError } = {}) {
    const xhr = new XMLHttpRequest()
    const form = new FormData()

    xhr.open('POST', '/upload', true)
    xhr.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
            onProgress((event.loaded / event.total) * 100)
        }
    }
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
