// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { previewUrl } from '../../../api.js'

// An HTML file, drawn as the page it is.
//
// A page is not a picture: it has its own scripts, its own stylesheet and its
// own idea of what to load next, and the only honest way to show one is to let
// the browser run it. So this is an <iframe>, and the whole of the security
// story is the two attributes on it plus what the server sends with the file.
//
// `sandbox="allow-scripts"` and *not* `allow-same-origin`. Without the second
// token the frame's document gets an opaque origin: it cannot read this app's
// DOM (`window.parent`), its `localStorage`, or its cookies, and every request
// it makes is a cross-origin one - which the server refuses to answer for the
// API (see `CrossSiteGuard`), and refuses to let the page read for anything
// else. The `allow-scripts` token is there because the pages worth previewing -
// an exported notebook, a report with a chart - are scripts; dropping it would
// show a blank frame for them. Everything else is left out on purpose:
//
//   allow-same-origin      would undo all of the above
//   allow-forms            a POST from the page is exactly what we do not want
//   allow-popups           opens a window this app cannot see or close
//   allow-top-navigation   lets the file navigate away from pdrive itself
//   allow-modals           alert/confirm/prompt, dressed as this app's dialogs
//   allow-downloads        writes files the user did not ask this page for
//
// The server sends the same sandbox in a `Content-Security-Policy` header, so
// opening the URL from the preview's "download" menu, a pasted link or another
// tab is the same opaque document and not a same-origin page with an API key.
const HTML_MIMETYPES = new Set(['text/html', 'application/xhtml+xml'])
const HTML_NAME = /\.(html?|xhtml)$/i

export default {
    id: 'html',
    name: 'Page',
    // the reader may still want the source: the text viewer claims this file
    // too, and the bar offers it as the other reading
    icon: 'html',
    matches: (node) => HTML_MIMETYPES.has(node.mimetype) || HTML_NAME.test(node.name),
    Component: ({ node }) => (
        <iframe
            className="preview-frame"
            src={previewUrl(node.path)}
            title={node.name}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
        />
    ),
}
