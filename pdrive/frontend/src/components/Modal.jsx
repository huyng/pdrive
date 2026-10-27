// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Minimal modal dialog: rendered into document.body, closes on Escape or on a
// click on the backdrop. A `bare` dialog gets no header or footer of its own,
// the content brings all the chrome it needs.
//
// `closeDelay` keeps the dialog mounted for that many milliseconds after it
// closed, which gives a CSS exit animation the time to play; it has to match
// the duration of the animation in the stylesheet.
export default function Modal({ open, title, onClose, footer, className, backdropClassName, closeDelay = 0, bare = false, children }) {
    const [mounted, setMounted] = useState(open)
    // the dialog is on its way out: it is still in the DOM but fading away
    const closing = mounted && !open && closeDelay > 0
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

    useEffect(() => {
        if (open) {
            setMounted(true)
            return undefined
        }
        if (!mounted || closeDelay <= 0) {
            return undefined
        }
        const timer = setTimeout(() => setMounted(false), closeDelay)
        return () => clearTimeout(timer)
    }, [open, mounted, closeDelay])

    if (!open && !closing) {
        return null
    }

    const handleBackdropMouseDown = (event) => {
        if (event.target === event.currentTarget) {
            onClose()
        }
    }

    return createPortal(
        <div
            className={'modal-backdrop'
                + (backdropClassName ? ' ' + backdropClassName : '')
                + (closing ? ' is-closing' : '')}
            onMouseDown={handleBackdropMouseDown}
        >
            <div className={'modal' + (className ? ' ' + className : '')} role="dialog" aria-modal="true" aria-label={title}>
                {bare ? children : (
                    <>
                        <div className="modal-header">
                            <h2 className="modal-title">{title}</h2>
                        </div>
                        <div className="modal-body">{children}</div>
                        {footer && <div className="modal-footer">{footer}</div>}
                    </>
                )}
            </div>
        </div>,
        document.body
    )
}
