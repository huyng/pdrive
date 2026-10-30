// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

// A comma-separated file, read into rows of fields.
//
// The parsing follows RFC 4180, which is what every writer of CSV actually emits:
// fields separated by a delimiter, a field that needs a comma, a quote or a newline
// inside it wrapped in double quotes, and a doubled quote inside a quoted field
// standing for one quote. Nothing else is interpreted - no type conversion, no
// escaping of backslashes, no trimming - because a preview that quietly changes a
// value is a preview that lies about a file someone is going to copy out of it.
//
// Two things it does beyond the RFC, both because real files do them:
//
//   * a first line of `sep=;` declares the delimiter (Excel writes it), and is
//     read as a declaration rather than as a row of data
//   * when the name says comma and the file is all semicolons, the delimiter is
//     sniffed from the first lines instead of showing one column of text

// Read a file the way its name suggests, then let the file correct the guess.
export function readCsv(text, suggested = ',') {
    const source = String(text ?? '').replace(/^\uFEFF/, '')
    const declared = /^sep=(.)[ \t]*\r?\n/i.exec(source)
    if (declared) {
        return parseDelimited(source.slice(declared[0].length), declared[1])
    }
    return parseDelimited(source, delimiterFor(source, suggested))
}

// Enough of a file to see which delimiter it is written with. The delimiter is a
// property of the file rather than of its length, so a two megabyte slice is read
// for as many lines as a two kilobyte one - the rest of it is parsed once, with
// the delimiter that has been decided on.
const SNIFF_BYTES = 8 * 1024

// The delimiter the file is written with: the one its name suggests, if the file
// agrees with it, and otherwise the one its first lines agree on.
function delimiterFor(text, suggested) {
    const head = text.length > SNIFF_BYTES ? text.slice(0, SNIFF_BYTES) : text
    if (suggested) {
        const rows = parseDelimited(head, suggested).rows
        if (rows.some((row) => row.length > 1)) {
            return suggested
        }
    }
    return sniffDelimiter(head) ?? suggested ?? ','
}

const CANDIDATES = [',', '\t', ';', '|']

// The candidate that cuts the first lines into the same number of columns most
// often - and at least two columns, or there is nothing to choose between them.
function sniffDelimiter(text) {
    let best = null
    for (const candidate of CANDIDATES) {
        const rows = parseDelimited(text, candidate).rows.slice(0, 50).filter((row) => row.length > 1)
        if (rows.length < 2) {
            continue
        }
        const columns = mostCommon(rows.map((row) => row.length))
        const agree = rows.filter((row) => row.length === columns).length / rows.length
        // a pipe that happens to appear in prose splits every line once; the
        // count of columns is what separates a table from a sentence
        const score = columns * (agree >= 0.9 ? agree : 0)
        if (score > 0 && (!best || score > best.score)) {
            best = { delimiter: candidate, score }
        }
    }
    return best ? best.delimiter : null
}

function mostCommon(values) {
    const counts = new Map()
    let winner = values[0]
    let best = 0
    for (const value of values) {
        const count = (counts.get(value) ?? 0) + 1
        counts.set(value, count)
        if (count > best) {
            best = count
            winner = value
        }
    }
    return winner
}

