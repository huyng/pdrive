// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export function truncate(text, stop, clamp = ' ...') {
    if (!text) {
        return ''
    }
    return text.slice(0, stop) + (stop < text.length ? clamp : '')
}

export function formatSize(row) {
    if (row.type === 'dir') {
        return '--'
    }
    if (row.size < 1024) {
        return String(row.size) + ' Bytes'
    } else if (row.size < Math.pow(1024, 2)) {
        return String(Math.round(row.size / 1024)) + ' KB'
    } else if (row.size < Math.pow(1024, 3)) {
        return String(Math.round(row.size / Math.pow(1024, 2))) + ' MB'
    }
    return String(Math.round(row.size / Math.pow(1024, 3))) + ' GB'
}

const KIND_NOUNS = {
    audio: 'audio',
    font: 'font',
    image: 'image',
    model: 'model',
    text: 'document',
    video: 'video',
}

// "image/png" on "photo.png" reads as "PNG image" in the file list.
export function formatKind(row) {
    if (row.type === 'dir') {
        return 'Folder'
    }
    const mimetype = row.mimetype || ''
    const [group, subtype = ''] = mimetype.split('/')
    const dotted = row.name.includes('.') ? row.name.split('.').pop().toUpperCase() : ''
    const label = dotted || subtype.split(/[.+-]/).pop().toUpperCase()
    const noun = KIND_NOUNS[group] || 'file'
    if (!label) {
        return noun[0].toUpperCase() + noun.slice(1)
    }
    return `${label} ${noun}`
}

// Columns whose sort key is computed rather than read straight off the node.
const SORT_VALUES = {
    kind: formatKind,
}

export function sortNodes(nodes, { column, order }) {
    const valueOf = SORT_VALUES[column] || ((node) => node[column])
    return [...nodes].sort((a, b) => {
        // always place directories on top
        if (a.type !== b.type) {
            return a.type === 'dir' ? -1 : 1
        }
        const aValue = valueOf(a)
        const bValue = valueOf(b)
        let comparison = typeof aValue === 'string'
            ? aValue.localeCompare(bValue)
            : aValue - bValue
        if (order === 'descending') {
            comparison *= -1
        }
        return comparison
    })
}

export function basename(path) {
    const parts = path.split('/')
    return parts[parts.length - 1]
}

export function isDotfile(node) {
    return node.name.startsWith('.')
}

export function withoutDotfiles(nodes) {
    return nodes.filter((node) => !isDotfile(node))
}

// ---------------------------------------------------------------------------
// File previews
// ---------------------------------------------------------------------------

// `mimetypes.guess_type` returns None for a lot of plain text files (dotfiles,
// extensionless scripts, ...), so those are also matched by name/extension.
const TEXT_EXTENSIONS = new Set([
    'txt', 'text', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'diff', 'patch',
    'json', 'json5', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
    'env', 'gitignore', 'gitattributes', 'npmrc', 'bashrc', 'zshrc', 'editorconfig',
    'sh', 'bash', 'zsh', 'fish', 'bat', 'ps1', 'sql', 'graphql',
    'py', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte',
    'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml',
    'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'php',
    'pl', 'lua', 'swift', 'scala', 'r', 'jl', 'ex', 'exs', 'erl', 'hs', 'clj',
    'tex', 'bib', 'mk', 'cmake', 'properties', 'gradle', 'dockerfile', 'makefile',
])

const TEXT_FILENAMES = new Set([
    'dockerfile', 'makefile', 'license', 'readme', 'changelog', 'authors',
    'notice', 'procfile', 'gemfile', 'rakefile', 'vagrantfile', 'todo',
])

const TEXT_MIMETYPES = new Set([
    'application/json', 'application/xml', 'application/javascript',
    'application/x-javascript', 'application/x-sh', 'application/x-httpd-php',
    'application/x-yaml', 'application/yaml', 'application/toml',
])

function extensionOf(name) {
    const index = name.lastIndexOf('.')
    return index === -1 ? '' : name.slice(index + 1).toLowerCase()
}

// How a node should be rendered by the preview dialog: image, pdf, video,
// audio, text, or unsupported (download only).
export function previewKind(node) {
    if (!node || node.type !== 'file') {
        return 'unsupported'
    }
    const mimetype = node.mimetype || ''
    if (mimetype.startsWith('image/')) {
        return 'image'
    }
    if (mimetype === 'application/pdf') {
        return 'pdf'
    }
    if (mimetype.startsWith('video/')) {
        return 'video'
    }
    if (mimetype.startsWith('audio/')) {
        return 'audio'
    }
    if (mimetype.startsWith('text/') || TEXT_MIMETYPES.has(mimetype)) {
        return 'text'
    }
    const name = node.name.toLowerCase()
    if (TEXT_FILENAMES.has(name) || TEXT_EXTENSIONS.has(extensionOf(name))) {
        return 'text'
    }
    return 'unsupported'
}

// Copy text to the clipboard. The async clipboard API is only there on https
// pages (and on localhost), so a plain http install - which is the usual way a
// pdrive server on some other machine is reached - falls back to the old
// textarea trick instead of copying nothing.
export async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text)
            return true
        } catch (err) {
            // no permission, or no user gesture: try the fallback below
        }
    }

    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    try {
        area.select()
        return document.execCommand('copy')
    } catch (err) {
        console.error('could not copy to the clipboard', err)
        return false
    } finally {
        area.remove()
    }
}
