// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { formatKind, formatSize, truncate } from '../utils.js'

// How far the contents of an expanded folder are indented, in pixels.
const INDENT = 18

function SortIcon({ column, sort }) {
    if (sort.column !== column) {
        return null
    }
    return (
        <i className="material-icons md-18">
            {sort.order === 'descending' ? 'arrow_drop_down' : 'arrow_drop_up'}
        </i>
    )
}

// The chevron in front of every folder. It is rendered for files too (as an
// empty slot) so the icons of all rows line up.
function RowCaret({ node, expanded, onToggle }) {
    if (node.type !== 'dir') {
        return <span className="row-caret" />
    }
    return (
        <button
            type="button"
            className={'row-caret' + (expanded ? ' expanded' : '')}
            title={expanded ? 'Collapse folder' : 'Expand folder'}
            aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
            aria-expanded={expanded}
            onClick={(event) => {
                // the row itself selects the folder, expanding must not
                event.stopPropagation()
                // A pointer click must not leave the keyboard focus on the
                // chevron: the space bar would toggle the folder again instead
                // of previewing whatever row is selected.
                if (event.detail > 0) {
                    event.currentTarget.blur()
                }
                onToggle(node.path)
            }}
        >
            <i className="material-icons chevron">chevron_right</i>
        </button>
    )
}

function RowIcon({ node }) {
    return node.type === 'dir'
        ? <i className="material-icons md-18">folder</i>
        : <i className="material-icons md-18 md-dark">insert_drive_file</i>
}

export default function FileList({
    rows,
    sort,
    dropTargetPath,
    expandedPaths,
    onToggleExpand,
    onRowClick,
    onRowRightClick,
    onRowDoubleClick,
    onToggleSort,
}) {
    return (
        <table cellSpacing="0" cellPadding="0" border="0">
            <thead>
                <tr>
                    <th onClick={() => onToggleSort('name')}>
                        Name <SortIcon column="name" sort={sort} />
                    </th>
                    <th onClick={() => onToggleSort('kind')}>
                        Kind <SortIcon column="kind" sort={sort} />
                    </th>
                    <th onClick={() => onToggleSort('size')}>
                        Size <SortIcon column="size" sort={sort} />
                    </th>
                    <th onClick={() => onToggleSort('ctime')}>
                        Created <SortIcon column="ctime" sort={sort} />
                    </th>
                    <th onClick={() => onToggleSort('mtime')}>
                        Last modified <SortIcon column="mtime" sort={sort} />
                    </th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row, index) => {
                    if (row.loading) {
                        return (
                            <tr key={`loading-${row.path}`} className="loading-row">
                                <td colSpan={5} style={{ paddingLeft: 18 + row.depth * INDENT }}>
                                    Loading…
                                </td>
                            </tr>
                        )
                    }

                    const { node, depth } = row
                    // Rows below the top level belong to an expanded folder.
                    // They behave like the rows of the directory itself:
                    // selectable, draggable, with a context menu of their own.
                    const nested = depth > 0
                    const expanded = node.type === 'dir' && expandedPaths.has(node.path)
                    const className = [
                        nested ? 'nested-row' : '',
                        node.isSelected ? 'selected' : '',
                        node.path === dropTargetPath ? 'drop-target' : '',
                    ].filter(Boolean).join(' ') || undefined

                    return (
                        <tr
                            key={`${node.path}-${index}`}
                            data-path={node.path}
                            data-dir={node.type === 'dir' ? 'true' : undefined}
                            className={className}
                            onClick={(event) => onRowClick(node, event)}
                            onContextMenu={(event) => onRowRightClick(node, event)}
                            onDoubleClick={(event) => onRowDoubleClick(node, event)}
                        >
                            <td style={depth > 0 ? { paddingLeft: 18 + depth * INDENT } : undefined}>
                                <RowCaret
                                    node={node}
                                    expanded={expanded}
                                    onToggle={onToggleExpand}
                                />
                                <RowIcon node={node} />
                                <span data-drag-handle style={{ marginLeft: '10px' }}>
                                    {truncate(node.name, 40)}
                                </span>
                            </td>
                            <td>{formatKind(node)}</td>
                            <td>{formatSize(node)}</td>
                            <td>{node.ctime}</td>
                            <td>{node.mtime}</td>
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}
