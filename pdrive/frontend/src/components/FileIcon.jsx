// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useId } from 'react'

import { iconKind } from '../utils.js'

// The listing draws its own icons instead of the flat Material glyphs it used
// to: a blue folder and a sheet of paper with a folded corner, the way the
// Finder draws them, with a small emblem in the sheet for the kind of file.
// Everything is inline SVG, so one drawing serves the 18px of the list and the
// 64px of the grid without another font or image to load.

// Folder: the back panel carries the tab, the front panel covers its lower
// half, exactly like the folders of macOS. Taller than it is wide in the same
// measure as the real thing - a wider folder reads as a hamburger at 18px.
const FOLDER_BACK = 'M8 20a8 8 0 0 1 8-8h8a6 6 0 0 1 4.5 2l3 3.5H48a8 8 0 0 1 8 8V27.5H8z'
const FOLDER_FRONT = 'M8 23h48v21.5a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z'

// Those paths are 48 wide by 40.5 tall, which still reads squat beside the
// sheet of paper. Stretching them 12% about the middle of the drawing - the
// same 12% the header mark gets in BrandLogo.jsx - squares the folder up
// without widening it: the front panel ends at y 54.9, so 9 units of the 64
// box are still empty below it and nothing is clipped.
const FOLDER_SCALE_Y = 1.12
const FOLDER_MID_Y = 32.25

// Page: rounded corners, with the top right one cut short for the fold.
const PAGE_BODY = 'M13 12a7 7 0 0 1 7-7h17.5L51 18.5V52a7 7 0 0 1-7 7H20a7 7 0 0 1-7-7z'
const PAGE_FOLD = 'M37.5 5 51 18.5h-9.5a4 4 0 0 1-4-4z'

const LINE = '#C9D2E0'
const ACCENT = { text: '#B9C4D4', code: '#6C7BE0', archive: '#8E97A6' }

function Folder({ size }) {
    const id = useId().replace(/:/g, '')
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id={`${id}-back`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#5CA8EE" />
                    <stop offset="1" stopColor="#3B8BE1" />
                </linearGradient>
                <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#87C6F9" />
                    <stop offset="1" stopColor="#2F82E2" />
                </linearGradient>
            </defs>
            <g transform={`translate(0 ${FOLDER_MID_Y}) scale(1 ${FOLDER_SCALE_Y}) translate(0 -${FOLDER_MID_Y})`}>
                <path d={FOLDER_BACK} fill={`url(#${id}-back)`} />
                <path d={FOLDER_FRONT} fill={`url(#${id}-front)`} />
                {/* the light catching the top edge of the front panel */}
                <path d="M8 23.55h48" stroke="#FFFFFF" strokeOpacity=".45" strokeWidth="1.3" />
            </g>
        </svg>
    )
}

// The emblems sit in the middle of the sheet, between its edges and the fold.
function Emblem({ kind }) {
    if (kind === 'code') {
        return (
            <g fill="none" stroke={ACCENT.code} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M27.5 27.5 20.5 38l7 10.5" />
                <path d="M36.5 27.5 43.5 38l-7 10.5" />
            </g>
        )
    }
    if (kind === 'image') {
        return (
            <g>
                <rect x="17" y="27" width="30" height="22" rx="3" fill="#E7F3FF" stroke="#BCD8F3" />
                <circle cx="24" cy="33.5" r="2.6" fill="#FFC24D" />
                <path d="M18 47.5 26 39l6 6 4.5-4.5 8.5 7z" fill="#63C46F" />
            </g>
        )
    }
    if (kind === 'pdf') {
        return (
            <g>
                <rect x="17" y="33" width="30" height="15" rx="3" fill="#E5484D" />
                <text
                    x="32"
                    y="44.2"
                    textAnchor="middle"
                    fontFamily="system-ui, -apple-system, sans-serif"
                    fontSize="9.5"
                    fontWeight="700"
                    fill="#FFFFFF"
                >
                    PDF
                </text>
            </g>
        )
    }
    if (kind === 'audio') {
        return (
            <g fill="#AF52DE">
                <path
                    d="M29 44.5V29.8l12-3v14.7"
                    fill="none"
                    stroke="#AF52DE"
                    strokeWidth="3.4"
                    strokeLinecap="round"
                />
                <ellipse cx="25.4" cy="45.4" rx="4.6" ry="3.9" transform="rotate(-8 25.4 45.4)" />
                <ellipse cx="37.4" cy="42.4" rx="4.6" ry="3.9" transform="rotate(-8 37.4 42.4)" />
            </g>
        )
    }
    if (kind === 'video') {
        return (
            <g>
                <rect x="17" y="28" width="30" height="21" rx="4" fill="#2C2C2E" />
                <path d="M28.6 33.8l9.6 5.2-9.6 5.2z" fill="#FFFFFF" />
            </g>
        )
    }
    if (kind === 'archive') {
        return (
            <g>
                <rect x="29" y="22" width="6" height="28" rx="1.5" fill={ACCENT.archive} />
                <path d="M29 26.5h6M29 31h6M29 35.5h6M29 40h6M29 44.5h6" stroke="#FFFFFF" strokeWidth="1.4" />
                <rect x="26.5" y="36" width="11" height="7.5" rx="2" fill="#5F6875" />
            </g>
        )
    }
    // plain text, and anything the kind of which we do not know
    return (
        <g fill={ACCENT[kind] || LINE}>
            <rect x="19" y="26" width="26" height="3" rx="1.5" />
            <rect x="19" y="32.5" width="26" height="3" rx="1.5" />
            <rect x="19" y="39" width="26" height="3" rx="1.5" />
            <rect x="19" y="45.5" width="15" height="3" rx="1.5" />
        </g>
    )
}

function Sheet({ kind, size }) {
    const id = useId().replace(/:/g, '')
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#FFFFFF" />
                    <stop offset="1" stopColor="#EFF3F8" />
                </linearGradient>
            </defs>
            {/* the sheet itself gets a slightly darker edge so that it reads
                on a white listing without leaning on the shadow for it */}
            <path d={PAGE_BODY} fill={`url(#${id}-paper)`} stroke="#000000" strokeOpacity=".16" />
            <Emblem kind={kind} />
            <path d={PAGE_FOLD} fill="#DFE5EE" stroke="#000000" strokeOpacity=".14" />
        </svg>
    )
}

// `dragHandle` makes the drawing itself start a drag to move, so a row can be
// picked up by its icon as well as by its name.
export default function FileIcon({ node, size = 18, className, dragHandle = false }) {
    const kind = iconKind(node)
    const drawing = kind === 'folder' ? <Folder size={size} /> : <Sheet kind={kind} size={size} />
    return (
        <span
            className={className ? `file-icon ${className}` : 'file-icon'}
            data-drag-handle={dragHandle ? '' : undefined}
        >
            {drawing}
        </span>
    )
}
