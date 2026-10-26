// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import Progress from './Progress.jsx'
import { truncate } from '../utils.js'

export default function JobProgressPanel({ visible, tasks, onClose }) {
    if (!visible) {
        return null
    }
    return (
        <div className="job-progress">
            <div className="job-progress-header">
                <div style={{ float: 'left' }}>Uploading</div>
                <div style={{ float: 'right', cursor: 'pointer' }} onClick={onClose}>
                    <i className="material-icons md-18">close</i>
                </div>
                <div style={{ clear: 'both' }}></div>
            </div>
            {tasks.map((task) => (
                <div className="job-progress-task" key={task.id}>
                    {truncate(task.message, 30)}
                    <Progress percent={task.progress} />
                </div>
            ))}
        </div>
    )
}
