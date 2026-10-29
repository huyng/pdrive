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

// The jobs the progress panel shows, as the kernel reports them.
//
// A job is tracked by its topic, not by the promise that started it: the page
// may reload, lose the network or reconnect, and the job is still there with
// the same id. So `track` takes a job id and nothing else is needed to render
// it - the label and the percentage that go on screen arrive from the kernel.

import { useEffect, useReducer, useState } from 'react'
import { connectionStatus, on, parseJson, startJob, subscribe } from './sdk/kernel.js'

// how long a finished job stays in the panel: long enough to be read, short
// enough not to become a list of everything that ever happened
const LINGER_MS = 2000

const jobs = new Map()
const listeners = new Set()
const watching = new Map()      // job id -> unsubscribe from its topic

function notify() {
    for (const listener of [...listeners]) {
        listener()
    }
}

function forget(jobId) {
    const stop = watching.get(jobId)
    if (stop) {
        stop()
        watching.delete(jobId)
    }
    jobs.delete(jobId)
    notify()
}

export function track(jobId, { label, onDone } = {}) {
    if (!jobs.has(jobId)) {
        jobs.set(jobId, {
            id: jobId,
            label: label ?? 'Working',
            state: 'running',
            progress: 0,
            settled: false,
        })
    }
    if (!watching.has(jobId)) {
        watching.set(jobId, subscribe(`job:${jobId}`, (data) => {
            const job = jobs.get(jobId)
            if (!job) {
                return
            }
            Object.assign(job, data)
            notify()
            if (job.settled) {
                return
            }
            if (job.state === 'running') {
                return
            }
            job.settled = true
            onDone?.(job)
            setTimeout(() => forget(jobId), LINGER_MS)
        }))
    }
    notify()
    return jobId
}

// Everything the kernel knows about is gone after a restart, and the panel must
// not keep showing work that no longer exists.
on('reconnect', async () => {
    try {
        const response = await fetch('/api/jobs')
        const live = new Set((await parseJson(response)).jobs.map((job) => job.id))
        for (const jobId of [...jobs.keys()]) {
            if (!live.has(jobId)) {
                forget(jobId)
            }
        }
    } catch (err) {
        console.error('could not list jobs after reconnecting', err)
    }
})

export function useJobs() {
    const [, bump] = useReducer((count) => count + 1, 0)
    useEffect(() => {
        listeners.add(bump)
        return () => listeners.delete(bump)
    }, [])
    return [...jobs.values()]
}

export function useConnection() {
    const [status, setStatus] = useState(connectionStatus())
    useEffect(() => on('status', setStatus), [])
    return status
}

export { startJob }