// `rows` is a list of rows of strings; `endsWithNewline` says whether the text
// stopped at a line boundary, `openQuote` whether it stopped inside a quoted
// field. Both are what a text cut at a byte count needs to know: the last row of
// a cut file is not a row of the file.
export function parseDelimited(text, delimiter = ',') {
    const source = String(text ?? '')
    const rows = []
    let row = []
    let field = ''
    let quoted = false
    let i = 0

    const endField = () => {
        row.push(field)
        field = ''
    }
    const endRow = () => {
        endField()
        rows.push(row)
        row = []
    }

    while (i < source.length) {
        const ch = source[i]
        if (quoted) {
            if (ch === '"') {
                if (source[i + 1] === '"') {
                    // a doubled quote inside quotes is one quote
                    field += '"'
                    i += 2
                    continue
                }
                quoted = false
                i += 1
                continue
            }
            field += ch
            i += 1
            continue
        }
        // a quote opens a field only when the field has not started yet, so a
        // quote in the middle of a name stays a character of that name
        if (ch === '"' && field === '') {
            quoted = true
            i += 1
            continue
        }
        if (ch === delimiter) {
            endField()
            i += 1
            continue
        }
        if (ch === '\r' || ch === '\n') {
            endRow()
            if (ch === '\r' && source[i + 1] === '\n') {
                i += 1
            }
            i += 1
            continue
        }
        field += ch
        i += 1
    }
    if (field !== '' || row.length > 0) {
        endRow()
    }

    return {
        delimiter,
        rows,
        endsWithNewline: /[\r\n]$/.test(source),
        openQuote: quoted,
    }
}

// A cell read as a number, so that a column of numbers can be sorted as numbers:
// `1,200`, `1.234,50`, `-40`, `3.5`, `50%`. NaN for anything else, and the caller
// sorts that cell as text.
//
// The one ambiguity is a single comma or dot, which may be a decimal mark or a
// thousands mark. Three digits after it and digits before it is taken as a group
// (`1,200` is twelve hundred), anything else as a decimal mark (`1,5` is one and a
// half) - which is what a spreadsheet does with an English locale, and the only
// reading that cannot be wrong about the common case.
export function numberFor(value) {
    const trimmed = String(value ?? '').trim().replace(/%$/, '').replace(/\s/g, '')
    if (trimmed === '' || !/^[-+]?[\d.,]+$/.test(trimmed)) {
        return NaN
    }
    const dot = trimmed.lastIndexOf('.')
    const comma = trimmed.lastIndexOf(',')
    let normalised = trimmed
    if (dot !== -1 && comma !== -1) {
        // both present: the later of the two is the decimal mark, the other groups
        const grouping = dot > comma ? ',' : '.'
        normalised = trimmed.split(grouping).join('').replace(grouping === ',' ? '.' : ',', '.')
    } else if (comma !== -1) {
        normalised = /^\d{1,3}(,\d{3})+$/.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed.replace(',', '.')
    }
    const number = Number(normalised)
    return Number.isFinite(number) ? number : NaN
}

// Whether a column holds numbers, so that it can be lined up on the right the way
// a column of numbers is read. A column with one word in it is a column of words.
export function isNumericColumn(values) {
    let seen = 0
    for (const value of values) {
        const trimmed = value.trim()
        if (trimmed === '') {
            continue
        }
        seen += 1
        if (!/^[-+]?[\d\s.,]*\d[\d\s.,]*%?$/.test(trimmed)) {
            return false
        }
    }
    return seen > 0
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// The order to show the rows in when a column is sorted: the *indexes* of `rows`,
// so that a row can keep the number of the line it came from while it moves about
// the table. A row with nothing in the chosen column goes last either way - it has
// no place in an order it is not part of - and rows that tie keep the file's order,
// so that sorting twice does not shuffle the rows that are equal.
export function sortedIndexes(rows, column, direction = 'asc') {
    const factor = direction === 'desc' ? -1 : 1
    const numeric = isNumericColumn(rows.map((row) => row[column] ?? ''))
    const entries = rows.map((row, index) => {
        const value = row[column] ?? ''
        return { index, value, number: numeric ? numberFor(value) : NaN, blank: value.trim() === '' }
    })
    entries.sort((a, b) => {
        if (a.blank !== b.blank) {
            return a.blank ? 1 : -1
        }
        if (!a.blank) {
            if (Number.isFinite(a.number) && Number.isFinite(b.number) && a.number !== b.number) {
                return (a.number - b.number) * factor
            }
            const order = COLLATOR.compare(a.value, b.value)
            if (order !== 0) {
                return order * factor
            }
        }
        return a.index - b.index
    })
    return entries.map((entry) => entry.index)
}
