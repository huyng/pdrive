// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useState } from 'react'

import Modal from './Modal.jsx'
import { fetchTextPreview, serveUrl } from '../api.js'
import { formatSize, previewKind } from '../utils.js'

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
        return <TextPreview node={node} />
    default:
        return (
            <div className="preview-placeholder">
                <i className="material-icons">insert_drive_file</i>
                No preview available for this file type.
            </div>
        )
    }
}

export default function PreviewDialog({ open, node, onClose, onDownload, onPrev, onNext, hasPrev, hasNext }) {
    // left/right step through the previewable files of the current folder
    useEffect(() => {
        if (!open) {
            return undefined
        }
        const handleKeyDown = (event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) {
                return
            }
            if (event.key === 'ArrowLeft' && hasPrev) {
                event.preventDefault()
                onPrev?.()
            } else if (event.key === 'ArrowRight' && hasNext) {
                event.preventDefault()
                onNext?.()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [open, hasPrev, hasNext, onPrev, onNext])

    const kind = node ? previewKind(node) : 'unsupported'

    return (
        <Modal
            open={open && Boolean(node)}
            title={node ? node.name : ''}
            className="modal-preview"
            onClose={onClose}
            footer={(
                <>
                    <div className="preview-nav">
                        <button type="button" className="btn" disabled={!hasPrev} onClick={onPrev}>
                            <i className="material-icons md-18">chevron_left</i> Prev
                        </button>
                        <button type="button" className="btn" disabled={!hasNext} onClick={onNext}>
                            Next <i className="material-icons md-18">chevron_right</i>
                        </button>
                    </div>
                    <div className="preview-actions">
                        <button type="button" className="btn" onClick={onDownload}>
                            <i className="material-icons md-18">file_download</i> Download
                        </button>
                        <button type="button" className="btn" onClick={onClose}>
                            Close
                        </button>
                    </div>
                </>
            )}
        >
            {node && (
                <div className="preview-meta">
                    {node.type === 'file' ? formatSize(node) : '--'} · {node.mtime}
                </div>
            )}
            {node && <PreviewBody key={node.path} node={node} kind={kind} />}
        </Modal>
    )
}
