// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

// A cell's text, cut in the middle when the column is too narrow for it.
//
// CSS ends a long string with an ellipsis of its own, but only at the end, and
// the end is exactly what a file name cannot spare: `.pdf` says what the file is
// and the front is how you find it. So the text is laid out in two parts - its
// beginning and its end - and the browser is left to decide how much of the
// beginning fits, which it knows better than any measurement taken here: it
// draws `2024-annual-report-…a-long-name.pdf` by clipping the first part and
// ellipsising it, with the last part pinned after it. Nothing is measured, so
// nothing can be measured wrong, and a column that narrows - the window, the
// pane, an indented row - re-cuts the text by itself.
//
// The split is read off the text, not guessed at: the end keeps the extension
// whole, because that is the part that means something on its own.
const TAIL_SHARE = 0.4      // of the string, given to its end
const MIN_TAIL = 4          // characters, so an end is still recognisable
const MAX_TAIL = 20         // ...and enough of one, however long the whole is
// Below this there is no middle worth cutting: the browser's own ellipsis at the
// end says everything a shortened `4 Bytes` or `TXT document` has to say.
const MIN_SPLIT = 16

function split(text) {
    if (!text || text.length <= MIN_SPLIT) {
        return [text, '']
    }
    const extension = /\.[^.]{1,10}$/.exec(text)
    const tail = Math.min(
        text.length - 1,
        MAX_TAIL,
        Math.max(extension ? extension[0].length : 0, Math.ceil(text.length * TAIL_SHARE), MIN_TAIL),
    )
    let start = text.length - tail
    // A space on the very edge of the beginning is never drawn - clipping takes it
    // before the ellipsis does - which reads as `2026-10-29…19:23:06`, a date and
    // a time run together, or as two words with no gap between them. Hand that
    // space to the end, where it sits after the ellipsis and keeps the two apart.
    if (start > 1 && text[start - 1] === ' ') {
        start -= 1
    }
    return [text.slice(0, start), text.slice(start)]
}

// Both halves carry the drag handle rather than the cell: dragging is how a row
// is moved, and the empty space to the right of a short name still belongs to
// selecting, not to the file.
export default function CellText({ text, dragHandle = false }) {
    const [head, tail] = split(text)
    const handle = dragHandle ? '' : undefined
    return (
        <div className="cell-text">
            <span className="cell-text-head" data-drag-handle={handle}>{head}</span>
            {tail ? <span className="cell-text-tail" data-drag-handle={handle}>{tail}</span> : null}
        </div>
    )
}
