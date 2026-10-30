// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

// The viewers of the file browser: one module per family of files, and the list
// that decides which of them shows a given node.
//
// A viewer is an object with three parts and no more:
//
//   id         a short stable name; it is also the CSS hook
//              (`preview-content-<id>`) and what the dialog reports
//   name       what a person reads, for a viewer picker or a menu one day
//   matches    (node) -> boolean. A question about the listing node only: no
//              fetch, no promise, no state. Ask `previewKind(node)` for the
//              families the listing already knows (image, pdf, video, audio,
//              text), or look at `node.name` for something narrower - a
//              markdown viewer is `/\.md$/`, and adding it changes nothing
//              outside its own file.
//   Component  ({ node }) -> element. It owns how the file is fetched and
//              drawn, and nothing else: the dialog around it is the same size,
//              the same bar, the same arrows whatever is inside.
//
// The list is precedence, first match wins, so the specific viewers go above
// the general ones and the text viewer goes last: it is the one that claims
// everything that reads as text.
//
// Adding a viewer is therefore two steps with no coupling: write the file, put
// it in this list. A second step is only needed if the *icon* for a family
// changes too, which lives in `utils.js` because the listing draws it.

import AudioViewer from './AudioViewer.jsx'
import ImageViewer from './ImageViewer.jsx'
import PdfViewer from './PdfViewer.jsx'
import TextViewer from './TextViewer.jsx'
import VideoViewer from './VideoViewer.jsx'

export const VIEWERS = [
    ImageViewer,
    PdfViewer,
    VideoViewer,
    AudioViewer,
    TextViewer,
]

// The viewer that shows this node, or null when nothing can (the dialog then
// says so and offers the download). A directory has no viewer: it is opened,
// not looked at.
export function viewerFor(node) {
    if (!node || node.type !== 'file') {
        return null
    }
    return VIEWERS.find((viewer) => viewer.matches(node)) ?? null
}
