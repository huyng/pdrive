// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

// A Markdown reader: as much of CommonMark and of GFM as a README, a note or a
// page of documentation uses, parsed into blocks and inline runs that the viewer
// draws as elements.
//
// It is written here rather than taken from a package because the preview needs
// three things a renderer that produces a string cannot promise:
//
//   * it returns data and never markup. A file cannot introduce an element or an
//     attribute of its own - the viewer builds every element and this module only
//     says which one - so "<script>" in a document is a word in a paragraph, and
//     there is nothing to sanitise afterwards because nothing was ever HTML.
//   * a URL is judged before it is drawn (`safeUrl`): a link is a reference to a
//     document, and `javascript:` is a program, so it is refused here and never
//     reaches an `href`.
//   * the text it is given is the first 64 KiB of a file that may be longer. A
//     parser that has to repair its input would draw a document that ends in a
//     way the file does not; this one draws the part it was handed.
//
// What it deliberately does not do: raw HTML blocks, reference-style links,
// footnotes, and the last word on delimiter precedence, which needs a real
// CommonMark parser. A tilde fence, a pipe table and a task list are here; a
// setext heading is here; a hard break is here.

// how deep a list inside a quote inside a list may go before the rest is shown
// as the text it is: deep enough for any document, shallow enough that no file
// can make the parser recurse without end
const MAX_DEPTH = 12

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|~<>:\'"'.split(''))

const QUOTE_OPEN = /^ {0,3}>/
const LIST_ITEM = /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))(?:([ \t]+)(.*)|[ \t]*$)/

export function parseMarkdown(source) {
    return parseBlocks(String(source ?? '').replace(/\r\n?/g, '\n').split('\n'), 0)
}

// A URL is either a document or it is not. http, https and mailto point at
// documents; a scheme this does not know - `javascript:` above all, and `data:`,
// which can carry a whole program in a link - is refused, and a path with no
// scheme at all is a document next to this one.
export function safeUrl(url) {
    const trimmed = String(url ?? '').trim()
    if (trimmed === '') {
        return null
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
    if (scheme) {
        return /^(https?|mailto)$/i.test(scheme[1]) ? trimmed : null
    }
    return trimmed
}

// --- blocks ---------------------------------------------------------------

function parseBlocks(lines, depth) {
    const blocks = []
    let i = 0
    while (i < lines.length) {
        const line = lines[i]
        if (isBlank(line)) {
            i += 1
            continue
        }
        if (depth > MAX_DEPTH) {
            const rest = lines.slice(i).join('\n')
            blocks.push({ type: 'paragraph', inline: [{ type: 'text', value: rest }] })
            break
        }

        const fence = fenceOpen(line)
        if (fence) {
            const read = readFence(lines, i, fence)
            blocks.push(read.block)
            i = read.next
            continue
        }
        if (isRule(line)) {
            blocks.push({ type: 'rule' })
            i += 1
            continue
        }
        const heading = atxHeading(line)
        if (heading) {
            blocks.push(heading)
            i += 1
            continue
        }
        if (QUOTE_OPEN.test(line)) {
            const read = readQuote(lines, i, depth)
            blocks.push(read.block)
            i = read.next
            continue
        }
        // four columns in is code, and code is read before a list: an indented
        // `- item` is a line of a program, not an item of a list
        if (indentWidth(line) >= 4) {
            const read = readCode(lines, i)
            blocks.push(read.block)
            i = read.next
            continue
        }
        const item = listMarker(line)
        if (item) {
            const read = readList(lines, i, item, depth)
            blocks.push(read.block)
            i = read.next
            continue
        }
        if (line.includes('|') && i + 1 < lines.length && dividerRow(lines[i + 1])) {
            const read = readTable(lines, i)
            blocks.push(read.block)
            i = read.next
            continue
        }
        const read = readParagraph(lines, i)
        blocks.push(read.block)
        i = read.next
    }
    return blocks
}

function isBlank(line) {
    return /^[ \t]*$/.test(line)
}

function indentWidth(line) {
    let width = 0
    for (const ch of line) {
        if (ch === ' ') {
            width += 1
        } else if (ch === '\t') {
            width += 4
        } else {
            break
        }
    }
    return width
}

// `width` columns in, a tab counted as four, the rest of the line out
function dedent(line, width) {
    let removed = 0
    let i = 0
    while (i < line.length && removed < width) {
        if (line[i] === ' ') {
            removed += 1
        } else if (line[i] === '\t') {
            removed += 4
        } else {
            break
        }
        i += 1
    }
    return line.slice(i)
}

// The blocks that end a paragraph - everything else is a line of it.
function startsBlock(line) {
    return Boolean(fenceOpen(line)) || isRule(line) || Boolean(atxHeading(line))
        || QUOTE_OPEN.test(line) || Boolean(listMarker(line))
}

function fenceOpen(line) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (!match) {
        return null
    }
    // a backtick fence's info string may not contain a backtick, or a line of
    // code could open a fence it never meant to
    if (match[2][0] === '`' && match[3].includes('`')) {
        return null
    }
    return { indent: match[1].length, marker: match[2][0], length: match[2].length, info: match[3].trim() }
}

