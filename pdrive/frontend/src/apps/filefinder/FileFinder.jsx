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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import BrandLogo from '../../components/BrandLogo.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import ContextMenu from '../../components/ContextMenu.jsx'
import Dropdown from '../../components/Dropdown.jsx'
import FileGrid from '../../components/FileGrid.jsx'
import FileList from '../../components/FileList.jsx'
import JobProgressPanel from '../../components/JobProgressPanel.jsx'
import PreviewDialog from '../../components/PreviewDialog.jsx'
import PromptDialog from '../../components/PromptDialog.jsx'
import UploadHint from '../../components/UploadHint.jsx'
import { downloadUrl, fetchListing, postCommand, uploadFile } from '../../api.js'
import { newJobId, startJob } from '../../sdk/kernel.js'
import { track } from '../../jobs.js'
import useDragMove from '../../useDragMove.js'
import useDragSelect from '../../useDragSelect.js'
import { basename, copyToClipboard, isDotfile, previewKind, sortNodes, withoutDotfiles } from '../../utils.js'

// The current directory is mirrored into the URL hash so that the browser's
// back/forward buttons (and their keyboard shortcuts) move between visited
// directories. A hash is used instead of a real path because the backend only
// serves index.html from "/".
const PATH_HASH_PREFIX = '#path='

function pathFromLocation() {
    const { hash } = window.location
    if (!hash.startsWith(PATH_HASH_PREFIX)) {
        return null
    }
    try {
        return decodeURIComponent(hash.slice(PATH_HASH_PREFIX.length)) || null
    } catch (err) {
        return null
    }
}

// Only a zip archive can be unpacked, and only a file can be one.
function isZipNode(node) {
    return Boolean(node) && node.type !== 'dir' && /\.zip$/i.test(node.name)
}

function writeLocationPath(path, { replace = false } = {}) {
    const url = path
        ? PATH_HASH_PREFIX + encodeURIComponent(path)
        : window.location.pathname + window.location.search
    if (replace) {
        window.history.replaceState({ path }, '', url)
    } else {
        window.history.pushState({ path }, '', url)
    }
}

