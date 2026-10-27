// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useCallback, useEffect, useRef, useState } from 'react'

// How far the pointer has to travel before a click turns into a drag.
const DRAG_THRESHOLD = 4

// Rubber-band selection for a container whose selectable children carry a
// `data-path` attribute (the rows of the list and the tiles of the grid).
//
// Returns the ref to put on the container, the rectangle to render while
// dragging (viewport coordinates, for a `position: fixed` overlay) and the two
// event handlers to spread on the container.
export default function useDragSelect({ selectedPaths, onSelect }) {
    const containerRef = useRef(null)
    const dragRef = useRef(null)
    const frameRef = useRef(0)
    const suppressClickRef = useRef(false)
    const [marquee, setMarquee] = useState(null)

    // Kept in refs so the document listeners can stay bound forever.
    const selectedPathsRef = useRef(selectedPaths)
    const onSelectRef = useRef(onSelect)
    useEffect(() => {
        selectedPathsRef.current = selectedPaths
    }, [selectedPaths])
    useEffect(() => {
        onSelectRef.current = onSelect
    }, [onSelect])

    const handleMouseDown = useCallback((event) => {
        if (event.button !== 0 || !containerRef.current) {
            return
        }
        const target = event.target
        // an icon is an <svg>, so this cannot ask for an HTMLElement
        if (!(target instanceof Element)) {
            return
        }
        if (target.closest('input, textarea, select, button, a')) {
            return
        }
        // filenames and icons start a move drag instead, see useDragMove
        if (target.closest('[data-drag-handle]')) {
            return
        }
        dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            additive: event.metaKey || event.ctrlKey || event.shiftKey,
            baseSelection: [...selectedPathsRef.current],
            active: false,
            items: null,
            bounds: null,
        }
        // stops text selection / native image dragging while the button is held
        event.preventDefault()
    }, [])

    const handleClickCapture = useCallback((event) => {
        // the click that ends a drag must not reset the selection
        if (!suppressClickRef.current) {
            return
        }
        suppressClickRef.current = false
        event.stopPropagation()
        event.preventDefault()
    }, [])

    useEffect(() => {
        const activate = (drag) => {
            const container = containerRef.current
            drag.active = true
            drag.bounds = container.getBoundingClientRect()
            // The listing does not scroll during a drag, so measuring once is
            // enough and keeps the per-frame work to simple comparisons.
            drag.items = Array.from(container.querySelectorAll('[data-path]')).map((el) => ({
                path: el.dataset.path,
                rect: el.getBoundingClientRect(),
            }))
            document.body.classList.add('drag-selecting')
        }

        const update = (x, y) => {
            const drag = dragRef.current
            if (!drag || !drag.active) {
                return
            }
            const left = Math.min(Math.max(Math.min(drag.startX, x), drag.bounds.left), drag.bounds.right)
            const top = Math.min(Math.max(Math.min(drag.startY, y), drag.bounds.top), drag.bounds.bottom)
            const right = Math.min(Math.max(Math.max(drag.startX, x), drag.bounds.left), drag.bounds.right)
            const bottom = Math.min(Math.max(Math.max(drag.startY, y), drag.bounds.top), drag.bounds.bottom)

            setMarquee({ left, top, width: right - left, height: bottom - top })

            const hits = drag.items
                .filter((item) => (
                    item.rect.left < right
                    && item.rect.right > left
                    && item.rect.top < bottom
                    && item.rect.bottom > top
                ))
                .map((item) => item.path)

            const next = drag.additive ? [...drag.baseSelection, ...hits] : hits
            onSelectRef.current?.(next)
        }

        const handleMouseMove = (event) => {
            const drag = dragRef.current
            if (!drag) {
                return
            }
            if (!drag.active) {
                const movedX = Math.abs(event.clientX - drag.startX)
                const movedY = Math.abs(event.clientY - drag.startY)
                if (movedX < DRAG_THRESHOLD && movedY < DRAG_THRESHOLD) {
                    return
                }
                activate(drag)
            }
            if (frameRef.current) {
                return
            }
            const { clientX, clientY } = event
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = 0
                update(clientX, clientY)
            })
        }

        const endDrag = () => {
            const drag = dragRef.current
            dragRef.current = null
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current)
                frameRef.current = 0
            }
            if (!drag || !drag.active) {
                return
            }
            setMarquee(null)
            document.body.classList.remove('drag-selecting')
            // the click that follows this mouseup belongs to the drag
            suppressClickRef.current = true
            setTimeout(() => {
                suppressClickRef.current = false
            }, 0)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', endDrag)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', endDrag)
            document.body.classList.remove('drag-selecting')
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current)
            }
        }
    }, [])

    return {
        containerRef,
        marquee,
        onMouseDown: handleMouseDown,
        onClickCapture: handleClickCapture,
    }
}
