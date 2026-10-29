// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useState } from 'react'
import Progress from './Progress.jsx'
import { truncate } from '../utils.js'
import { useConnection, useJobs } from '../jobs.js'

// What the kernel is working on, as it reports itself. Nothing here starts or
// keeps track of work: a job shows up because the page opened it, and it goes
// away on its own when the kernel says it is done.
export default function JobProgressPanel() {
    const jobs = useJobs()
    const connection = useConnection()
    const [dismissed, setDismissed] = useState(0)
    // a new job brings the panel back even if the last one was closed
    const latest = Math.max(0, ...jobs.map((job) => job.created ?? 0))
    const offline = connection !== 'open'

    if (jobs.length === 0 && !offline) {
        return null
    }
    if (dismissed === latest && !offline) {
        return null
    }
    return (
        <div className="job-progress">
            <div className="job-progress-header">
                <div style={{ float: 'left' }}>Jobs</div>
                <div style={{ float: 'right', cursor: 'pointer' }}
                     onClick={() => setDismissed(latest)}>
                    <i className="material-icons md-18">close</i>
                </div>
                <div style={{ clear: 'both' }}></div>
            </div>
            {offline && (
                <div className="job-progress-task">
                    disconnected - reconnecting
                </div>
            )}
            {jobs.map((job) => (
                <div className="job-progress-task" key={job.id}>
                    {truncate(job.label ?? '', 30)}
                    <Progress percent={(job.progress ?? 0) * 100} />
                </div>
            ))}
        </div>
    )
}
