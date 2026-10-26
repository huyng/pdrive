// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useCallback, useEffect, useRef, useState } from 'react'

// How far the pointer has to travel before a mousedown on a filename turns
// into a move drag (and not into a plain click).
const DRAG_THRESHOLD = 4

// Drag a file (or the current selection) onto a folder to move it there.
//
// A drag only starts when the mouse goes down on an element marked with
// `data-drag-handle` (a filename in the list, or a whole tile in the grid),
// which is what keeps this from fighting with the rubber-band selection
// started on empty space or elsewhere in a row.
export default function useDragMove({ containerRef, selectedPaths, onMove }) {
    const dragRef = useRef(null)
    const frameRef = useRef(0)
    const suppressClickRef = useRef(false)
    const [ghost, setGhost] = useState(null)          // { x, y, label }
    const [dropTargetPath, setDropTargetPath] = useState(null)

    const selectedPathsRef = useRef(selectedPaths)
    const onMoveRef = useRef(onMove)
    useEffect(() => {
        selectedPathsRef.current = selectedPaths
    }, [selectedPaths])
    useEffect(() => {
        onMoveRef.current = onMove
    }, [onMove])

    const handleMouseDown = useCallback((event) => {
        if (event.button !== 0 || !containerRef.current) {
            return
        }
        const target = event.target
        if (!(target instanceof HTMLElement)) {
            return
        }
        const handle = target.closest('[data-drag-handle]')
        const item = handle ? handle.closest('[data-path]') : null
        if (!item) {
            return
        }

        const path = item.dataset.path
        const selected = selectedPathsRef.current
        // dragging a row that is part of the selection moves the whole selection
        const paths = selected.includes(path) ? [...selected] : [path]
        dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            paths,
            label: paths.length === 1 ? path.slice(path.lastIndexOf('/') + 1) : `${paths.length} items`,
            active: false,
            folders: null,
            dropTarget: null,
        }
        event.preventDefault()
    }, [containerRef])

    const handleClickCapture = useCallback((event) => {
        // the click that ends a drag must not change the selection
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
            // The listing does not change during a drag, so the folder
            // rectangles are measured once.
            drag.folders = Array.from(container.querySelectorAll('[data-path][data-dir]')).map((el) => ({
                path: el.dataset.path,
                rect: el.getBoundingClientRect(),
            }))
            document.body.classList.add('drag-moving')
        }

        const update = (x, y) => {
            const drag = dragRef.current
            if (!drag || !drag.active) {
                return
            }
            setGhost({ x, y, label: drag.label })

            const folder = drag.folders.find(({ rect }) => (
                x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
            ))
            // a folder cannot be dropped into itself or into its own subtree
            const dropTarget = folder && !drag.paths.some((path) => (
                folder.path === path || folder.path.startsWith(path + '/')
            ))
                ? folder.path
                : null

            if (dropTarget !== drag.dropTarget) {
                drag.dropTarget = dropTarget
                setDropTargetPath(dropTarget)
            }
        }

        const finish = ({ cancelled = false } = {}) => {
            const drag = dragRef.current
            dragRef.current = null
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current)
                frameRef.current = 0
            }
            if (!drag || !drag.active) {
                return
            }
            document.body.classList.remove('drag-moving')
            setGhost(null)
            setDropTargetPath(null)
            // swallow the click that follows this drag
            suppressClickRef.current = true
            setTimeout(() => {
                suppressClickRef.current = false
            }, 0)

            if (!cancelled && drag.dropTarget) {
                onMoveRef.current?.(drag.paths, drag.dropTarget)
            }
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

        const handleMouseUp = () => finish()

        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && dragRef.current) {
                finish({ cancelled: true })
            }
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.removeEventListener('keydown', handleKeyDown)
            document.body.classList.remove('drag-moving')
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current)
            }
        }
    }, [containerRef])

    return {
        ghost,
        dropTargetPath,
        onMouseDown: handleMouseDown,
        onClickCapture: handleClickCapture,
    }
}
