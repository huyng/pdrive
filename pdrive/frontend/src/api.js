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
        throw new Error(`${response.status} ${response.statusText}`)
    }
    return response.json()
}

// GET /api -> { basedir, cwd, nodes }
export async function fetchListing() {
    return parseJson(await fetch('/api'))
}

// POST /api with a JSON payload describing a filesystem command
// (ls, rm, mv, cp, mkdir). The backend reads it from the `payload` form field.
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
