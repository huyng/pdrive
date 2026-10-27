// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useRef, useState } from 'react'

import Modal from './Modal.jsx'
import FileIcon from './FileIcon.jsx'
import { fetchTextPreview, serveUrl } from '../api.js'
import { formatSize, previewKind } from '../utils.js'

// how long the dialog stays in the DOM while it fades out, in milliseconds;
// must match the exit animation in the stylesheet
const CLOSE_MS = 140

function TextPreview({ node }) {
    const [state, setState] = useState({ status: 'loading' })

    useEffect(() => {
        let cancelled = false
        setState({ status: 'loading' })
        fetchTextPreview(node.path)
            .then((result) => {
                if (!cancelled) {
                    setState({ status: 'ready', ...result })
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setState({ status: 'error', error: err })
                }
            })
        return () => {
            cancelled = true
        }
    }, [node.path])

    if (state.status === 'loading') {
        return <div className="preview-placeholder">Loading…</div>
    }
    if (state.status === 'error') {
        return (
            <div className="preview-placeholder">
                <i className="material-icons">error_outline</i>
                Could not read this file.
            </div>
        )
    }
    if (state.binary) {
        return (
            <div className="preview-placeholder">
                <i className="material-icons">visibility_off</i>
                This file does not look like text.
            </div>
        )
    }
    if (state.text === '') {
        return <div className="preview-placeholder">This file is empty.</div>
    }

    return (
        <>
            {state.truncated && (
                <p className="preview-note">
                    Showing the first {formatSize({ type: 'file', size: state.shownBytes })} of{' '}
                    {formatSize({ type: 'file', size: state.totalBytes })}.
                </p>
            )}
            <pre className="preview-text">{state.text}</pre>
        </>
    )
}

function PreviewBody({ node, kind }) {
    switch (kind) {
    case 'image':
        return <img className="preview-media" src={serveUrl(node.path)} alt={node.name} />
    case 'pdf':
        return <iframe className="preview-frame" src={serveUrl(node.path)} title={node.name} />
    case 'video':
        return <video className="preview-media" src={serveUrl(node.path)} controls />
    case 'audio':
        return <audio className="preview-media" src={serveUrl(node.path)} controls />
    case 'text':
        return (
            <div className="preview-text-panel">
                <TextPreview node={node} />
            </div>
        )
    default:
        return (
            <div className="preview-placeholder">
                <FileIcon node={node} size={48} />
                No preview available for this file type.
            </div>
        )
    }
}

export default function PreviewDialog({ open, node, onClose, onDownload, onPrev, onNext, hasPrev, hasNext }) {
    // The dialog outlives the node it shows by a few frames so that it can
    // animate out: keep the last file (and its position in the listing) around
    // for as long as it is still on screen.
    const lastShown = useRef({ node, hasPrev, hasNext })
    if (node) {
        lastShown.current = { node, hasPrev, hasNext }
    }
    const shown = node ?? lastShown.current.node
    const nav = node ? { hasPrev, hasNext } : lastShown.current

    // left/right step through the previewable files of the current folder,
    // the space bar closes the preview it opened
    useEffect(() => {
        if (!open) {
            return undefined
        }
        const handleKeyDown = (event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) {
                return
            }
            if (event.key === ' ' || event.code === 'Space') {
                // no scrolling of the listing behind, no click on a focused
                // button of the bar either
                event.preventDefault()
                onClose?.()
            } else if (event.key === 'ArrowLeft' && hasPrev) {
                event.preventDefault()
                onPrev?.()
            } else if (event.key === 'ArrowRight' && hasNext) {
                event.preventDefault()
                onNext?.()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [open, hasPrev, hasNext, onClose, onPrev, onNext])

    const kind = shown ? previewKind(shown) : 'unsupported'

    return (
        <Modal
            open={open && Boolean(node)}
            title={shown ? shown.name : ''}
            className="modal-preview"
            backdropClassName="preview-backdrop"
            closeDelay={CLOSE_MS}
            bare
            onClose={onClose}
        >
            <div className={'preview-content preview-content-' + kind}>
                {shown && <PreviewBody key={shown.path} node={shown} kind={kind} />}
            </div>

            <div className="preview-bar">
                <button
                    type="button"
                    className="preview-action"
                    title="Previous file"
                    aria-label="Previous file"
                    disabled={!nav.hasPrev}
                    onClick={onPrev}
                >
                    <i className="material-icons md-18">chevron_left</i>
                </button>
                <div className="preview-caption">
                    <span className="preview-name" title={shown ? shown.name : ''}>{shown ? shown.name : ''}</span>
                    {shown && (
                        <span className="preview-detail">
                            {shown.type === 'file' ? formatSize(shown) : '--'} · {shown.mtime}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    className="preview-action"
                    title="Next file"
                    aria-label="Next file"
                    disabled={!nav.hasNext}
                    onClick={onNext}
                >
                    <i className="material-icons md-18">chevron_right</i>
                </button>
                <span className="preview-bar-divider" />
                <button
                    type="button"
                    className="preview-action"
                    title="Download"
                    aria-label="Download"
                    onClick={onDownload}
                >
                    <i className="material-icons md-18">file_download</i>
                </button>
                <button
                    type="button"
                    className="preview-action"
                    title="Close"
                    aria-label="Close"
                    onClick={onClose}
                >
                    <i className="material-icons md-18">close</i>
                </button>
            </div>
        </Modal>
    )
}
