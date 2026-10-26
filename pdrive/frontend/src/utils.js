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

export function sortNodes(nodes, { column, order }) {
    return [...nodes].sort((a, b) => {
        // always place directories on top
        if (a.type !== b.type) {
            return a.type === 'dir' ? -1 : 1
        }
        const aValue = a[column]
        const bValue = b[column]
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
