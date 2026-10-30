// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { serveUrl } from '../../../api.js'
import { previewKind } from '../../../utils.js'

// A video. The browser streams it from /serve with a Range request of its own,
// so seeking works without pdrive doing anything about it.
export default {
    id: 'video',
    name: 'Video',
    matches: (node) => previewKind(node) === 'video',
    Component: ({ node }) => (
        <video className="preview-media" src={serveUrl(node.path)} controls />
    ),
}
