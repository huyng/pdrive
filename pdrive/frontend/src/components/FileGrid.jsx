// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useLayoutEffect, useMemo, useState } from 'react'

import { serveUrl } from '../api.js'
import { previewKind } from '../utils.js'
import FileIcon from './FileIcon.jsx'

// The CSS reserves two lines for every filename and clamps anything longer,
// but a clamp cuts the name at the end and hides the file extension. Names
// that do not fit are therefore shortened in the middle instead: the longest
// prefix that still fits, then an ellipsis, then the extension.

const ELLIPSIS = '…'

// Keep a couple of characters in front of the dot so the extension still
// reads as part of a name ("il….pdf", never "….pdf"), even when the name has
// to be cut down to almost nothing.
const MIN_PREFIX = 2

function splitName(name) {
    const dot = name.lastIndexOf('.')
    // a leading dot marks a dotfile (.bashrc), it does not start an extension
    if (dot <= 0) {
        return { base: name, extension: '' }
    }
    return { base: name.slice(0, dot), extension: name.slice(dot) }
}

function shorten({ base, extension }, length) {
    return (length > 0 ? base.slice(0, length) : '') + ELLIPSIS + extension
}

// How much of each name fits, measured in one go. The candidates are rendered
// into a hidden copy of the grid (so they get the same width, font and
// clamping as the real tiles), written first and read back afterwards, which
// keeps the number of browser layouts small instead of one per name.
function fitNames(names) {
    const container = document.createElement('div')
    container.className = 'grid-view filename-measurer'
    container.setAttribute('aria-hidden', 'true')

    const cells = names.map(() => {
        const item = document.createElement('div')
        item.className = 'grid-item'
        const filename = document.createElement('div')
        filename.className = 'filename'
        item.appendChild(filename)
        container.appendChild(item)
        return filename
    })
    document.body.appendChild(container)

    // Renders the candidates (a null leaves a cell untouched) and reports the
    // ones that fit in the two lines a filename has.
    const measure = (candidates) => {
        cells.forEach((cell, index) => {
            if (candidates[index] !== null) {
                cell.textContent = candidates[index]
            }
        })
        return cells.map((cell) => cell.scrollHeight <= cell.clientHeight + 1)
    }

    const parts = names.map(splitName)
    const fits = measure(names)
    const low = names.map(() => 0)                      // known to fit
    const high = parts.map((part) => part.base.length)  // known not to fit
    let pending = names.map((_, index) => index).filter((index) => !fits[index])

    // Binary search the longest prefix that still fits. Only the names that
    // are still being searched get a new candidate every round.
    while (pending.length > 0) {
        const candidates = names.map(() => null)
        const mids = []
        for (const index of pending) {
            mids[index] = Math.ceil((low[index] + high[index]) / 2)
            candidates[index] = shorten(parts[index], mids[index])
        }
        const fitsNow = measure(candidates)
        const next = []
        for (const index of pending) {
            if (fitsNow[index]) {
                low[index] = mids[index]
            } else {
                high[index] = mids[index]
            }
            if (high[index] - low[index] > 1) {
                next.push(index)
            }
        }
        pending = next
    }

    container.remove()

    const displayNames = new Map()
    names.forEach((name, index) => {
        const { base } = parts[index]
        const keep = Math.min(base.length, Math.max(MIN_PREFIX, low[index]))
        displayNames.set(name, fits[index] ? name : shorten(parts[index], keep))
    })
    return displayNames
}

function TilePreview({ node }) {
    if (previewKind(node) === 'image') {
        return (
            <img
                draggable={false}
                width="64"
                height="64"
                style={{ border: '1px solid #eee', objectFit: 'cover' }}
                alt={node.name}
                src={serveUrl(node.path)}
            />
        )
    }
    return <FileIcon node={node} size={64} className="tile-icon" />
}

export default function FileGrid({ nodes, dropTargetPath, onRowClick, onRowRightClick, onRowDoubleClick }) {
    const names = useMemo(() => nodes.map((node) => node.name), [nodes])
    const namesKey = useMemo(() => names.join('\u0000'), [names])
    const [displayNames, setDisplayNames] = useState(() => new Map())

    // Measuring touches the DOM, so it cannot happen during render. A layout
    // effect runs before the browser paints, so the full names never show.
    // It only has to run again when the listing changes, not on selection.
    useLayoutEffect(() => {
        setDisplayNames(fitNames(names))
    }, [namesKey])  // eslint-disable-line react-hooks/exhaustive-deps

    // Each tile is a move handle: dragging the icon or the name both start a
    // drag to move, and the gaps between the tiles start a rubber-band select.
    return (
        <div className="grid-view noselect">
            {nodes.map((node, index) => (
                <div
                    key={`${node.path}-${index}`}
                    data-path={node.path}
                    data-dir={node.type === 'dir' ? 'true' : undefined}
                    data-drag-handle=""
                    className={`grid-item${node.isSelected ? ' selected' : ''}${node.path === dropTargetPath ? ' drop-target' : ''}`}
                    onClick={(event) => onRowClick(node, event)}
                    onContextMenu={(event) => onRowRightClick(node, event)}
                    onDoubleClick={(event) => onRowDoubleClick(node, event)}
                >
                    <div className="grid-item-preview">
                        <TilePreview node={node} />
                    </div>
                    {/* the tooltip keeps the full name reachable */}
                    <div className="filename" data-tip={node.name}>
                        {displayNames.get(node.name) ?? node.name}
                    </div>
                </div>
            ))}
        </div>
    )
}
