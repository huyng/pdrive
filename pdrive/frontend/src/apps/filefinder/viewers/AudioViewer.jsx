// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { serveUrl } from '../../../api.js'
import { previewKind } from '../../../utils.js'

// A sound file: the browser's own player, the same way the video viewer works.
export default {
    id: 'audio',
    name: 'Audio',
    matches: (node) => previewKind(node) === 'audio',
    Component: ({ node }) => (
        <audio className="preview-media" src={serveUrl(node.path)} controls />
    ),
}
