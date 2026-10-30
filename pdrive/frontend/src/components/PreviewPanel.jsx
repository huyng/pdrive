// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import FileIcon from './FileIcon.jsx'
import { viewerFor, viewersFor } from '../apps/filefinder/viewers/index.js'
import { formatSize } from '../utils.js'

// The preview itself: the stage a viewer draws on, and the bar under it.
//
// It is written once because it appears in two frames - a dialog over the
// listing and a pane beside it - and the two must not drift apart. Everything
// that depends on the frame (backdrop, how it closes, where the keyboard goes)
// belongs to the host, not here.
//
// What is shown when no viewer claims the file is kept here rather than being a
// viewer of its own: it is not a way of showing a file, it is the absence of one.
function Unsupported({ node }) {
    return (
        <div className="preview-placeholder">
            <FileIcon node={node} size={48} />
            No preview available for this file type.
        </div>
    )
}

// `barFirst` is where the controls go. A dialog puts them under the stage, the
// way a picture frame carries its caption; a pane puts them on top, the way a
// panel carries its header. The order is the DOM's, not the stylesheet's, so the
// tab order follows what the eye sees.
export default function PreviewPanel({
    node,
    view = null,
    onView,
    onClose,
    onDownload,
    onPrev,
    onNext,
    hasPrev,
    hasNext,
    barFirst = false,
}) {
    // The viewer decides the body; the panel does not know or care whether that
    // is an image, a PDF or a text file. `kind` is the CSS hook, so a new viewer
    // can style its own stage without touching this file.
    const viewer = node ? viewerFor(node, view) : null
    const kind = viewer ? viewer.id : 'unsupported'
    const Body = viewer ? viewer.Component : null

    // Where more than one viewer claims the file - a markdown file is also text -
    // the bar offers the next of them. One control and not a menu: two readings
    // of one document is a switch, and a menu to choose between two things is a
    // menu that has to be opened to be understood.
    const views = node ? viewersFor(node) : []
    const at = views.findIndex((candidate) => candidate.id === kind)
    const other = views.length > 1 ? views[(at + 1) % views.length] : null

    const stage = (
        <div className={'preview-content preview-content-' + kind}>
            {node && (Body
                ? <Body key={node.path} node={node} />
                : <Unsupported node={node} />)}
        </div>
    )

    const bar = (
        <div className="preview-bar">
            <button
                type="button"
                className="preview-action"
                data-tip="Previous file"
                aria-label="Previous file"
                disabled={!hasPrev}
                onClick={onPrev}
            >
                <i className="material-icons md-18">chevron_left</i>
            </button>
            <div className="preview-caption">
                <span className="preview-name" title={node ? node.name : ''}>{node ? node.name : ''}</span>
                {node && (
                    <span className="preview-detail">
                        {node.type === 'file' ? formatSize(node) : '--'} · {node.mtime}
                    </span>
                )}
            </div>
            <button
                type="button"
                className="preview-action"
                data-tip="Next file"
                aria-label="Next file"
                disabled={!hasNext}
                onClick={onNext}
            >
                <i className="material-icons md-18">chevron_right</i>
            </button>
            {other && (
                <button
                    type="button"
                    className="preview-action"
                    data-tip={'Show as ' + other.name}
                    aria-label={'Show as ' + other.name}
                    onClick={() => onView(other.id)}
                >
                    <i className="material-icons md-18">{other.icon || 'visibility'}</i>
                </button>
            )}
            <span className="preview-bar-divider" />
            <button
                type="button"
                className="preview-action"
                data-tip="Download"
                aria-label="Download"
                onClick={onDownload}
            >
                <i className="material-icons md-18">file_download</i>
            </button>
            <button
                type="button"
                className="preview-action"
                data-tip="Close"
                aria-label="Close"
                onClick={onClose}
            >
                <i className="material-icons md-18">close</i>
            </button>
        </div>
    )

    return <>{barFirst ? bar : stage}{barFirst ? stage : bar}</>
}
