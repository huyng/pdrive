// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect } from 'react'

// The keys the preview answers wherever it is shown. Left and right step through
// the previewable files of the folder, which is the one thing both frames want -
// unless the frame is a pane, which is the *listing's* neighbour: there the
// arrows still walk the listing, and the pane follows the file they land on. Two
// answers to one key would step twice, so a pane says `arrowKeys: false`.
//
// The other two belong to the frame. In a dialog the space bar closes what the
// space bar opened, and its `Modal` already answers Escape; a pane beside the
// listing was opened by something else, so space is not its key, but Escape is -
// nothing else on the page would close it.
export default function usePreviewKeys({
    enabled,
    arrowKeys = true,
    spaceCloses = false,
    escapeCloses = false,
    onClose,
    onPrev,
    onNext,
    hasPrev,
    hasNext,
}) {
    useEffect(() => {
        if (!enabled) {
            return undefined
        }
        const handleKeyDown = (event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) {
                return
            }
            // leave typing alone: the pane sits next to a listing that can have
            // a rename dialog on top of it
            const target = event.target
            if (target instanceof HTMLElement && (
                target.isContentEditable
                || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
            )) {
                return
            }
            if (spaceCloses && (event.key === ' ' || event.code === 'Space')) {
                // no scrolling of the listing behind, no click on a focused
                // button of the bar either
                event.preventDefault()
                onClose?.()
            } else if (escapeCloses && event.key === 'Escape') {
                event.preventDefault()
                onClose?.()
            } else if (arrowKeys && event.key === 'ArrowLeft' && hasPrev) {
                event.preventDefault()
                onPrev?.()
            } else if (arrowKeys && event.key === 'ArrowRight' && hasNext) {
                event.preventDefault()
                onNext?.()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [enabled, arrowKeys, spaceCloses, escapeCloses, hasPrev, hasNext, onClose, onPrev, onNext])
}
