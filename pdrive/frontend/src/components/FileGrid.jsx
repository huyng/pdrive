// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { truncate } from '../utils.js'

const IMAGE_MIMETYPES = ['image/jpeg', 'image/png']

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
                        {node.type === 'dir' && (
                            <i className="material-icons" style={{ lineHeight: '100px', fontSize: '64px' }}>folder</i>
                        )}
                        {node.type === 'file' && IMAGE_MIMETYPES.includes(node.mimetype) && (
                            <img
                                width="100"
                                height="100"
                                style={{ border: '1px solid #eee' }}
                                alt={node.name}
                                src={'/download?file=' + node.path}
                            />
                        )}
                        {node.type === 'file' && !IMAGE_MIMETYPES.includes(node.mimetype) && (
                            <i
                                className="material-icons md-24 md-dark"
                                style={{ lineHeight: '100px', fontSize: '64px' }}
                            >
                                insert_drive_file
                            </i>
                        )}
                    </div>
                    <div className="filename">
                        <span style={{ marginLeft: '10px' }}>{truncate(node.name, 40)}</span>
                    </div>
                </div>
            ))}
        </div>
    )
}
