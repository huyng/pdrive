// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { serveUrl } from '../../../api.js'
import { previewKind } from '../../../utils.js'

// A picture, drawn by the browser itself: the largest thing in the dialog is an
// <img> pointed at /serve, and the file is never read into memory here.
export default {
    id: 'image',
    name: 'Image',
    matches: (node) => previewKind(node) === 'image',
    Component: ({ node }) => (
        <img className="preview-media" src={serveUrl(node.path)} alt={node.name} />
    ),
}
