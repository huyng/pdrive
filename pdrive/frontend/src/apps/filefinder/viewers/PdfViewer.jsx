// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { serveUrl } from '../../../api.js'
import { previewKind } from '../../../utils.js'

// A PDF, shown by the browser's own viewer in a frame. It brings its own
// toolbar and its own scrolling, which is why it does not try to be a picture.
export default {
    id: 'pdf',
    name: 'PDF',
    matches: (node) => previewKind(node) === 'pdf',
    Component: ({ node }) => (
        <iframe className="preview-frame" src={serveUrl(node.path)} title={node.name} />
    ),
}
