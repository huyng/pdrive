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
        return (
            <div className="preview-text-panel">
                <TextPreview node={node} />
            </div>
        )
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
            backdropClassName="preview-backdrop"
            bare
            onClose={onClose}
        >
            <div className={'preview-content preview-content-' + kind}>
                {node && <PreviewBody key={node.path} node={node} kind={kind} />}
            </div>

            <div className="preview-bar">
                <button
                    type="button"
                    className="preview-action"
                    title="Previous file"
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
                    title="Next file"
                    aria-label="Next file"
                    disabled={!hasNext}
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
