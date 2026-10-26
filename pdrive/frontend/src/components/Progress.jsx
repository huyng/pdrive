// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

export default function Progress({ percent }) {
    const value = Math.max(0, Math.min(100, Math.round(percent) || 0))
    return (
        <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
        >
            <div className="progress-bar">
                <div className="progress-inner" style={{ width: `${value}%` }} />
            </div>
            <span className="progress-text">{value}%</span>
        </div>
    )
}