function readFence(lines, start, fence) {
    const closer = new RegExp('^ {0,3}' + (fence.marker === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$')
    const body = []
    let i = start + 1
    while (i < lines.length) {
        if (closer.test(lines[i])) {
            i += 1
            break
        }
        body.push(dedent(lines[i], fence.indent))
        i += 1
    }
    return {
        block: { type: 'code', lang: fence.info.split(/\s+/)[0] || '', value: body.join('\n') },
        next: i,
    }
}

function readCode(lines, start) {
    const body = []
    let pending = 0
    let i = start
    while (i < lines.length) {
        if (isBlank(lines[i])) {
            pending += 1
            i += 1
            continue
        }
        if (indentWidth(lines[i]) < 4) {
            break
        }
        for (; pending > 0; pending -= 1) {
            body.push('')
        }
        body.push(dedent(lines[i], 4))
        i += 1
    }
    return { block: { type: 'code', lang: '', value: body.join('\n') }, next: i }
}

function isRule(line) {
    const stripped = line.replace(/^ {0,3}/, '').replace(/[ \t]+$/, '')
    return /^([-*_])(?:[ \t]*\1){2,}$/.test(stripped)
}

function atxHeading(line) {
    const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line)
    if (!match) {
        return null
    }
    // the closing hashes of `## title ##` are punctuation, not part of the title
    const text = (match[2] || '').replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+$/, '')
    return { type: 'heading', level: match[1].length, inline: parseInline(text) }
}

function readQuote(lines, start, depth) {
    const body = []
    let i = start
    while (i < lines.length) {
        const line = lines[i]
        if (QUOTE_OPEN.test(line)) {
            body.push(line.replace(/^ {0,3}> ?/, ''))
            i += 1
            continue
        }
        // a quote goes on while the paragraph inside it does: a line that opens
        // no block of its own is a line of that paragraph, even unmarked
        const last = body[body.length - 1]
        if (!isBlank(line) && last !== undefined && !isBlank(last) && !startsBlock(line)) {
            body.push(line)
            i += 1
            continue
        }
        break
    }
    return { block: { type: 'quote', children: parseBlocks(body, depth + 1) }, next: i }
}

function listMarker(line) {
    const match = LIST_ITEM.exec(line)
    if (!match) {
        return null
    }
    const indent = match[1].length
    const ordered = match[2] === undefined
    const markerWidth = ordered ? match[3].length + 1 : 1
    const spaces = match[5] === undefined ? 1 : match[5].replace(/\t/g, '    ').length
    const extra = spaces > 4 ? ' '.repeat(spaces - 1) : ''
    return {
        indent,
        ordered,
        number: ordered ? Number(match[3]) : null,
        // where the item's own text starts, which is what the lines under it are
        // indented against
        contentIndent: indent + markerWidth + (spaces > 4 ? 1 : spaces),
        first: extra + (match[6] || ''),
    }
}

function readList(lines, start, marker, depth) {
    const ordered = marker.ordered
    const items = []
    let loose = false
    // the first item's first line is the one that was matched, so the walk
    // starts under it
    let i = start + 1
    let current = { lines: [marker.first], contentIndent: marker.contentIndent }
    let pendingBlank = false

    while (i < lines.length) {
        const line = lines[i]
        if (isBlank(line)) {
            pendingBlank = true
            i += 1
            continue
        }
        const next = listMarker(line)
        const indent = indentWidth(line)

        if (next && next.ordered === ordered && indent < current.contentIndent) {
            // the next item of this list
            if (pendingBlank) {
                loose = true
            }
            pendingBlank = false
            items.push(current)
            current = { lines: [next.first], contentIndent: next.contentIndent }
            i += 1
            continue
        }
        if (indent >= current.contentIndent) {
            if (pendingBlank) {
                // a blank line inside an item is what makes a list loose: the
                // paragraphs in it are its paragraphs and not just its lines
                current.lines.push('')
                loose = true
                pendingBlank = false
            }
            current.lines.push(dedent(line, current.contentIndent))
            i += 1
            continue
        }
        if (pendingBlank || startsBlock(line)) {
            break
        }
        // a line under-indented for the item but plainly a continuation of the
        // paragraph in it: this is what makes a wrapped item one paragraph
        current.lines.push(line)
        i += 1
    }
    items.push(current)

    const parsed = items.map((entry) => {
        const itemLines = entry.lines.slice()
        while (itemLines.length > 0 && isBlank(itemLines[itemLines.length - 1])) {
            itemLines.pop()
        }
        // `- [x] done` is a task, and its box is the item's, not its text's
        let task = null
        const box = /^\[([ xX])\][ \t]+/.exec(itemLines[0] || '')
        if (box) {
            task = box[1] !== ' '
            itemLines[0] = itemLines[0].slice(box[0].length)
        }
        return { task, blocks: parseBlocks(itemLines, depth + 1) }
    })

    return {
        block: { type: 'list', ordered, start: marker.number || 1, loose, items: parsed },
        next: i,
    }
}

