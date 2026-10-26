// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Minimal modal dialog: rendered into document.body, closes on Escape or on a
// click on the backdrop.
export default function Modal({ open, title, onClose, footer, className, children }) {
    // keep the latest callback without re-running the effect below: it must not
    // re-run on every render, or the cleanup would steal focus from the dialog
    const onCloseRef = useRef(onClose)
    useEffect(() => {
        onCloseRef.current = onClose
    }, [onClose])

    useEffect(() => {
        if (!open) {
            return undefined
        }
        const previouslyFocused = document.activeElement
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation()
                onCloseRef.current()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
                previouslyFocused.focus()
            }
        }
    }, [open])

    if (!open) {
        return null
    }

    const handleBackdropMouseDown = (event) => {
        if (event.target === event.currentTarget) {
            onClose()
        }
    }

    return createPortal(
        <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown}>
            <div className={'modal' + (className ? ' ' + className : '')} role="dialog" aria-modal="true" aria-label={title}>
                <div className="modal-header">
                    <h2 className="modal-title">{title}</h2>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>,
        document.body
    )
}
