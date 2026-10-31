// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { useCallback, useEffect, useState } from 'react'

// Where in the browser's history the page is, and how to move it.
//
// The browser will not say which entry is showing, nor whether there is
// anything ahead of it, so the page counts for itself: every entry it writes
// carries its own step number, and the highest number written in this session is
// remembered. Stepping back leaves that highest alone - which is what makes
// "forward" a question with an answer - until a fresh push overwrites the
// entries ahead of us, exactly as the browser drops its forward list.
//
// The count starts when the app does: whatever the tab visited before pdrive
// loaded is the browser's business, and stays reachable through its own buttons
// and keyboard shortcuts.

const STEP = 'step'

function stepOf(state) {
    const step = state?.[STEP]
    return Number.isInteger(step) && step >= 0 ? step : 0
}

export default function useHistoryNav() {
    const [position, setPosition] = useState(() => {
        // a reload keeps the state of the entry it reloads, so the count
        // survives one
        const step = stepOf(window.history.state)
        return { step, furthest: step }
    })

    // Something moved the history: a browser button, a keyboard shortcut, or a
    // script. Whatever entry it landed on says where we are now; the furthest
    // only ever grows.
    useEffect(() => {
        const handlePopState = () => {
            const step = stepOf(window.history.state)
            setPosition((prev) => ({ step, furthest: Math.max(prev.furthest, step) }))
        }
        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [])

    // Show something new in the location: the entry that was showing becomes the
    // one behind, and the entries that were ahead are gone.
    const push = useCallback((state, url) => {
        const step = stepOf(window.history.state) + 1
        window.history.pushState({ ...state, [STEP]: step }, '', url)
        setPosition({ step, furthest: step })
    }, [])

    // Correct the entry being shown instead of adding one: the app was loaded on
    // a URL that has since been resolved to a directory, or asked for a
    // directory that no longer exists and had to fall back to another.
    const replace = useCallback((state, url) => {
        const step = stepOf(window.history.state)
        window.history.replaceState({ ...state, [STEP]: step }, '', url)
        setPosition((prev) => ({ step, furthest: Math.max(prev.furthest, step) }))
    }, [])

    const goBack = useCallback(() => window.history.back(), [])
    const goForward = useCallback(() => window.history.forward(), [])

    return {
        canGoBack: position.step > 0,
        canGoForward: position.step < position.furthest,
        push,
        replace,
        goBack,
        goForward,
    }
}