function splitRow(line) {
    let text = line.trim()
    if (text.startsWith('|')) {
        text = text.slice(1)
    }
    if (text.endsWith('|') && !text.endsWith('\\|')) {
        text = text.slice(0, -1)
    }
    const cells = []
    let cell = ''
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\\' && text[i + 1] === '|') {
            cell += '|'
            i += 1
            continue
        }
        if (text[i] === '|') {
            cells.push(cell)
            cell = ''
            continue
        }
        cell += text[i]
    }
    cells.push(cell)
    return cells.map((value) => value.trim())
}

function dividerRow(line) {
    if (!line.includes('-')) {
        return false
    }
    const cells = splitRow(line)
    return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

function readTable(lines, start) {
    const header = splitRow(lines[start])
    const divider = splitRow(lines[start + 1])
    const align = header.map((_, index) => {
        const spec = divider[index] || '---'
        if (spec.startsWith(':') && spec.endsWith(':')) {
            return 'center'
        }
        if (spec.endsWith(':')) {
            return 'right'
        }
        if (spec.startsWith(':')) {
            return 'left'
        }
        return null
    })
    const rows = []
    let i = start + 2
    while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]).slice(0, header.length)
        while (cells.length < header.length) {
            cells.push('')
        }
        rows.push(cells.map((cell) => parseInline(cell)))
        i += 1
    }
    return {
        block: { type: 'table', align, header: header.map((cell) => parseInline(cell)), rows },
        next: i,
    }
}

function readParagraph(lines, start) {
    const collected = []
    let i = start
    while (i < lines.length && !isBlank(lines[i])) {
        // an underline turns what came before it into a heading
        const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[i])
        if (underline && collected.length > 0) {
            return {
                block: {
                    type: 'heading',
                    level: underline[1][0] === '=' ? 1 : 2,
                    inline: parseInline(collected.join('\n')),
                },
                next: i + 1,
            }
        }
        if (collected.length > 0 && startsBlock(lines[i])) {
            break
        }
        collected.push(lines[i])
        i += 1
    }
    return { block: { type: 'paragraph', inline: parseInline(collected.join('\n')) }, next: i }
}

// --- inline ---------------------------------------------------------------

function isWord(ch) {
    return Boolean(ch) && /[0-9A-Za-z]/.test(ch)
}

