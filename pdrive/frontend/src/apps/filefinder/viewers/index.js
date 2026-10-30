// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

// The viewers of the file browser: one module per family of files, and the list
// that decides which of them shows a given node.
//
// A viewer is an object with four parts and no more:
//
//   id         a short stable name; it is also the CSS hook
//              (`preview-content-<id>`) and what the dialog reports
//   name       what a person reads. It names the viewer where a choice of
//              viewer is offered, so it has to say what the reading is
//   icon       a Material icon name, drawn on that same control: the one thing
//              a bar of 32px buttons has room for
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
// Two viewers claiming the same file is therefore not a conflict to settle in
// this list. A markdown file is also text, and both are honest readings of it:
// `viewersFor` returns everything that claims the node, the preview offers the
// other one in its bar, and which of them is right is the reader's business.
//
// Adding a viewer is therefore two steps with no coupling: write the file, put
// it in this list. A second step is only needed if the *icon* for a family
// changes too, which lives in `utils.js` because the listing draws it.

import AudioViewer from './AudioViewer.jsx'
import ImageViewer from './ImageViewer.jsx'
import MarkdownViewer from './MarkdownViewer.jsx'
import PdfViewer from './PdfViewer.jsx'
import TextViewer from './TextViewer.jsx'
import VideoViewer from './VideoViewer.jsx'

export const VIEWERS = [
    ImageViewer,
    PdfViewer,
    VideoViewer,
    AudioViewer,
    MarkdownViewer,
    TextViewer,
]

// Every viewer that claims this node, in precedence order. A directory has none:
// it is opened, not looked at.
export function viewersFor(node) {
    if (!node || node.type !== 'file') {
        return []
    }
    return VIEWERS.filter((viewer) => viewer.matches(node))
}

// The viewer that shows this node, or null when nothing can (the dialog then
// says so and offers the download). `viewId` is a viewer the reader picked out
// of `viewersFor`; one that no longer claims the file is not obeyed, and the
// first viewer claims it as it always would.
export function viewerFor(node, viewId = null) {
    const viewers = viewersFor(node)
    if (viewId) {
        const chosen = viewers.find((viewer) => viewer.id === viewId)
        if (chosen) {
            return chosen
        }
    }
    return viewers[0] ?? null
}