export default function FileFinder() {
    const [basedir, setBasedir] = useState('')
    const [cwd, setCwd] = useState('')
    const [hostname, setHostname] = useState(null)          // null until the backend reports it
    const [nodes, setNodes] = useState([])
    const [lastClickedPath, setLastClickedPath] = useState(null)
    const [viewMode, setViewMode] = useState('list')       // possible values: list, grid
    const [showDotfiles, setShowDotfiles] = useState(false)
    const [sort, setSort] = useState({ column: 'mtime', order: 'descending' })

    // Folders expanded in place in the list view: the paths that are open and
    // the listing of each of them, fetched the first time it is needed.
    const [expandedPaths, setExpandedPaths] = useState(() => new Set())
    const [childListings, setChildListings] = useState(() => new Map())
    const loadingChildren = useRef(new Set())

    const [menu, setMenu] = useState({ visible: false, x: 100, y: 100 })
    const [renameDialog, setRenameDialog] = useState({ visible: false, node: null, value: '' })
    const [copyDialog, setCopyDialog] = useState({ visible: false, node: null, value: '' })
    const [newFolderDialog, setNewFolderDialog] = useState({ visible: false, value: '' })
    // the permanent delete is the one action that cannot be undone, so it gets
    // a confirmation step and keeps the paths it was opened with
    const [deleteDialog, setDeleteDialog] = useState({ visible: false, paths: [] })
    const [preview, setPreview] = useState({ open: false, node: null })

    // Files dragged in from outside the browser: the hint follows the drag,
    // `target` is the folder tile or row under the pointer, if any.
    const [uploadDrag, setUploadDrag] = useState({ visible: false, target: null })
    const filePickerRef = useRef(null)
    // A short-lived message for things the browser should have told the user
    // about but does not (a dropped folder, for instance).
    const [notice, setNotice] = useState(null)
    const noticeTimer = useRef(0)

    const visibleNodes = useMemo(() => (
        showDotfiles ? nodes : withoutDotfiles(nodes)
    ), [nodes, showDotfiles])
    const sortedNodes = useMemo(() => sortNodes(visibleNodes, sort), [visibleNodes, sort])
    const selectedNodes = useMemo(() => {
        const selected = visibleNodes.filter((node) => node.isSelected)
        // the contents of expanded folders are selectable too
        childListings.forEach((list) => {
            list.forEach((node) => {
                if (node.isSelected && (showDotfiles || !isDotfile(node))) {
                    selected.push(node)
                }
            })
        })
        return selected
    }, [visibleNodes, childListings, showDotfiles])

    // The rows of the list view: every expanded folder is followed by its
    // contents, which are indented and can be expanded in turn.
    const listRows = useMemo(() => {
        const rows = []
        const walk = (items, depth) => {
            sortNodes(showDotfiles ? items : withoutDotfiles(items), sort).forEach((node) => {
                rows.push({ node, depth })
                if (node.type !== 'dir' || !expandedPaths.has(node.path)) {
                    return
                }
                const children = childListings.get(node.path)
                if (children) {
                    walk(children, depth + 1)
                } else {
                    // still being fetched
                    rows.push({ loading: true, path: node.path, depth: depth + 1 })
                }
            })
        }
        walk(nodes, 0)
        return rows
    }, [nodes, sort, showDotfiles, expandedPaths, childListings])

    // The files the preview dialog can show, in the order they appear on screen;
    // used for the prev/next arrows.
    const previewableNodes = useMemo(
        () => listRows
            .filter((row) => row.node && previewKind(row.node) !== 'unsupported')
            .map((row) => row.node),
        [listRows],
    )
    const previewIndex = preview.node
        ? previewableNodes.findIndex((node) => node.path === preview.node.path)
        : -1

    const selectedPaths = useMemo(() => selectedNodes.map((node) => node.path), [selectedNodes])

    // Selection is kept on the node copies held by the listing of the current
    // directory and by the expanded folders, so that the grid, the list and the
    // context menu all see the same thing. This updates both in one go.
    const applySelection = useCallback((isSelected) => {
        const mark = (node) => {
            const wanted = isSelected(node)
            return node.isSelected === wanted ? node : { ...node, isSelected: wanted }
        }
        setNodes((prev) => prev.map(mark))
        setChildListings((prev) => {
            let changed = false
            const next = new Map()
            prev.forEach((list, path) => {
                const marked = list.map(mark)
                if (marked.some((node, index) => node !== list[index])) {
                    changed = true
                }
                next.set(path, marked)
            })
            return changed ? next : prev
        })
    }, [])

    // Reload the current directory and drop the cached listings of expanded
    // folders (they are fetched again); the folders stay open. Used after a
    // command that changed what the server has on disk.
    const reloadCurrent = useCallback(async () => {
        try {
            const data = cwd
                ? await postCommand({ command: 'ls', path: cwd })
                : await fetchListing()
            setNodes(data.nodes.map((node) => ({ ...node, isSelected: false })))
            setChildListings(new Map())
            loadingChildren.current.clear()
            setLastClickedPath(null)
        } catch (err) {
            console.error('could not reload', cwd, err)
        }
    }, [cwd])

    // Rubber-band selection: the hook reports every path the drag rectangle
    // touches, this replaces (or extends, with meta/ctrl/shift) the selection.
    const handleMarqueeSelect = useCallback((paths) => {
        const selection = new Set(paths)
        applySelection((node) => selection.has(node.path))
    }, [applySelection])

    const {
        containerRef: selectionRef,
        marquee,
        onMouseDown: handleSelectionMouseDown,
        onClickCapture: handleSelectionClickCapture,
    } = useDragSelect({ selectedPaths, onSelect: handleMarqueeSelect })

    // Every component of the current path gets its own crumb, all the way up to
    // the filesystem root, so any ancestor directory can be reached in one click.
    const pathSegments = useMemo(() => {
        if (!cwd) {
            return []
        }
        const segments = [{ name: '/', path: '/' }]
        let fullPath = ''
        cwd.split('/').filter((component) => component !== '').forEach((component) => {
            fullPath += '/' + component
            segments.push({ name: component, path: fullPath })
        })
        return segments
    }, [cwd])

    // Long trails scroll; keep the current directory (the right end) in view.
    const breadcrumbRef = useRef(null)
    useEffect(() => {
        const element = breadcrumbRef.current
        if (element) {
            element.scrollLeft = element.scrollWidth
        }
    }, [cwd])

    const menuVisibility = useMemo(() => {
        // Duplicate / rename / download only make sense for a single selection
        const single = selectedNodes.length <= 1
        const only = selectedNodes.length === 1 ? selectedNodes[0] : null
        return {
            preview: selectedNodes.length === 1,
            copy: single,
            rename: single,
            copyPath: true,
            download: single,
            // anything can be compressed unless the whole selection is made of
            // archives already, and a single archive is what can be extracted
            compress: selectedNodes.length > 0 && !selectedNodes.every(isZipNode),
            extract: isZipNode(only),
            trash: true,
            deletePermanently: true,
        }
    }, [selectedNodes])

    const applyListing = useCallback((data) => {
        setCwd(data.cwd)
        setBasedir(data.basedir)
        if (data.hostname !== undefined) {
            setHostname(data.hostname)
        }
        setNodes(data.nodes.map((node) => ({ ...node, isSelected: false })))
        // an expanded folder belongs to the directory that was showing it
        setExpandedPaths(new Set())
        setChildListings(new Map())
        loadingChildren.current.clear()
    }, [])

    // ---------------------------------------------------------------------
    // Expanding folders in place (list view)
    // ---------------------------------------------------------------------

    const loadChildren = useCallback(async (path) => {
        if (loadingChildren.current.has(path)) {
            return
        }
        loadingChildren.current.add(path)
        try {
            const data = await postCommand({ command: 'ls', path })
            setChildListings((prev) => {
                const next = new Map(prev)
                next.set(path, data.nodes)
                return next
            })
        } catch (err) {
            console.error('could not list', path, err)
            setExpandedPaths((prev) => {
                const next = new Set(prev)
                next.delete(path)
                return next
            })
        } finally {
            loadingChildren.current.delete(path)
        }
    }, [])

    // Expanded folders without a listing yet (just opened, or invalidated) are
    // fetched here.
    useEffect(() => {
        expandedPaths.forEach((path) => {
            if (!childListings.has(path)) {
                loadChildren(path)
            }
        })
    }, [expandedPaths, childListings, loadChildren])

    const toggleExpanded = useCallback((path) => {
        setExpandedPaths((prev) => {
            const next = new Set(prev)
            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }
            return next
        })
    }, [])

    // The machine pdrive serves files from. The name the backend reports beats
    // window.location.hostname, which is usually just localhost when the server
    // is reached through an ssh tunnel.
    const hostLabel = useMemo(
        () => (hostname === null ? '' : hostname || window.location.hostname),
        [hostname],
    )

    // Label the tab with that machine too
    useEffect(() => {
        document.title = hostLabel ? `${hostLabel} - pdrive` : 'pdrive'
    }, [hostLabel])

    // Monotonic id so that a slow response from an older navigation can never
    // overwrite the directory the user is currently looking at.
    const navigationId = useRef(0)

    const loadDirectory = useCallback(async (path) => {
        const id = ++navigationId.current
        try {
            const data = path
                ? await postCommand({ command: 'ls', path })
                : await fetchListing()
            if (id !== navigationId.current) {
                return null
            }
            applyListing(data)
            return data
        } catch (err) {
            if (id === navigationId.current) {
                console.error('could not load listing for', path, err)
            }
            return null
        }
    }, [applyListing])

    // the equivalent of the old Vue component's `created` hook, plus the
    // browser history integration that powers back/forward navigation
    useEffect(() => {
        const restoreDirectory = async () => {
            const path = pathFromLocation()
            const data = await loadDirectory(path)
            if (!data && path) {
                // the directory we were asked for is gone (or unreadable),
                // fall back to the base directory
                const fallback = await loadDirectory(null)
                if (fallback) {
                    writeLocationPath(fallback.cwd, { replace: true })
                }
                return
            }
            // the entry that loaded the app should already point at the
            // directory being displayed, so back doesn't leave the app
            if (data) {
                writeLocationPath(data.cwd, { replace: true })
            }
        }

        const handlePopState = () => {
            const path = pathFromLocation()
            loadDirectory(path).then((data) => {
                if (!data && path) {
                    loadDirectory(null).then((fallback) => {
                        if (fallback) {
                            writeLocationPath(fallback.cwd, { replace: true })
                        }
                    })
                }
            })
        }

        restoreDirectory()
        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [loadDirectory])

    const openFolder = useCallback(async (path) => {
        const data = await loadDirectory(path)
        if (data && data.cwd !== pathFromLocation()) {
            writeLocationPath(data.cwd)
        }
    }, [loadDirectory])

    // ---------------------------------------------------------------------
    // Drag to move
    // ---------------------------------------------------------------------

    // Drag the selected rows (or just the row whose filename was grabbed) onto
    // a folder to move them there.
    const handleMoveNodes = useCallback(async (paths, destination) => {
        try {
            await postCommand({ command: 'mv', paths, destination })
        } catch (err) {
            console.error('could not move', paths, 'to', destination, err)
            return
        }
        await reloadCurrent()
    }, [reloadCurrent])

    const {
        ghost: moveGhost,
        dropTargetPath,
        onMouseDown: handleMoveMouseDown,
        onClickCapture: handleMoveClickCapture,
    } = useDragMove({ containerRef: selectionRef, selectedPaths, onMove: handleMoveNodes })

    // The surface is shared by both drag gestures: the move hook only reacts to
    // mousedowns on a filename, the rubber band only to everything else.
    const handleSurfaceMouseDown = useCallback((event) => {
        handleMoveMouseDown(event)
        handleSelectionMouseDown(event)
    }, [handleMoveMouseDown, handleSelectionMouseDown])

    const handleSurfaceClickCapture = useCallback((event) => {
        handleMoveClickCapture(event)
        handleSelectionClickCapture(event)
    }, [handleMoveClickCapture, handleSelectionClickCapture])

    // ---------------------------------------------------------------------
    // File preview
    // ---------------------------------------------------------------------

    const openPreview = useCallback((node) => {
        if (!node) {
            return
        }
        if (node.type === 'dir') {
            openFolder(node.path)
            return
        }
        setPreview({ open: true, node })
    }, [openFolder])

    const closePreview = useCallback(() => setPreview({ open: false, node: null }), [])

    const showPreviewNeighbor = useCallback((offset) => {
        setPreview((prev) => {
            if (!prev.node) {
                return prev
            }
            const index = previewableNodes.findIndex((node) => node.path === prev.node.path)
            const neighbor = previewableNodes[index + offset]
            return neighbor ? { open: true, node: neighbor } : prev
        })
    }, [previewableNodes])

    const handlePreviewPrev = useCallback(() => showPreviewNeighbor(-1), [showPreviewNeighbor])
    const handlePreviewNext = useCallback(() => showPreviewNeighbor(1), [showPreviewNeighbor])

    const handlePreviewDownload = useCallback(() => {
        if (preview.node) {
            window.open(downloadUrl(preview.node.path))
        }
    }, [preview.node])

    // space bar previews the selected file, the way Quick Look does
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key !== ' ' && event.code !== 'Space') {
                return
            }
            if (event.altKey || event.ctrlKey || event.metaKey) {
                return
            }
            // leave typing and focused controls alone
            const target = event.target
            if (target instanceof HTMLElement && (
                target.isContentEditable
                || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
            )) {
                return
            }
            if (preview.open || selectedNodes.length !== 1) {
                return
            }
            const node = selectedNodes[0]
            if (node.type !== 'file') {
                return
            }
            event.preventDefault()  // don't scroll the listing
            setMenu((prev) => ({ ...prev, visible: false }))
            openPreview(node)
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [openPreview, preview.open, selectedNodes])

    // Arrow keys walk the listing, in both views. In the grid sideways keys hop
    // one tile over, a row at a time. The list view is a tree, so there they
    // fold and unfold the folders in place instead: right opens a folder, or
    // steps into it once it is open, left closes it, or jumps back up to the
    // folder the row sits in.
    useEffect(() => {
        const dialogOpen = preview.open
            || renameDialog.visible
            || copyDialog.visible
            || newFolderDialog.visible
        if (dialogOpen || menu.visible) {
            return undefined
        }

        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

        const handleKeyDown = (event) => {
            if (!arrows.includes(event.key)) {
                return
            }
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                return
            }
            const target = event.target
            if (target instanceof HTMLElement && (
                target.isContentEditable
                || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
            )) {
                return
            }

            // the rows on screen, top to bottom, then left to right
            const rows = viewMode === 'grid' ? [] : listRows.filter((row) => row.node)
            const paths = viewMode === 'grid'
                ? sortedNodes.map((node) => node.path)
                : rows.map((row) => row.node.path)
            if (paths.length === 0) {
                return
            }
            event.preventDefault()  // the arrows must not scroll the listing

            // the cursor: the row that was clicked last, or else the top of
            // the selection
            let index = lastClickedPath ? paths.indexOf(lastClickedPath) : -1
            if (index < 0) {
                const selected = selectedNodes.find((node) => paths.includes(node.path))
                index = selected ? paths.indexOf(selected.path) : -1
            }

            const selectPath = (path) => {
                applySelection((node) => node.path === path)
                setLastClickedPath(path)
                const container = selectionRef.current
                const row = container
                    && [...container.querySelectorAll('[data-path]')]
                        .find((element) => element.getAttribute('data-path') === path)
                // follow the cursor when it walks out of sight
                row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }

            // the row that many places away, walking off the end means the
            // cursor stays where it is (only an empty cursor moves to the top)
            const stepBy = (delta) => {
                if (index < 0) {
                    return paths[0]
                }
                const next = index + delta
                if (next < 0 || next >= paths.length) {
                    return null
                }
                return paths[next]
            }

            const moveTo = (delta) => {
                const path = stepBy(delta)
                if (path) {
                    selectPath(path)
                }
            }

            if (viewMode === 'grid') {
                const grid = selectionRef.current?.querySelector('.grid-view')
                const columns = grid
                    ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1
                    : 1
                if (event.key === 'ArrowLeft') {
                    moveTo(-1)
                } else if (event.key === 'ArrowRight') {
                    moveTo(1)
                } else if (event.key === 'ArrowUp') {
                    moveTo(-columns)
                } else {
                    moveTo(columns)
                }
                return
            }

            if (index < 0) {
                // nothing to move from: start at the top
                selectPath(paths[0])
                return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                moveTo(event.key === 'ArrowDown' ? 1 : -1)
                return
            }

            const node = rows[index].node
            const depth = rows[index].depth
            if (event.key === 'ArrowRight') {
                if (node.type !== 'dir') {
                    return
                }
                if (!expandedPaths.has(node.path)) {
                    toggleExpanded(node.path)
                    return
                }
                const below = rows[index + 1]
                if (below && below.node && below.depth > depth) {
                    selectPath(below.node.path)
                }
                return
            }

            // ArrowLeft
            if (node.type === 'dir' && expandedPaths.has(node.path)) {
                toggleExpanded(node.path)
                return
            }
            for (let up = index - 1; depth > 0 && up >= 0; up -= 1) {
                if (rows[up].depth < depth) {
                    selectPath(rows[up].node.path)
                    return
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [
        applySelection,
        copyDialog.visible,
        expandedPaths,
        lastClickedPath,
        listRows,
        menu.visible,
        newFolderDialog.visible,
        preview.open,
        renameDialog.visible,
        selectedNodes,
        sortedNodes,
        toggleExpanded,
        viewMode,
    ])

    const clearSelection = useCallback(() => {
        applySelection(() => false)
    }, [applySelection])

    const handleAppClick = useCallback(() => {
        setMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev))
        clearSelection()
    }, [clearSelection])

    const handleRowClick = useCallback((row, event) => {
        event.stopPropagation()
        setMenu((prev) => ({ ...prev, visible: false }))

        // take the keyboard focus off whatever button was clicked last, or the
        // space bar would activate that button (the chevron of a folder, say)
        // instead of previewing the selection
        if (event.detail > 0 && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }

        // Range selection follows the order the rows are drawn in, which
        // includes the contents of expanded folders.
        const order = listRows.filter((entry) => entry.node).map((entry) => entry.node.path)
        const toSelect = new Set([row.path])

        if (event.shiftKey && lastClickedPath) {
            const a = order.indexOf(lastClickedPath)
            const b = order.indexOf(row.path)
            if (a >= 0 && b >= 0) {
                const [start, stop] = a < b ? [a, b] : [b, a]
                for (let i = start; i <= stop; i += 1) {
                    toSelect.add(order[i])
                }
            }
            applySelection((node) => node.isSelected || toSelect.has(node.path))
        } else if (event.metaKey) {
            // cmd/ctrl click adds to the current selection
            applySelection((node) => node.isSelected || toSelect.has(node.path))
        } else {
            applySelection((node) => toSelect.has(node.path))
        }

        setLastClickedPath(row.path)
    }, [applySelection, lastClickedPath, listRows])

    const handleRowRightClick = useCallback((row, event) => {
        event.preventDefault()
        if (!row.isSelected) {
            applySelection((node) => node.path === row.path)
        }
        setMenu({ visible: true, x: event.pageX, y: event.pageY })
    }, [applySelection])

    // A double click opens the thing: a folder is entered, a file is previewed.
    // It used to hand the file to the browser, which downloads what it cannot
    // display - a click should not leave a file behind.
    const handleRowDoubleClick = useCallback((row) => {
        openPreview(row)
    }, [openPreview])

    const handleSegmentClick = useCallback((segment) => {
        openFolder(segment.path)
    }, [openFolder])

    const toggleDotfiles = useCallback(() => {
        // dropping the selection keeps actions (delete, rename, ...) from
        // targeting rows that are about to be hidden
        if (showDotfiles) {
            applySelection((node) => node.isSelected && !isDotfile(node))
        }
        setShowDotfiles((prev) => !prev)
    }, [applySelection, showDotfiles])

    const toggleSort = useCallback((column) => {
        setSort((prev) => ({
            column,
            order: prev.order === 'descending' ? 'ascending' : 'descending',
        }))
    }, [])

    // ---------------------------------------------------------------------
    // Contextual menu commands
    // ---------------------------------------------------------------------

    const handlePreviewContextualMenu = useCallback(() => {
        openPreview(selectedNodes[0])
    }, [openPreview, selectedNodes])

    const handleCopyContextualMenu = useCallback(() => {
        const node = selectedNodes[0]
        if (!node) {
            return
        }
        setCopyDialog({ visible: true, node, value: basename(node.path) })
    }, [selectedNodes])

    const handleRenameContextualMenu = useCallback(() => {
        const node = selectedNodes[0]
        if (!node) {
            return
        }
        setRenameDialog({ visible: true, node, value: node.path })
    }, [selectedNodes])

    // The whole path of what is selected, one per line for a multiple
    // selection, so it can be pasted into a shell or another file manager.
    const handleCopyPathContextualMenu = useCallback(() => {
        if (selectedNodes.length === 0) {
            return
        }
        copyToClipboard(selectedNodes.map((node) => node.path).join('\n'))
    }, [selectedNodes])

    const handleDownloadContextualMenu = useCallback(() => {
        if (selectedNodes.length !== 1) {
            alert('Sorry, downloading multiple files at once is not enabled')
            return
        }
        window.open(downloadUrl(selectedNodes[0].path))
    }, [selectedNodes])

    // Compress the selection into one archive next to it. The backend names it
    // the way the Finder would (notes.txt.zip, Photos.zip, Archive.zip for a
    // multiple selection) and never overwrites: a second run leaves
    // "notes.txt 2.zip".
    //
    // The work is a job, so the answer arrives as an event rather than as the
    // return value of the request: the panel shows "3 of 2000 files" while the
    // page stays usable, and the listing is reloaded when the archive is there.
    const handleCompressContextualMenu = useCallback(async () => {
        const targets = selectedNodes
        if (targets.length === 0) {
            return
        }
        let job
        try {
            job = await startJob('zip', {
                paths: targets.map((node) => node.path),
                destination: cwd,
            })
        } catch (err) {
            console.error('could not compress', targets.map((node) => node.path), err)
            alert('Could not compress: ' + (err.payload?.error || err.message))
            return
        }
        track(job, {
            onDone: async (finished) => {
                if (finished.state === 'error') {
                    alert('Could not compress: '
                        + (finished.result?.error || finished.error || 'unknown error'))
                    return
                }
                await reloadCurrent()
                const failed = finished.result?.failed || []
                if (failed.length > 0) {
                    alert('Could not compress everything:\n'
                        + failed.map((item) => `${basename(item.path)}: ${item.error}`).join('\n'))
                }
            },
        })
    }, [cwd, reloadCurrent, selectedNodes])

    // Unpack an archive in place. When the archive would overwrite something,
    // the backend says what and the user decides once for the whole archive:
    // the same job, started again with overwrite, since nothing was written.
    const handleExtractContextualMenu = useCallback(async () => {
        const node = selectedNodes[0]
        if (!isZipNode(node)) {
            return
        }

        const watch = (job) => track(job, {
            onDone: async (finished) => {
                if (finished.status === 409) {
                    const count = finished.result?.count ?? 0
                    const sample = (finished.result?.conflicts ?? []).slice(0, 3)
                        .map((conflict) => basename(conflict)).join(', ')
                    if (!window.confirm(`${count} item${count === 1 ? '' : 's'} already exist`
                        + `${count === 1 ? 's' : ''} (${sample}). Replace ${count === 1 ? 'it' : 'them'}?`)) {
                        return
                    }
                    try {
                        watch(await startJob('unzip', { path: node.path, overwrite: true }))
                    } catch (retryError) {
                        alert(`Could not extract “${basename(node.path)}”: `
                            + (retryError.payload?.error || retryError.message))
                    }
                    return
                }
                if (finished.state === 'error') {
                    alert(`Could not extract “${basename(node.path)}”: `
                        + (finished.result?.error || finished.error || 'unknown error'))
                    return
                }
                await reloadCurrent()
                const result = finished.result
                const problems = (result?.failed || [])
                    .map((item) => `${basename(item.path)}: ${item.error}`)
                if (result?.skipped?.length) {
                    problems.push(`${result.skipped.length} item(s) point outside the folder and were skipped`)
                }
                if (problems.length > 0) {
                    alert('The archive was unpacked, but not everything:\n' + problems.join('\n'))
                }
            },
        })

        try {
            watch(await startJob('unzip', { path: node.path }))
        } catch (err) {
            alert(`Could not extract “${basename(node.path)}”: `
                + (err.payload?.error || err.message))
        }
    }, [reloadCurrent, selectedNodes])

    // Nothing is unlinked here: the backend hands the paths to the trash of
    // the host system (Recycle Bin, ~/.Trash, the freedesktop trash), so a
    // misclick can always be taken back from the desktop.
    const handleMoveToTrashContextualMenu = useCallback(async () => {
        const targets = selectedNodes
        if (targets.length === 0) {
            return
        }
        let failed = []
        try {
            const result = await postCommand({
                command: 'trash',
                paths: targets.map((node) => node.path),
            })
            failed = result.failed || []
        } catch (err) {
            console.error('could not move to trash', targets.map((node) => node.path), err)
            failed = targets.map((node) => ({ path: node.path, error: String(err) }))
        }
        // some of a multiple selection may have gone through
        await reloadCurrent()
        if (failed.length > 0) {
            alert(
                'Could not move everything to the trash:\n' +
                failed.map((item) => `${basename(item.path)}: ${item.error}`).join('\n')
            )
        }
    }, [reloadCurrent, selectedNodes])

    // The permanent delete is the one command that cannot be taken back, so
    // the paths are captured here and nothing is sent until the confirmation
    // dialog comes back with a yes.
    const handleDeletePermanentlyContextualMenu = useCallback(() => {
        if (selectedNodes.length === 0) {
            return
        }
        setDeleteDialog({
            visible: true,
            paths: selectedNodes.map((node) => node.path),
        })
    }, [selectedNodes])

    const confirmDeletePermanently = useCallback(async () => {
        const paths = deleteDialog.paths
        setDeleteDialog({ visible: false, paths: [] })
        if (paths.length === 0) {
            return
        }
        let failed = []
        try {
            const result = await postCommand({ command: 'rm', paths })
            failed = result.failed || []
        } catch (err) {
            console.error('could not delete', paths, err)
            failed = paths.map((path) => ({ path, error: String(err) }))
        }
        // some of a multiple selection may have gone through
        await reloadCurrent()
        if (failed.length > 0) {
            alert(
                'Could not delete everything:\n' +
                failed.map((item) => `${basename(item.path)}: ${item.error}`).join('\n')
            )
        }
    }, [deleteDialog.paths, reloadCurrent])

    // ---------------------------------------------------------------------
    // Dialogs
    // ---------------------------------------------------------------------

    const handleNewFolderMenu = useCallback(() => {
        setNewFolderDialog({ visible: true, value: '' })
    }, [])

    const confirmNewFolder = useCallback(async () => {
        const name = newFolderDialog.value.trim()
        setNewFolderDialog({ visible: false, value: '' })
        if (!name) {
            return
        }
        try {
            const node = await postCommand({ command: 'mkdir', path: cwd + '/' + name })
            setNodes((prev) => [...prev, { ...node, isSelected: true }])
        } catch (err) {
            console.error('could not create folder', name, err)
        }
    }, [cwd, newFolderDialog.value])

    const confirmCopy = useCallback(async () => {
        const { node, value } = copyDialog
        setCopyDialog({ visible: false, node: null, value: '' })
        const newName = value.trim()
        if (!node || !newName) {
            return
        }
        const newPath = cwd + '/' + newName
        try {
            await postCommand({ command: 'cp', paths: [node.path], destination: newPath })
            await reloadCurrent()
        } catch (err) {
            console.error('could not copy node', node.path, err)
        }
    }, [copyDialog, cwd, reloadCurrent])

    const confirmRename = useCallback(async () => {
        const { node, value } = renameDialog
        setRenameDialog({ visible: false, node: null, value: '' })
        const newPath = value.trim()
        if (!node || !newPath) {
            return
        }
        const oldPath = node.path
        // the node can be a row of an expanded folder, in which case the path
        // of everything below it changes with it
        const remap = (path) => {
            if (path === oldPath) {
                return newPath
            }
            return path.startsWith(oldPath + '/')
                ? newPath + path.slice(oldPath.length)
                : path
        }
        try {
            await postCommand({ command: 'mv', paths: [oldPath], destination: newPath })
            setNodes((prev) => prev.map((n) => (
                n.path === oldPath ? { ...n, name: basename(newPath), path: newPath } : n
            )))
            setChildListings((prev) => {
                const next = new Map()
                prev.forEach((list, path) => {
                    next.set(remap(path), list.map((n) => (
                        n.path === oldPath
                            ? { ...n, name: basename(newPath), path: newPath }
                            : { ...n, path: remap(n.path) }
                    )))
                })
                return next
            })
            setExpandedPaths((prev) => new Set([...prev].map(remap)))
        } catch (err) {
            console.error('could not rename node', oldPath, err)
        }
    }, [renameDialog])

    // ---------------------------------------------------------------------
    // Uploads (drag and drop, and the file picker)
    // ---------------------------------------------------------------------

    // The folder row or tile under the pointer, or null over empty space. Hit
    // testing goes through the DOM (not a drop handler on the tile) so that a
    // drop anywhere in the window is handled in one place: the hint element is
    // click-through, so the tile is still where the pointer says it is.
    const folderUnderPointer = useCallback((x, y) => {
        for (const element of document.elementsFromPoint(x, y)) {
            const owner = element instanceof Element ? element.closest('[data-path][data-dir]') : null
            if (owner) {
                return owner.dataset.path
            }
        }
        return null
    }, [])

    // A folder whose listing is already cached has to be fetched again after
    // files were written into it; dropping the entry is enough, the expand
    // effect picks it up.
    const invalidateChildren = useCallback((path) => {
        setChildListings((prev) => {
            if (!prev.has(path)) {
                return prev
            }
            const next = new Map(prev)
            next.delete(path)
            return next
        })
    }, [])

    const uploadOne = useCallback((file, destination, existingNames) => {
        if (existingNames.has(file.name)
            && !window.confirm('File exists, do you want to overwrite: ' + file.name + '?')) {
            return
        }

        const into = destination === cwd ? null : basename(destination)
        const label = 'Uploading ' + (into ? `${into}/${file.name}` : file.name)
        const job = newJobId()
        // watched before the first byte is sent, so the panel shows the
        // transfer and not only its aftermath
        track(job, { label })

        uploadFile(file, destination, {
            job,
            onDone: ({ node }) => {
                if (destination === cwd) {
                    setNodes((prev) => {
                        const index = prev.findIndex((n) => n.name === file.name)
                        if (index === -1) {
                            return [...prev, { ...node, isSelected: false }]
                        }
                        const next = [...prev]
                        next[index] = { ...node, isSelected: prev[index].isSelected }
                        return next
                    })
                } else {
                    // the file is not in the directory on screen
                    invalidateChildren(destination)
                }
            },
            onError: (err) => {
                console.error('could not upload file', file.name, err)
            },
        })
    }, [cwd, invalidateChildren])

    // Upload a batch into one folder. Names already in that folder are the
    // things an overwrite confirmation is about, so the destination is listed
    // once first (the current directory does not need asking).
    const uploadFiles = useCallback(async (files, destination) => {
        if (files.length === 0) {
            return
        }
        let existing = new Set(nodes.map((node) => node.name))
        if (destination !== cwd) {
            try {
                const data = await postCommand({ command: 'ls', path: destination })
                existing = new Set(data.nodes.map((node) => node.name))
            } catch (err) {
                // without the listing there is no way to tell whether a file
                // would be overwritten, so nothing is written
                console.error('could not list', destination, err)
                return
            }
        }
        files.forEach((file) => uploadOne(file, destination, existing))
    }, [cwd, nodes, uploadOne])

    const showNotice = useCallback((text) => {
        setNotice(text)
        clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(null), 6000)
    }, [])

    useEffect(() => () => clearTimeout(noticeTimer.current), [])

    // Only a drag carrying files is ours; dragging text or a link around the
    // page must keep the browser's own behaviour.
    const dragHasFiles = (event) => {
        const transfer = event.dataTransfer
        if (!transfer) {
            return false
        }
        // 'Files' is what browsers report for a drag carrying files; the file
        // count covers the platforms that leave it out
        return Array.from(transfer.types ?? []).includes('Files')
            || (transfer.files?.length ?? 0) > 0
    }

    const handleDragOver = useCallback((event) => {
        if (!dragHasFiles(event)) {
            return
        }
        // without preventDefault the browser opens the file instead of dropping it
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        const target = folderUnderPointer(event.clientX, event.clientY)
        setUploadDrag((prev) => (prev.visible && prev.target === target
            ? prev
            : { visible: true, target }))
    }, [folderUnderPointer])

    const handleDragLeave = useCallback((event) => {
        // fires for every element the drag crosses; only a move out of the
        // window (nothing related) ends the drag
        if (event.relatedTarget === null) {
            setUploadDrag({ visible: false, target: null })
        }
    }, [])

    // A drop can carry folders. The upload endpoint takes one file at a time, so
    // that is not supported: folders are picked out here (the entries are only
    // readable during the drop event) and reported instead of being sent, which
    // would otherwise create an empty file named after each folder.
    const splitDrop = (event) => {
        const transfer = event.dataTransfer
        const items = Array.from(transfer?.items ?? [])
        const files = []
        const folders = []
        const entries = items.filter((item) => item.kind === 'file'
            && typeof item.webkitGetAsEntry === 'function')
        if (entries.length === 0) {
            return { files: Array.from(transfer?.files ?? []), folders }
        }
        entries.forEach((item) => {
            const file = item.getAsFile()
            if (!file) {
                return
            }
            const entry = item.webkitGetAsEntry()
            if (entry && entry.isDirectory) {
                folders.push(file.name)
            } else {
                files.push(file)
            }
        })
        return { files, folders }
    }

    const handleDragDrop = useCallback((event) => {
        if (!dragHasFiles(event)) {
            return
        }
        event.preventDefault()
        const destination = folderUnderPointer(event.clientX, event.clientY) || cwd
        const { files, folders } = splitDrop(event)
        setUploadDrag({ visible: false, target: null })
        if (folders.length > 0) {
            const listed = folders.slice(0, 3).join(', ') + (folders.length > 3 ? ', …' : '')
            showNotice(folders.length === 1
                ? `Folders cannot be uploaded, “${listed}” was skipped`
                : `${folders.length} folders cannot be uploaded and were skipped: ${listed}`)
        }
        uploadFiles(files, destination)
    }, [cwd, folderUnderPointer, uploadFiles, showNotice])

    const handleFilePickerChange = useCallback((event) => {
        const files = Array.from(event.target.files ?? [])
        // cleared so that picking the same file again still fires a change
        event.target.value = ''
        uploadFiles(files, cwd)
    }, [cwd, uploadFiles])

    const handleNewMenuSelect = useCallback((key) => {
        if (key === 'folder') {
            handleNewFolderMenu()
        } else if (key === 'upload') {
            filePickerRef.current?.click()
        }
    }, [handleNewFolderMenu])

    const newMenuItems = useMemo(() => [
        { key: 'folder', icon: 'create_new_folder', label: 'New folder' },
        { key: 'upload', icon: 'file_upload', label: 'Upload' },
    ], [])

    return (
        <div
            className="app"
            onClick={handleAppClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDragDrop}
        >
            <input
                ref={filePickerRef}
                type="file"
                multiple
                hidden
                onChange={handleFilePickerChange}
            />

            <UploadHint visible={uploadDrag.visible} target={uploadDrag.target} />
            {notice && (
                <div className="app-notice" role="status">
                    <i className="material-icons">folder_off</i>
                    <span>{notice}</span>
                </div>
            )}

            <JobProgressPanel />

            <ContextMenu
                visible={menu.visible}
                x={menu.x}
                y={menu.y}
                visibility={menuVisibility}
                onPreview={handlePreviewContextualMenu}
                onCopy={handleCopyContextualMenu}
                onRename={handleRenameContextualMenu}
                onCopyPath={handleCopyPathContextualMenu}
                onDownload={handleDownloadContextualMenu}
                onCompress={handleCompressContextualMenu}
                onExtract={handleExtractContextualMenu}
                onTrash={handleMoveToTrashContextualMenu}
                onDeletePermanently={handleDeletePermanentlyContextualMenu}
            />

            <PromptDialog
                open={renameDialog.visible}
                title="Rename"
                confirmText="Rename"
                value={renameDialog.value}
                onChange={(value) => setRenameDialog((prev) => ({ ...prev, value }))}
                onConfirm={confirmRename}
                onCancel={() => setRenameDialog({ visible: false, node: null, value: '' })}
            />

            <PromptDialog
                open={copyDialog.visible}
                title="Create Copy"
                confirmText="Confirm"
                value={copyDialog.value}
                onChange={(value) => setCopyDialog((prev) => ({ ...prev, value }))}
                onConfirm={confirmCopy}
                onCancel={() => setCopyDialog({ visible: false, node: null, value: '' })}
            />

            <PromptDialog
                open={newFolderDialog.visible}
                title="Create new folder"
                placeholder="Name your new folder"
                confirmText="Create folder"
                value={newFolderDialog.value}
                onChange={(value) => setNewFolderDialog((prev) => ({ ...prev, value }))}
                onConfirm={confirmNewFolder}
                onCancel={() => setNewFolderDialog({ visible: false, value: '' })}
            />

            <ConfirmDialog
                open={deleteDialog.visible}
                title="Delete permanently?"
                message={deleteDialog.paths.length === 1
                    ? `“${basename(deleteDialog.paths[0] || '')}” will be deleted immediately. It will not go to the trash, and this cannot be undone.`
                    : `${deleteDialog.paths.length} items will be deleted immediately. They will not go to the trash, and this cannot be undone.`}
                confirmText="Delete"
                danger
                onConfirm={confirmDeletePermanently}
                onCancel={() => setDeleteDialog({ visible: false, paths: [] })}
            />

            <PreviewDialog
                open={preview.open}
                node={preview.node}
                onClose={closePreview}
                onDownload={handlePreviewDownload}
                onPrev={handlePreviewPrev}
                onNext={handlePreviewNext}
                hasPrev={previewIndex > 0}
                hasNext={previewIndex >= 0 && previewIndex < previewableNodes.length - 1}
            />

            {/* Header Bar */}
            <div className="header-bar">
                <div className="header-bar-brand">
                    <BrandLogo />
                    <span className="logo-mark">pdrive</span>
                </div>

                {/* the host name is centred in the bar itself, not in whatever
                    space the logo and the buttons leave over */}
                {hostLabel && (
                    <span className="header-bar-host" title={hostLabel}>{hostLabel}</span>
                )}

                <div className="header-bar-actions">
                    {/* View Mode Selection Toolbar */}
                    <div className="header-bar-button-group">
                        <button
                            type="button"
                            title="Display As Table"
                            aria-pressed={viewMode === 'list'}
                            className={'header-bar-button' + (viewMode === 'list' ? ' active' : '')}
                            onClick={() => setViewMode('list')}
                        >
                            <i className="material-icons">view_list</i>
                        </button>
                        <button
                            type="button"
                            title="Display As Grid"
                            aria-pressed={viewMode === 'grid'}
                            className={'header-bar-button' + (viewMode === 'grid' ? ' active' : '')}
                            onClick={() => setViewMode('grid')}
                        >
                            <i className="material-icons">grid_view</i>
                        </button>
                    </div>

                    {/* Hidden Files Toggle */}
                    <div className="header-bar-button-group">
                        <button
                            type="button"
                            title={showDotfiles ? 'Hide dotfiles' : 'Show dotfiles'}
                            aria-label={showDotfiles ? 'Hide dotfiles' : 'Show dotfiles'}
                            aria-pressed={showDotfiles}
                            className={'header-bar-button' + (showDotfiles ? ' active' : '')}
                            onClick={toggleDotfiles}
                        >
                            <i className="material-icons">
                                {showDotfiles ? 'visibility' : 'visibility_off'}
                            </i>
                        </button>
                    </div>
                </div>
            </div>

            <div className="main-view">
                <div className="content-view">
                    {/* Sub Header Bar */}
                    <div className="toolbar-view">
                        <div className="breadcrumb-view" ref={breadcrumbRef}>
                            {pathSegments.map((segment, index) => (
                                <span key={segment.path}>
                                    <span className="segment" onClick={() => handleSegmentClick(segment)}>
                                        {segment.name}
                                    </span>
                                    {index < pathSegments.length - 1 && (
                                        <i className="material-icons">chevron_right</i>
                                    )}
                                </span>
                            ))}
                        </div>
                        <div className="new-button-view">
                            <Dropdown
                                items={newMenuItems}
                                onSelect={handleNewMenuSelect}
                                ariaLabel="New"
                                buttonClassName="btn btn-primary new-button"
                                buttonContent={(
                                    <>
                                        New
                                        <i className="material-icons md-18">arrow_drop_down</i>
                                    </>
                                )}
                            />
                        </div>
                    </div>

                    <div
                        className="selection-surface"
                        ref={selectionRef}
                        onMouseDown={handleSurfaceMouseDown}
                        onClickCapture={handleSurfaceClickCapture}
                    >
                        {viewMode === 'grid' ? (
                            <FileGrid
                                nodes={sortedNodes}
                                dropTargetPath={dropTargetPath || uploadDrag.target}
                                onRowClick={handleRowClick}
                                onRowRightClick={handleRowRightClick}
                                onRowDoubleClick={handleRowDoubleClick}
                            />
                        ) : (
                            <FileList
                                rows={listRows}
                                sort={sort}
                                dropTargetPath={dropTargetPath || uploadDrag.target}
                                expandedPaths={expandedPaths}
                                onToggleExpand={toggleExpanded}
                                onRowClick={handleRowClick}
                                onRowRightClick={handleRowRightClick}
                                onRowDoubleClick={handleRowDoubleClick}
                                onToggleSort={toggleSort}
                            />
                        )}
                        {marquee && <div className="selection-rect" style={marquee} />}
                    </div>
                </div>
            </div>

            {moveGhost && (
                <div className="drag-ghost" style={{ left: moveGhost.x + 12, top: moveGhost.y + 12 }}>
                    {moveGhost.label}
                </div>
            )}
        </div>
    )
}
