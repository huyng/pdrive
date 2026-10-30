// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { formatSize } from '../../../utils.js'

import { isNumericColumn, readCsv, sortedIndexes } from './csv.js'
import { hasText, SliceMessage, useTextSlice } from './textSlice.jsx'

// A comma-separated file, drawn as the table it is: the same rows of text as the
// text preview shows, lined up into columns so that the file can be read at a
// glance instead of by counting delimiters.
//
// Two things make it a table rather than a picture of one. A column can be sorted
// by its heading, three ways round - smallest first, largest first, and back to the
// order of the file - so that the interesting rows come to the top of a file nobody
// is going to reorder in place. And only the rows on screen are drawn: the slice the
// preview reads is 64 KiB and can hold well over a thousand rows, which is more rows
// than a browser should be asked to lay out to show forty of them.
//
// It reads the same slice as every other reader of text, and treats the cut with the
// same care: a row the slice stopped in the middle of is not drawn, because half a
// row drawn as a row is a value the file does not contain.
const TSV = /^\.tsv$/i
const TAB_MIMETYPES = /^text\/tab-separated-values/i

// rows drawn beyond the visible ones, so that a flick of the wheel does not show
// the blank space under the last row
const OVERSCAN = 8

// How tall the table is allowed to get. A browser stops laying out a scrolling box
// at about 33 million pixels, and past that the rows at the bottom cannot be
// scrolled to at all - so a file of a million one-character rows, which two
// megabytes can hold, is laid out as far as this and no further. The strip under
// the table says where it stopped, because a scrollbar that ends in the middle of a
// file without saying so is worse than one that says it has.
const MAX_TABLE_HEIGHT = 8 * 1024 * 1024
// how tall a row is until one has been measured: the height of a row of 12.5px
// text with the padding below. Wrong only for a moment - the first row to be drawn
// is measured and the number is replaced with the truth.
const ASSUMED_ROW_HEIGHT = 34

function suggestedDelimiter(node) {
    if (TSV.test(node.name) || TAB_MIMETYPES.test(node.mimetype || '')) {
        return '\t'
    }
    return ','
}

// Which rows are on screen: the window a scroll position implies, in row heights.
function useRowWindow({ count, rowHeight, scrollRef }) {
    // nothing drawn until the effect below has looked at the scroll box: the
    // window is worked out before the first paint, so a file of a thousand rows
    // is never laid out once in full to be trimmed a frame later
    const [range, setRange] = useState({ start: 0, end: 0 })

    useLayoutEffect(() => {
        const element = scrollRef.current
        if (!element) {
            return undefined
        }
        let frame = 0
        const update = () => {
            frame = 0
            const first = Math.max(0, Math.floor(element.scrollTop / rowHeight))
            const visible = Math.ceil(element.clientHeight / rowHeight) + 1
            const start = Math.max(0, first - OVERSCAN)
            const end = Math.min(count, first + visible + OVERSCAN)
            setRange((current) => (current.start === start && current.end === end ? current : { start, end }))
        }
        // one update per frame at most: a scroll event arrives faster than a
        // render, and the last one is the only one that matters
        const schedule = () => {
            if (frame === 0) {
                frame = requestAnimationFrame(update)
            }
        }
        update()
        element.addEventListener('scroll', schedule, { passive: true })
        const observer = new ResizeObserver(schedule)
        observer.observe(element)
        return () => {
            element.removeEventListener('scroll', schedule)
            observer.disconnect()
            if (frame !== 0) {
                cancelAnimationFrame(frame)
            }
        }
    }, [count, rowHeight, scrollRef])

    return {
        start: Math.min(range.start, Math.max(0, count - 1)),
        end: Math.min(range.end, count),
    }
}

// Everything the table needs, worked out once per file and per sort: the heading
// row, the rows under it in the order they are to be shown, how wide the grid is,
// and which columns hold numbers.
function tableModel({ state, node, sort }) {
    if (!hasText(state)) {
        return null
    }
    const parsed = readCsv(state.text, suggestedDelimiter(node))
    // the cut fell inside a line, so the last line is not a row of the file yet
    const cut = state.truncated && (!parsed.endsWithNewline || parsed.openQuote)
    const rows = cut ? parsed.rows.slice(0, -1) : parsed.rows
    if (rows.length === 0) {
        return { empty: true }
    }

    const header = rows[0]
    const body = rows.slice(1)
    // a ragged file keeps all of its cells: the grid is as wide as its widest row
    const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
    const aligns = []
    for (let column = 0; column < width; column += 1) {
        const values = body.slice(0, 200).map((row) => row[column] ?? '')
        aligns.push(isNumericColumn(values) ? 'right' : 'left')
    }

    // the numbers down the side are the file's own: sorting moves rows about
    // without renumbering them, so a row can be found again in the file
    const order = sort ? sortedIndexes(body, sort.column, sort.direction) : null
    const shown = order
        ? order.map((index) => ({ line: index + 2, cells: body[index] }))
        : body.map((cells, index) => ({ line: index + 2, cells }))

    return { empty: false, header, body: shown, width, aligns }
}

