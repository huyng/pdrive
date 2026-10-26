// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { formatSize, truncate } from '../utils.js'

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

export default function FileList({ nodes, sort, onRowClick, onRowRightClick, onRowDoubleClick, onToggleSort }) {
    return (
        <table cellSpacing="0" cellPadding="0" border="0">
            <thead>
                <tr>
                    <th onClick={() => onToggleSort('name')}>
                        Name <SortIcon column="name" sort={sort} />
                    </th>
                    <th onClick={() => onToggleSort('size')}>
                        Size <SortIcon column="size" sort={sort} />
                    </th>
                    <th onClick={() => onToggleSort('mtime')}>
                        Last modified <SortIcon column="mtime" sort={sort} />
                    </th>
                </tr>
            </thead>
            <tbody>
                {nodes.map((node, index) => (
                    <tr
                        key={`${node.path}-${index}`}
                        data-path={node.path}
                        className={node.isSelected ? 'selected' : undefined}
                        onClick={(event) => onRowClick(node, event)}
                        onContextMenu={(event) => onRowRightClick(node, event)}
                        onDoubleClick={(event) => onRowDoubleClick(node, event)}
                    >
                        <td>
                            {node.type === 'dir'
                                ? <i className="material-icons md-18">folder</i>
                                : <i className="material-icons md-18 md-dark">insert_drive_file</i>}
                            <span style={{ marginLeft: '10px' }}>{truncate(node.name, 40)}</span>
                        </td>
                        <td>{formatSize(node)}</td>
                        <td>{node.mtime}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
