// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

export default function ContextMenu({ visible, x, y, visibility, onPreview, onCopy, onCopyPath, onRename, onDownload, onDelete }) {
    if (!visible) {
        return null
    }
    return (
        <div className="contextual-menu" style={{ top: y + 'px', left: x + 'px' }}>
            {visibility.preview && onPreview && (
                <div onClick={onPreview}>
                    <i className="material-icons md-18">remove_red_eye</i> Preview
                </div>
            )}
            {visibility.copy && (
                <div onClick={onCopy}>
                    <i className="material-icons md-18">content_copy</i> Duplicate
                </div>
            )}
            {visibility.rename && (
                <div onClick={onRename}>
                    <i className="material-icons md-18">edit</i> Rename
                </div>
            )}
            {visibility.copyPath && (
                <div onClick={onCopyPath}>
                    <i className="material-icons md-18">link</i> Copy path to clipboard
                </div>
            )}
            {visibility.download && (
                <div onClick={onDownload}>
                    <i className="material-icons md-18">file_download</i> Download
                </div>
            )}
            {visibility.delete && (
                <div className="contextual-menu-separator" onClick={onDelete}>
                    <i className="material-icons md-18">delete</i> Delete
                </div>
            )}
        </div>
    )
}
