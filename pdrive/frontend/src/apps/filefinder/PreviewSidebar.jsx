// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useRef, useState } from 'react'

import PreviewPanel from '../../components/PreviewPanel.jsx'
import usePreviewKeys from '../../components/usePreviewKeys.js'

// How wide the pane is when nobody has said otherwise, and the range a drag may
// take it to. The upper bound has a second opinion at drag time: the listing has
// to keep a usable slice of the window whatever the pane was last set to.
const PREVIEW_WIDTH_KEY = 'pdrive.previewWidth'
const DEFAULT_WIDTH = 380
const MIN_WIDTH = 260
const MAX_WIDTH = 720
const LISTING_MIN_WIDTH = 360
const KEYBOARD_STEP = 16

function maxWidth() {
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - LISTING_MIN_WIDTH))
}

function clampWidth(width) {
    return Math.min(maxWidth(), Math.max(MIN_WIDTH, width))
}

function storedWidth() {
    try {
        const width = Number.parseInt(window.localStorage.getItem(PREVIEW_WIDTH_KEY), 10)
        return Number.isFinite(width) ? clampWidth(width) : DEFAULT_WIDTH
    } catch (err) {
        // private mode: no preference to read, so the default one
        return DEFAULT_WIDTH
    }
}

function rememberWidth(width) {
    try {
        window.localStorage.setItem(PREVIEW_WIDTH_KEY, String(width))
    } catch (err) {
        // nothing to remember it with; the session still works
    }
}

// The preview as a pane beside the listing: the same panel as the dialog, with
// the listing still there and still live next to it.
//
// It owns its own width, because that is the pane's business and nobody else's:
// a drag on the strip at its inner edge, remembered across reloads, and keyboard
// resize on the strip itself for anyone who cannot drag.
//
// It does not own the listing's selection, because the listing does: what the
// pane shows is the file the listing has selected, and the arrows in its bar
// move that selection with them. `FileFinder` keeps the two in step, since a
// pane showing one file and a highlight sitting on another is a pane that
// argues with its own listing.
export default function PreviewSidebar({ open, node, view, onView, onClose, onDownload, onPrev, onNext, hasPrev, hasNext }) {
    const [width, setWidth] = useState(storedWidth)
    const drag = useRef(null)

    usePreviewKeys({
        enabled: open && Boolean(node),
        // the arrows belong to the listing next door; this pane shows whatever
        // they land on, and its own chevrons answer the pointer
        arrowKeys: false,
        escapeCloses: true,
        onClose,
        onPrev,
        onNext,
        hasPrev,
        hasNext,
    })

    const resize = (next) => {
        const clamped = clampWidth(next)
        setWidth(clamped)
        rememberWidth(clamped)
        return clamped
    }

    const handleResizeStart = (event) => {
        if (event.button !== 0) {
            return
        }
        event.preventDefault()
        // the pointer leaves the strip immediately, and may cross a PDF's frame:
        // capture keeps the moves coming even then. It fails on a synthetic
        // event (no active pointer), which is fine - the drag then ends where
        // the pointer does.
        try {
            event.currentTarget.setPointerCapture(event.pointerId)
        } catch (err) {
            // not a live pointer; the drag still works while it stays here
        }
        drag.current = { startX: event.clientX, startWidth: width, lastWidth: width }
        // the whole window gets the cursor and loses text selection, so a drag
        // that ends outside the strip does not look like a normal one
        document.body.classList.add('resizing-preview')
    }

    const handleResizeMove = (event) => {
        if (!drag.current) {
            return
        }
        // the pane is on the right: dragging its edge left makes it wider
        const next = clampWidth(drag.current.startWidth + (drag.current.startX - event.clientX))
        drag.current.lastWidth = next
        setWidth(next)
    }

    const handleResizeEnd = (event) => {
        if (!drag.current) {
            return
        }
        const settled = drag.current.lastWidth
        drag.current = null
        document.body.classList.remove('resizing-preview')
        rememberWidth(settled)
        try {
            event.currentTarget.releasePointerCapture(event.pointerId)
        } catch (err) {
            // already released with the pointer
        }
    }

    const handleResizeKeyDown = (event) => {
        const step = event.key === 'ArrowLeft' ? KEYBOARD_STEP : event.key === 'ArrowRight' ? -KEYBOARD_STEP : 0
        if (step === 0) {
            return
        }
        // the pane answers the arrows too; a resize key is not a preview key
        event.preventDefault()
        event.stopPropagation()
        resize(width + step)
    }

    if (!open || !node) {
        return null
    }

    return (
        <aside
            className="preview-sidebar"
            style={{ '--preview-width': `${width}px` }}
            aria-label="Preview"
        >
            <div
                className="preview-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize preview"
                aria-valuenow={width}
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={maxWidth()}
                tabIndex={0}
                data-tip="Drag to resize, double-click for the default width"
                onPointerDown={handleResizeStart}
                onPointerMove={handleResizeMove}
                onPointerUp={handleResizeEnd}
                onPointerCancel={handleResizeEnd}
                onLostPointerCapture={handleResizeEnd}
                onDoubleClick={() => resize(DEFAULT_WIDTH)}
                onKeyDown={handleResizeKeyDown}
            />
            {/* The panel is one box that slides in, not a column of parts that
                are readjusted as the pane opens: the box around it is what
                changes width, and the panel keeps the width it is arriving at.
                `overflow` is left alone here so that the picture of it still
                sliding in is cut by the window's edge, not by its own frame. */}
            <div className="preview-slide">
                <PreviewPanel
                    node={node}
                    view={view}
                    onView={onView}
                    barFirst
                    onClose={onClose}
                    onDownload={onDownload}
                    onPrev={onPrev}
                    onNext={onNext}
                    hasPrev={hasPrev}
                    hasNext={hasNext}
                />
            </div>
        </aside>
    )
}
