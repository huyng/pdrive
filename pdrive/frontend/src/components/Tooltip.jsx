// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useRef } from 'react'

// Tooltips for the controls whose function is a drawing rather than a word.
//
// One layer for the whole page, not a component wrapped around each button: a
// wrapper is an element in someone else's layout - a flex row in the header, the
// absolutely positioned strip of the pane, a table cell - and a tooltip may not
// move the thing it is describing. So a control opts in by carrying
// `data-tip="..."`, this layer watches the pointer and the keyboard, reads the
// text off whatever they are on, and draws a single bubble.
//
// The bubble is made by hand and hung on `document.body` rather than rendered by
// React: it is one element that appears, is moved across the window and is taken
// away again, it belongs to the window rather than to any app's tree (nothing
// between the control and the window can clip it that way), and there is nothing
// for a reconciler to reconcile. `Shell` mounts this once and it renders nothing.
//
// Deliberately not the native `title` attribute: that arrives after the browser's
// own delay, in the browser's own style, unstylable, and stuck to a corner of the
// element even when the element sits against the window's edge. The habits it
// does earn are kept - half a second of hovering, or a keyboard focus, and any
// use of the control takes it away again.
const HOVER_MS = 500        // a bubble under a passing pointer is noise
const GAP = 6               // between the control and the bubble
const MARGIN = 8            // the bubble never touches the window's edge
const ARROW = 8             // the little arrow's box
const TIP_ID = 'app-tooltip'

// How big the bubble will be, measured off-screen: the text decides the size, the
// size decides where the bubble fits, and that has to be known before it is put
// anywhere. The alternative - draw it hidden, measure, then move it - is a
// bubble that exists in the page while it is still nowhere in particular, and a
// tooltip is too small and too short-lived to be got wrong.
function measure(text) {
    const probe = document.createElement('div')
    probe.className = 'tooltip'
    probe.textContent = text
    probe.style.cssText = 'position: fixed; left: -9999px; top: 0; visibility: hidden'
    document.body.appendChild(probe)
    const size = { width: probe.offsetWidth, height: probe.offsetHeight }
    probe.remove()
    return size
}

// Where the bubble goes: under the control by default, over it when the window
// has run out below, and - for a control taller than the bubble, like the strip
// that runs the height of the pane - beside it, level with the pointer, since
// there is no "under" or "over" a thing that spans the window. At the window's
// edge the bubble is pushed inwards, and its arrow still points at the control.
function place(control, at, size) {
    const rect = control.getBoundingClientRect()
    const centre = rect.left + rect.width / 2
    const point = at || { x: centre, y: rect.top + rect.height / 2 }
    const roomBelow = window.innerHeight - MARGIN - (rect.bottom + GAP)
    const roomAbove = rect.top - GAP - MARGIN

    let edge = 'below'
    let left = centre - size.width / 2
    let top = rect.bottom + GAP

    if (roomBelow < size.height && roomAbove >= size.height) {
        edge = 'above'
        top = rect.top - GAP - size.height
    } else if (roomBelow < size.height && rect.height > size.height) {
        edge = 'right'
        left = rect.right + GAP
        if (left + size.width > window.innerWidth - MARGIN) {
            edge = 'left'
            left = rect.left - GAP - size.width
        }
        top = point.y - size.height / 2
    }

    left = Math.round(Math.min(Math.max(MARGIN, left), window.innerWidth - MARGIN - size.width))
    top = Math.round(Math.min(Math.max(MARGIN, top), window.innerHeight - MARGIN - size.height))
    return {
        edge,
        left,
        top,
        arrowX: Math.round(Math.min(Math.max(centre - left, ARROW), size.width - ARROW)),
        arrowY: Math.round(Math.min(Math.max(point.y - top, ARROW), size.height - ARROW)),
    }
}

