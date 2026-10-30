// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useMemo, useState } from 'react'

import { serveUrl } from '../../../api.js'

import { parseMarkdown, safeUrl } from './markdown.js'
import { hasText, SliceMessage, TruncationNote, useTextSlice } from './textSlice.jsx'

// A markdown file, drawn as the page it was written to be.
//
// The parsing is in `markdown.js`, which hands back blocks and inline runs and no
// markup at all; this file decides what each of them becomes. So the two rules
// that matter are kept apart: a file cannot name an element that this does not
// name here, and a link is asked what it is (`safeUrl`) before it is given an
// `href`.
const MARKDOWN = /\.(md|markdown|mdown|mkd|mdwn)$/i

// A reference inside a document is relative to the document, and never climbs out
// of the root: `..` above it is dropped rather than handed to the server as a
// path it would refuse.
function resolvePath(from, reference) {
    const folder = from.slice(0, from.lastIndexOf('/'))
    const segments = (reference.startsWith('/') ? '' : folder).split('/').filter(Boolean)
    for (const part of reference.replace(/^\/+/, '').split('/')) {
        if (part === '' || part === '.') {
            continue
        }
        if (part === '..') {
            segments.pop()
            continue
        }
        segments.push(part)
    }
    return '/' + segments.join('/')
}

function decodePath(path) {
    try {
        return decodeURI(path)
    } catch (err) {
        // a '%' that is not an escape is part of the file's name
        return path
    }
}

// Where a picture in the document comes from: a file beside it, or the address it
// names, and nothing else. A source this cannot place is drawn as its alt text,
// which is what the alt text is for.
function imageSrc(reference, path) {
    const safe = safeUrl(reference)
    if (!safe || safe.startsWith('#')) {
        return null
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(safe)) {
        return /^https?:/i.test(safe) ? safe : null
    }
    if (safe.startsWith('//')) {
        return null
    }
    return serveUrl(resolvePath(path, decodePath(safe)))
}

// A link is a way out of the panel, so only an address a browser can be sent to
// is one. A fragment has no anchor to jump to (headings here carry no ids) and a
// path into the listing is not a URL the app routes, so both are drawn as the
// words they were written with, and the address is kept in the tooltip.
function linkHref(href) {
    const safe = safeUrl(href)
    if (!safe || !/^(https?:|mailto:)/i.test(safe)) {
        return null
    }
    return safe
}

function Inline({ nodes, path }) {
    return nodes.map((node, index) => <Run key={index} node={node} path={path} />)
}

function Run({ node, path }) {
    switch (node.type) {
        case 'text':
            return node.value
        case 'code':
            return <code>{node.value}</code>
        case 'strong':
            return (
                <strong>
                    <Inline nodes={node.children} path={path} />
                </strong>
            )
        case 'em':
            return (
                <em>
                    <Inline nodes={node.children} path={path} />
                </em>
            )
        case 'del':
            return (
                <del>
                    <Inline nodes={node.children} path={path} />
                </del>
            )
        case 'br':
            return <br />
        case 'task':
            return (
                <span className={'preview-md-task' + (node.checked ? ' preview-md-task-done' : '')}>
                    <i className="material-icons md-18">
                        {node.checked ? 'check_box' : 'check_box_outline_blank'}
                    </i>
                </span>
            )
        case 'link': {
            const href = linkHref(node.href)
            if (!href) {
                return (
                    <span className="preview-md-plain" title={node.href}>
                        <Inline nodes={node.children} path={path} />
                    </span>
                )
            }
            // a new tab, because following a link must not take the listing away
            // from someone who was reading it
            return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                    <Inline nodes={node.children} path={path} />
                </a>
            )
        }
        case 'image':
            return <Picture node={node} path={path} />
        default:
            return null
    }
}

// A picture, or the words that were given for it. A document can name a file
// that is not there, and a broken-image glyph says less about it than its own
// alt text does - so a source that cannot be drawn falls back to the words.
function Picture({ node, path }) {
    const [failed, setFailed] = useState(false)
    const src = imageSrc(node.src, path)
    if (!src || failed) {
        return (
            <span className="preview-md-missing" title={node.src}>
                {node.alt || node.src}
            </span>
        )
    }
    return (
        <img
            src={src}
            alt={node.alt}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
        />
    )
}

function Blocks({ blocks, path }) {
    return blocks.map((block, index) => <Block key={index} block={block} path={path} />)
}

function Block({ block, path }) {
    switch (block.type) {
        case 'heading': {
            const Tag = 'h' + block.level
            return (
                <Tag>
                    <Inline nodes={block.inline} path={path} />
                </Tag>
            )
        }
        case 'paragraph':
            return (
                <p>
                    <Inline nodes={block.inline} path={path} />
                </p>
            )
        case 'code':
            return (
                <pre className="preview-md-pre">
                    <code>{block.value}</code>
                </pre>
            )
        case 'rule':
            return <hr />
        case 'quote':
            return (
                <blockquote>
                    <Blocks blocks={block.children} path={path} />
                </blockquote>
            )
        case 'list':
            return <List block={block} path={path} />
        case 'table':
            return <Table block={block} path={path} />
        default:
            return null
    }
}

// The box of a task item belongs to the item and not to the words in it, so it is
// put in front of the item's first paragraph - in the flow of the text, where a
// box on a line of its own would push the item down a line.
function withTask(item) {
    if (item.task === null) {
        return item.blocks
    }
    const box = { type: 'task', checked: item.task }
    const [first, ...rest] = item.blocks
    if (first && first.type === 'paragraph') {
        return [{ ...first, inline: [box, ...first.inline] }, ...rest]
    }
    return [{ type: 'paragraph', inline: [box] }, ...item.blocks]
}

function List({ block, path }) {
    const Tag = block.ordered ? 'ol' : 'ul'
    return (
        <Tag
            className={block.loose ? undefined : 'preview-md-tight'}
            start={block.ordered && block.start !== 1 ? block.start : undefined}
        >
            {block.items.map((item, index) => (
                <li key={index} className={item.task === null ? undefined : 'preview-md-task-item'}>
                    <Blocks blocks={withTask(item)} path={path} />
                </li>
            ))}
        </Tag>
    )
}

function Table({ block, path }) {
    const align = (index) => (block.align[index] ? { textAlign: block.align[index] } : undefined)
    return (
        <table>
            <thead>
                <tr>
                    {block.header.map((cell, index) => (
                        <th key={index} style={align(index)}>
                            <Inline nodes={cell} path={path} />
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {block.rows.map((row, index) => (
                    <tr key={index}>
                        {row.map((cell, column) => (
                            <td key={column} style={align(column)}>
                                <Inline nodes={cell} path={path} />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

function MarkdownBody({ node }) {
    const state = useTextSlice(node)
    // a document is parsed when the text arrives, not when the panel around it
    // draws itself again
    const blocks = useMemo(() => (hasText(state) ? parseMarkdown(state.text) : []), [state])

    if (!hasText(state)) {
        return <SliceMessage state={state} />
    }
    return (
        <>
            <TruncationNote state={state} />
            <div className="preview-markdown">
                <Blocks blocks={blocks} path={node.path} />
            </div>
        </>
    )
}

export default {
    id: 'markdown',
    name: 'Markdown',
    icon: 'article',
    // the listing calls these files text, which they are; this is the viewer that
    // reads them as the documents they were written to be
    matches: (node) => MARKDOWN.test(node.name)
        || /^text\/(x-)?markdown/i.test(node.mimetype || ''),
    Component: ({ node }) => (
        <div className="preview-text-panel preview-markdown-panel">
            <MarkdownBody node={node} />
        </div>
    ),
}
