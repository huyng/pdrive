// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { basename } from '../utils.js'

// Shown while files from outside the browser are dragged over the window.
//
// It is a hint, not a drop target: it has `pointer-events: none` in the
// stylesheet so the folder under the cursor stays visible and reachable, and
// the drop itself is handled by the app (which decides the destination from
// the element under the pointer).
export default function UploadHint({ visible, target }) {
    if (!visible) {
        return null
    }
    return (
        <div className="upload-hint">
            <i className="material-icons">cloud_upload</i>
            <span>
                {target ? `Upload into “${basename(target)}”` : 'Drop to upload here'}
            </span>
        </div>
    )
}