function ariaSort(sort, column) {
    if (!sort || sort.column !== column) {
        return 'none'
    }
    return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function sortTip(sort, column, label) {
    if (!sort || sort.column !== column) {
        return 'Sort by ' + label
    }
    return sort.direction === 'asc' ? 'Sorted smallest first, click for the other way' : 'Sorted largest first, click to unsort'
}

function CsvTable({ state, node }) {
    const [sort, setSort] = useState(null)
    const [rowHeight, setRowHeight] = useState(ASSUMED_ROW_HEIGHT)
    const scrollRef = useRef(null)
    const firstRowRef = useRef(null)

    const model = useMemo(() => tableModel({ state, node, sort }), [state, node, sort])
    const body = model && !model.empty ? model.body : []
    const limit = Math.max(1, Math.floor(MAX_TABLE_HEIGHT / rowHeight))
    // only recomputed when the number of rows or the height of one changes, which
    // is what keeps this off the scroll path
    const shown = useMemo(() => (body.length > limit ? body.slice(0, limit) : body), [body, limit])
    const range = useRowWindow({ count: shown.length, rowHeight, scrollRef })

    // A row's height is a fact about the stylesheet, not about the data, so it is
    // measured from a row that exists rather than believed. Watching that row is
    // what keeps a change of zoom, or a font that falls back to something taller,
    // from leaving the window at the wrong place in the slice: the spacers that
    // stand in for the rows above and below are laid out in row heights, so a row
    // height the table did not notice is a gap at the bottom of the scroll.
    useLayoutEffect(() => {
        const row = firstRowRef.current
        if (!row) {
            return undefined
        }
        const measure = () => {
            const height = row.getBoundingClientRect().height
            if (height > 0) {
                setRowHeight((current) => (Math.abs(height - current) > 0.5 ? height : current))
            }
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(row)
        return () => observer.disconnect()
    }, [model, range.start])

    if (model && model.empty) {
        return (
            <>
                <div className="preview-placeholder">There is no table in this file.</div>
                <CsvFooter state={state} rows={0} shown={0} />
            </>
        )
    }
    if (!model) {
        return null
    }

    // smallest first, then largest, then the file's own order again
    const sortBy = (column) => {
        setSort((current) => {
            if (!current || current.column !== column) {
                return { column, direction: 'asc' }
            }
            if (current.direction === 'asc') {
                return { column, direction: 'desc' }
            }
            return null
        })
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0
        }
    }

    const { header, width, aligns } = model
    const columns = Array.from({ length: width }, (_, column) => column)

    return (
        <>
            <div className="preview-csv-scroll" ref={scrollRef}>
                <table className="preview-csv">
                    <thead>
                        <tr>
                            {/* the corner of the row numbers, which says nothing */}
                            <th className="preview-csv-index" aria-label="Row" />
                            {columns.map((column) => {
                                const label = header[column] ?? ''
                                return (
                                    <th
                                        key={column}
                                        style={{ textAlign: aligns[column] }}
                                        aria-sort={label === '' ? undefined : ariaSort(sort, column)}
                                    >
                                        {label === '' ? null : (
                                            <button
                                                type="button"
                                                className={'preview-csv-sort' + (sort && sort.column === column ? ' sorted' : '')}
                                                title={sortTip(sort, column, label)}
                                                onClick={() => sortBy(column)}
                                            >
                                                <span className="preview-csv-label">{label}</span>
                                                {sort && sort.column === column && (
                                                    <i className="material-icons preview-csv-caret">
                                                        {sort.direction === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                                                    </i>
                                                )}
                                            </button>
                                        )}
                                    </th>
                                )
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {/* the rows above the window, as one box the height of them */}
                        {range.start > 0 && (
                            <tr className="preview-csv-spacer" aria-hidden="true">
                                <td colSpan={width + 1} style={{ height: range.start * rowHeight }} />
                            </tr>
                        )}
                        {shown.slice(range.start, range.end).map((row, offset) => (
                            <tr key={range.start + offset} ref={range.start + offset === range.start ? firstRowRef : null}>
                                <th className="preview-csv-index">{row.line}</th>
                                {columns.map((column) => {
                                    const value = row.cells[column] ?? ''
                                    return (
                                        <td
                                            key={column}
                                            style={{ textAlign: aligns[column] }}
                                            title={value.length > 32 ? value : undefined}
                                        >
                                            {value}
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                        {/* and the rows below it */}
                        {range.end < shown.length && (
                            <tr className="preview-csv-spacer" aria-hidden="true">
                                <td colSpan={width + 1} style={{ height: (shown.length - range.end) * rowHeight }} />
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        <CsvFooter state={state} rows={body.length} shown={shown.length} />
        </>
    )
}

// What the table did not show, said under the table: the bytes the slice stopped
// short of, the rows a scrolling box cannot hold, or both.
function CsvFooter({ state, rows, shown }) {
    const parts = []
    if (state.truncated) {
        parts.push(
            'the first ' + formatSize({ type: 'file', size: state.shownBytes })
            + ' of ' + formatSize({ type: 'file', size: state.totalBytes }),
        )
    }
    if (shown < rows) {
        parts.push('the first ' + shown.toLocaleString() + ' of ' + rows.toLocaleString() + ' rows')
    }
    if (parts.length === 0) {
        return null
    }
    return <p className="preview-note">Showing {parts.join(', and ')}.</p>
}

function CsvBody({ node }) {
    const state = useTextSlice(node)

    if (!hasText(state)) {
        return <SliceMessage state={state} />
    }
    return <CsvTable state={state} node={node} />
}

export default {
    id: 'csv',
    // not "CSV": the bar offers this viewer by name, and what it offers is the
    // reading - a table - rather than the format
    name: 'Table',
    icon: 'table_chart',
    matches: (node) => /\.(csv|tsv)$/i.test(node.name)
        || /^text\/(csv|tab-separated-values)/i.test(node.mimetype || ''),
    Component: ({ node }) => (
        <div className="preview-text-panel preview-csv-panel">
            <CsvBody node={node} />
        </div>
    ),
}
