// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useState } from 'react'

import { fetchTextPreview } from '../../../api.js'
import { formatSize, previewKind } from '../../../utils.js'

// The last viewer in the list and the widest: whatever reads as text. It is
// also the one that has to be careful, because "text" includes the 2 GB log and
// the file that only claims to be text - so it reads a slice (`fetchTextPreview`
// asks for the first 64 KiB with a Range request) and believes the NUL byte
// that says the slice is not text after all.
function TextBody({ node }) {
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

export default {
    id: 'text',
    name: 'Text',
    matches: (node) => previewKind(node) === 'text',
    Component: ({ node }) => (
        <div className="preview-text-panel">
            <TextBody node={node} />
        </div>
    ),
}
