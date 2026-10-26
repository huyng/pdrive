// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { serveUrl } from '../api.js'
import { previewKind, truncate } from '../utils.js'

function TilePreview({ node }) {
    if (node.type === 'dir') {
        return <i className="material-icons" style={{ lineHeight: '100px', fontSize: '64px' }}>folder</i>
    }
    if (previewKind(node) === 'image') {
        return (
            <img
                width="100"
                height="100"
                style={{ border: '1px solid #eee', objectFit: 'cover' }}
                alt={node.name}
                src={serveUrl(node.path)}
            />
        )
    }
    return (
        <i
            className="material-icons md-24 md-dark"
            style={{ lineHeight: '100px', fontSize: '64px' }}
        >
            insert_drive_file
        </i>
    )
}

export default function FileGrid({ nodes, onRowClick, onRowRightClick, onRowDoubleClick }) {
    return (
        <div className="grid-view noselect">
            {nodes.map((node, index) => (
                <div
                    key={`${node.path}-${index}`}
                    className={`grid-item${node.isSelected ? ' selected' : ''}`}
                    onClick={(event) => onRowClick(node, event)}
                    onContextMenu={(event) => onRowRightClick(node, event)}
                    onDoubleClick={(event) => onRowDoubleClick(node, event)}
                >
                    <div className="grid-item-preview">
                        <TilePreview node={node} />
                    </div>
                    <div className="filename">
                        <span style={{ marginLeft: '10px' }}>{truncate(node.name, 40)}</span>
                    </div>
                </div>
            ))}
        </div>
    )
}
