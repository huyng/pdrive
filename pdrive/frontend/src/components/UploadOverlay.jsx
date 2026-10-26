// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

export default function UploadOverlay({ visible, onClose, onDrop, onDragLeave }) {
    if (!visible) {
        return null
    }
    return (
        <div
            className="upload-overlay"
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <div style={{ cursor: 'pointer' }}>
                <i className="material-icons md-48 md-light" onClick={onClose}>close</i>
            </div>
            <div className="upload-overlay-message">
                Drag your files here to upload
                <br />
                <i className="material-icons md-48">cloud_upload</i>
            </div>
        </div>
    )
}
