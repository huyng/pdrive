// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useState } from 'react'

import { fetchTextPreview } from '../../../api.js'
import { formatSize } from '../../../utils.js'

// Reading the beginning of a file, the one way every reader of text does it.
//
// The text preview and the markdown preview show the same 64 KiB slice of the
// same file; what they make of it differs. So the fetch, the four things that
// can go wrong with it and the sentence about what was cut live here, and each
// preview draws its own body from what this returns.

// The states: loading, error, binary, empty, or ready with text.
export function useTextSlice(node) {
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

    return state
}

// Whether there is a body to draw, as opposed to something to say about why
// there is none.
export function hasText(state) {
    return state.status === 'ready' && !state.binary && state.text !== ''
}

// Loading, unreadable, not text at all, or nothing in it.
export function SliceMessage({ state }) {
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
    return <div className="preview-placeholder">This file is empty.</div>
}

// The line at the end of a body that is not the whole file. A document that was cut
// has to say so, or its last paragraph reads as its last paragraph - and it says it
// where the text stops, under the text, rather than over the first line of a page
// nobody has read yet.
export function TruncationNote({ state }) {
    if (!state.truncated) {
        return null
    }
    return (
        <p className="preview-note">
            Showing the first {formatSize({ type: 'file', size: state.shownBytes })} of{' '}
            {formatSize({ type: 'file', size: state.totalBytes })}.
        </p>
    )
}