// the closing run of backticks, of exactly the length of the opening one
function closeOfBackticks(text, from, length) {
    let i = from
    while (i < text.length) {
        if (text[i] === '`') {
            const run = /^`+/.exec(text.slice(i))[0]
            if (run.length === length) {
                return i
            }
            i += run.length
            continue
        }
        i += 1
    }
    return -1
}

function findClose(text, from, marker) {
    const single = marker.length === 1
    for (let i = from; i + marker.length <= text.length; i += 1) {
        if (text[i] === '\\') {
            i += 1
            continue
        }
        if (text[i] === '`') {
            const run = /^`+/.exec(text.slice(i))[0]
            const close = closeOfBackticks(text, i + run.length, run.length)
            if (close !== -1) {
                i = close + run.length - 1
                continue
            }
        }
        if (!text.startsWith(marker, i)) {
            continue
        }
        // a closer is not a delimiter if it has a space before it, and half of a
        // doubled one is not the end of a single emphasis
        if (i > 0 && /\s/.test(text[i - 1])) {
            continue
        }
        if (single && (text[i + 1] === marker || text[i - 1] === marker)) {
            continue
        }
        return i
    }
    return -1
}

function emphasis(text, i, depth) {
    if (depth > MAX_DEPTH) {
        return null
    }
    const doubled = text.slice(i, i + 2)
    if (doubled === '**' || doubled === '__' || doubled === '~~') {
        const close = findClose(text, i + 2, doubled)
        if (close !== -1) {
            return {
                node: {
                    type: doubled === '~~' ? 'del' : 'strong',
                    children: parseInline(text.slice(i + 2, close), depth + 1),
                },
                next: close + 2,
            }
        }
    }
    const ch = text[i]
    if (ch !== '*' && ch !== '_') {
        return null
    }
    if (i + 1 >= text.length || /\s/.test(text[i + 1])) {
        return null
    }
    // snake_case_name is a name, not an emphasis
    if (ch === '_' && isWord(text[i - 1])) {
        return null
    }
    const close = findClose(text, i + 1, ch)
    if (close === -1) {
        return null
    }
    if (ch === '_' && isWord(text[close + 1])) {
        return null
    }
    return {
        node: { type: 'em', children: parseInline(text.slice(i + 1, close), depth + 1) },
        next: close + 1,
    }
}

// `[label](target)` and `![alt](source)`: the label is parsed for emphasis, the
// target is not parsed at all - it is an address, not prose
function readLink(text, start) {
    let depth = 0
    let label = ''
    let i = start
    for (; i < text.length; i += 1) {
        if (text[i] === '\\' && i + 1 < text.length) {
            label += text[i + 1]
            i += 1
            continue
        }
        if (text[i] === '[') {
            depth += 1
            if (depth > 1) {
                label += text[i]
            }
            continue
        }
        if (text[i] === ']') {
            depth -= 1
            if (depth === 0) {
                break
            }
            label += text[i]
            continue
        }
        label += text[i]
    }
    if (depth !== 0 || text[i + 1] !== '(') {
        return null
    }
    const target = readTarget(text, i + 2)
    if (!target) {
        return null
    }
    return { label, url: target.url, next: target.next }
}

function readTarget(text, start) {
    let depth = 0
    let raw = ''
    let i = start
    for (; i < text.length; i += 1) {
        if (text[i] === '\\' && i + 1 < text.length) {
            raw += text[i + 1]
            i += 1
            continue
        }
        if (text[i] === '(') {
            depth += 1
            raw += text[i]
            continue
        }
        if (text[i] === ')') {
            if (depth === 0) {
                break
            }
            depth -= 1
            raw += text[i]
            continue
        }
        raw += text[i]
    }
    if (depth !== 0 || i >= text.length) {
        return null
    }
    let url = raw.trim()
    if (url.startsWith('<') && url.endsWith('>')) {
        url = url.slice(1, -1)
    }
    // `(url "title")`: the title is dropped rather than read as part of the
    // address, since nothing in the panel shows it
    const titled = /^(\S+)[ \t]+["'(].*["')]$/.exec(url)
    if (titled) {
        url = titled[1]
    }
    return { url, next: i + 1 }
}

function parseInline(text, depth = 0) {
    const nodes = []
    let buffer = ''
    const flush = () => {
        if (buffer !== '') {
            nodes.push({ type: 'text', value: buffer })
            buffer = ''
        }
    }

    let i = 0
    while (i < text.length) {
        const ch = text[i]

        // A line break inside a paragraph is a space, unless the line was ended
        // with two spaces or a backslash - the writer's way of asking for the
        // break itself, which a paragraph in this browser would otherwise
        // swallow.
        if (ch === '\n') {
            const hard = / {2,}$/.test(buffer) || buffer.endsWith('\\')
            if (hard) {
                buffer = buffer.replace(/ {2,}$/, '').replace(/\\$/, '')
                if (buffer !== '') {
                    flush()
                }
                nodes.push({ type: 'br' })
            } else if (buffer !== '' && !buffer.endsWith(' ')) {
                buffer += ' '
            }
            i += 1
            continue
        }
        if (ch === '\\' && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
            buffer += text[i + 1]
            i += 2
            continue
        }
        if (ch === '`') {
            const run = /^`+/.exec(text.slice(i))[0]
            const close = closeOfBackticks(text, i + run.length, run.length)
            if (close !== -1) {
                flush()
                let value = text.slice(i + run.length, close).replace(/\n/g, ' ')
                // one space of padding is the writer's way of saying "this code
                // begins with a backtick", so it is taken off again
                if (value.length > 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
                    value = value.slice(1, -1)
                }
                nodes.push({ type: 'code', value })
                i = close + run.length
                continue
            }
            buffer += run
            i += run.length
            continue
        }
        if (ch === '!' && text[i + 1] === '[') {
            const image = readLink(text, i + 1)
            if (image) {
                flush()
                nodes.push({ type: 'image', src: image.url, alt: image.label })
                i = image.next
                continue
            }
        }
        if (ch === '[') {
            const link = readLink(text, i)
            if (link) {
                flush()
                nodes.push({ type: 'link', href: link.url, children: parseInline(link.label, depth + 1) })
                i = link.next
                continue
            }
        }
        if (ch === '<') {
            const auto = /^<((?:https?:\/\/|mailto:)[^>\s]*)>/.exec(text.slice(i))
            if (auto) {
                flush()
                nodes.push({ type: 'link', href: auto[1], children: [{ type: 'text', value: auto[1] }] })
                i += auto[0].length
                continue
            }
        }
        const marked = emphasis(text, i, depth)
        if (marked) {
            flush()
            nodes.push(marked.node)
            i = marked.next
            continue
        }
        buffer += ch
        i += 1
    }
    flush()
    return nodes
}
