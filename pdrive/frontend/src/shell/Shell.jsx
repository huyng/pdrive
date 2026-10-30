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

import FileFinder from '../apps/filefinder/FileFinder.jsx'
import TooltipLayer from '../components/Tooltip.jsx'

// The shell is where windows, the dock and the app loader will live. Today it
// hosts one app and no chrome, so that everything the file browser does still
// happens exactly as it did when it was the whole page.
export default function Shell() {
    return (
        <>
            <FileFinder />
            {/* the tooltips of every control in every app: one bubble, drawn in a
                portal, for anything carrying `data-tip` */}
            <TooltipLayer />
        </>
    )
}
