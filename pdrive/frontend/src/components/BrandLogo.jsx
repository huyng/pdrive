// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

// The folder of the app icon on its own: the same drawing as public/favicon.svg
// without the blue tile around it, so it sits straight on the header bar. The
// tab, the back panel and the front panel are kept in three pieces because that
// is what makes the shape read as a folder at 22px.

// Drawn as it is, the folder is 42 wide by 36 tall and reads as a squat box
// beside the word mark. Stretching it about its own middle gives it the
// proportions of the folders in the listing without widening it or taking any
// more room on the bar: 22px of box still holds the whole glyph.
const FOLDER_SCALE_Y = 1.12

export default function BrandLogo({ size = 22 }) {
    return (
        <svg
            className="logo-icon"
            width={size}
            height={size}
            viewBox="0 0 64 64"
            aria-hidden="true"
            focusable="false"
        >
            <g transform={`translate(0 32) scale(1 ${FOLDER_SCALE_Y}) translate(0 -32)`}>
                {/* back panel, with the tab of the folder */}
                <path
                    fill="#D8EBFD"
                    d="M11 18.5a4.5 4.5 0 0 1 4.5-4.5h9.2a4.5 4.5 0 0 1 3.5 1.7l2.6 2.8H48.5a4.5 4.5 0 0 1 4.5 4.5V27H11z"
                />
                {/* front panel */}
                <path
                    fill="#FFFFFF"
                    d="M11 25h42v20.5a4.5 4.5 0 0 1-4.5 4.5H15.5a4.5 4.5 0 0 1-4.5-4.5z"
                />
                {/* the seam between the two panels */}
                <path d="M11 25h42" stroke="#0B62B8" strokeOpacity=".18" strokeWidth="1.6" />
            </g>
        </svg>
    )
}
