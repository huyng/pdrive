// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { previewKind } from '../../../utils.js'

import { hasText, SliceMessage, TruncationNote, useTextSlice } from './textSlice.jsx'

// The last viewer in the list and the widest: whatever reads as text. It is
// also the one that has to be careful, because "text" includes the 2 GB log and
// the file that only claims to be text - so it reads a slice (`useTextSlice`
// asks for the first 64 KiB with a Range request) and believes the NUL byte
// that says the slice is not text after all.
function TextBody({ node }) {
    const state = useTextSlice(node)

    if (!hasText(state)) {
        return <SliceMessage state={state} />
    }
    return (
        <>
            <pre className="preview-text">{state.text}</pre>
            <TruncationNote state={state} />
        </>
    )
}

export default {
    id: 'text',
    name: 'Text',
    // a file of text, read as the characters it holds: the icon of source code
    // rather than of a page, since that is the reading being offered
    icon: 'code',
    matches: (node) => previewKind(node) === 'text',
    Component: ({ node }) => (
        <div className="preview-text-panel">
            <TextBody node={node} />
        </div>
    ),
}
