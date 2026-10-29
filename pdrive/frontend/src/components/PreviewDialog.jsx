// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useRef } from 'react'

import Modal from './Modal.jsx'
import PreviewPanel from './PreviewPanel.jsx'
import usePreviewKeys from './usePreviewKeys.js'

// how long the dialog stays in the DOM while it fades out, in milliseconds;
// must match the exit animation in the stylesheet
const CLOSE_MS = 140

// The preview as a dialog: a backdrop, the panel, and the way out (Escape from
// `Modal`, the space bar from the keys below). One of the two frames the panel
// can be shown in; the other is `PreviewSidebar`, and they differ in nothing but
// the frame.
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

    usePreviewKeys({
        enabled: open && Boolean(node),
        spaceCloses: true,
        onClose,
        onPrev,
        onNext,
        hasPrev: nav.hasPrev,
        hasNext: nav.hasNext,
    })

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
            <PreviewPanel
                node={shown}
                onClose={onClose}
                onDownload={onDownload}
                onPrev={onPrev}
                onNext={onNext}
                hasPrev={nav.hasPrev}
                hasNext={nav.hasNext}
            />
        </Modal>
    )
}