export default function TooltipLayer() {
    // the control the pointer or the keyboard is on, and the bubble it is
    // describing: refs and not state, because neither is anything React has to
    // render - a tooltip is not part of the page's content
    const controlRef = useRef(null)
    const bubbleRef = useRef(null)
    const timerRef = useRef(0)
    // A click focuses a button too, and a button that was clicked does not need
    // to be told what it does. Only a focus that came from the keyboard (the
    // last key was Tab) gets a bubble without waiting.
    const keyedRef = useRef(false)
    // nothing to clean up if the layer is unmounted while a bubble is up
    const describedRef = useRef(null)

    useEffect(() => {
        const controlAt = (node) => (node instanceof Element ? node.closest('[data-tip]') : null)

        const withdraw = () => {
            if (bubbleRef.current) {
                bubbleRef.current.remove()
                bubbleRef.current = null
            }
            if (describedRef.current) {
                describedRef.current.removeAttribute('aria-describedby')
                describedRef.current = null
            }
        }
        const stopTimer = () => {
            clearTimeout(timerRef.current)
            timerRef.current = 0
        }
        const hide = () => {
            stopTimer()
            withdraw()
        }
        const show = (control, at) => {
            const text = control.getAttribute('data-tip') || ''
            // a control that has gone (the row it was in was reloaded away) has
            // nothing to describe, and neither has an empty one
            if (!text || !control.isConnected) {
                return
            }
            const box = place(control, at, measure(text))
            withdraw()
            const bubble = document.createElement('div')
            bubble.className = 'tooltip'
            bubble.id = TIP_ID
            bubble.setAttribute('role', 'tooltip')
            bubble.dataset.place = box.edge
            bubble.textContent = text
            bubble.style.left = `${box.left}px`
            bubble.style.top = `${box.top}px`
            bubble.style.setProperty('--arrow-x', `${box.arrowX}px`)
            bubble.style.setProperty('--arrow-y', `${box.arrowY}px`)
            document.body.appendChild(bubble)
            bubbleRef.current = bubble
            // the same sentence, in the place a screen reader looks for one, for
            // as long as the bubble is on screen
            control.setAttribute('aria-describedby', TIP_ID)
            describedRef.current = control
        }
        const enter = (control, delay, at) => {
            if (!control || control === controlRef.current) {
                return
            }
            controlRef.current = control
            stopTimer()
            timerRef.current = setTimeout(() => {
                timerRef.current = 0
                show(control, at)
            }, delay)
        }

        const handlePointerOver = (event) => {
            if (event.pointerType === 'touch') {
                return      // a finger cannot hover, and has no question to ask
            }
            const control = controlAt(event.target)
            if (control) {
                enter(control, HOVER_MS, { x: event.clientX, y: event.clientY })
            } else if (controlRef.current) {
                controlRef.current = null
                hide()
            }
        }
        const handlePointerOut = (event) => {
            const control = controlAt(event.target)
            if (!control || control !== controlRef.current) {
                return
            }
            // the pointer moving from a button onto its own icon has not left it
            const to = event.relatedTarget instanceof Element ? event.relatedTarget : null
            if (to && control.contains(to)) {
                return
            }
            controlRef.current = null
            hide()
        }
        const handleFocusIn = (event) => {
            const control = controlAt(event.target)
            if (keyedRef.current && control) {
                enter(control, 0)
            }
        }
        const handleFocusOut = (event) => {
            if (controlAt(event.target) === controlRef.current) {
                controlRef.current = null
                hide()
            }
        }
        // The bubble describes a moment, not a state: using the control, moving
        // the page under it, or leaving the window all end that moment.
        const handlePointerDown = () => {
            keyedRef.current = false
            hide()
        }
        const handleKeyDown = (event) => {
            keyedRef.current = event.key === 'Tab'
            if (event.key !== 'Tab') {
                hide()
            }
        }
        const handleDismiss = () => {
            controlRef.current = null
            hide()
        }

        document.addEventListener('pointerover', handlePointerOver)
        document.addEventListener('pointerout', handlePointerOut)
        document.addEventListener('pointerdown', handlePointerDown, true)
        document.addEventListener('focusin', handleFocusIn)
        document.addEventListener('focusout', handleFocusOut)
        document.addEventListener('keydown', handleKeyDown, true)
        // scrolling is what moves a control out from under its bubble: capture,
        // so the listing's own scrollbar counts as well as the window's
        window.addEventListener('scroll', handleDismiss, true)
        window.addEventListener('resize', handleDismiss)
        window.addEventListener('blur', handleDismiss)
        return () => {
            stopTimer()
            withdraw()
            document.removeEventListener('pointerover', handlePointerOver)
            document.removeEventListener('pointerout', handlePointerOut)
            document.removeEventListener('pointerdown', handlePointerDown, true)
            document.removeEventListener('focusin', handleFocusIn)
            document.removeEventListener('focusout', handleFocusOut)
            document.removeEventListener('keydown', handleKeyDown, true)
            window.removeEventListener('scroll', handleDismiss, true)
            window.removeEventListener('resize', handleDismiss)
            window.removeEventListener('blur', handleDismiss)
        }
    }, [])

    // everything this layer does is done to the page, not rendered into it
    return null
}
