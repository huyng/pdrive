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
