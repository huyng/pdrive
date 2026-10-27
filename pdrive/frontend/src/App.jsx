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

import ContextMenu from './components/ContextMenu.jsx'
import Dropdown from './components/Dropdown.jsx'
import FileGrid from './components/FileGrid.jsx'
import FileList from './components/FileList.jsx'
import JobProgressPanel from './components/JobProgressPanel.jsx'
import PreviewDialog from './components/PreviewDialog.jsx'
import PromptDialog from './components/PromptDialog.jsx'
import UploadOverlay from './components/UploadOverlay.jsx'
import { downloadUrl, fetchListing, postCommand, serveUrl, uploadFile } from './api.js'
import useDragMove from './useDragMove.js'
import useDragSelect from './useDragSelect.js'
import { basename, isDotfile, previewKind, sortNodes, withoutDotfiles } from './utils.js'

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

export default function App() {
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
    const [preview, setPreview] = useState({ open: false, node: null })

    const [overlayVisible, setOverlayVisible] = useState(false)
    const [jobProgress, setJobProgress] = useState({ visible: false, tasks: [] })

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
        return {
            preview: selectedNodes.length === 1,
            copy: single,
            rename: single,
            download: single,
            delete: true,
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

    const handleRowDoubleClick = useCallback((row) => {
        if (row.type === 'file') {
            // Hand the file to the browser: it displays what it can and
            // downloads everything else (pressing space previews instead)
            window.open(serveUrl(row.path))
        } else {
            openFolder(row.path)
        }
    }, [openFolder])

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

    const handleDownloadContextualMenu = useCallback(() => {
        if (selectedNodes.length !== 1) {
            alert('Sorry, downloading multiple files at once is not enabled')
            return
        }
        window.open(downloadUrl(selectedNodes[0].path))
    }, [selectedNodes])

    const handleDeleteContextualMenu = useCallback(async () => {
        const targets = selectedNodes
        if (targets.length === 0) {
            return
        }
        try {
            await postCommand({ command: 'rm', paths: targets.map((node) => node.path) })
            await reloadCurrent()
        } catch (err) {
            console.error('could not delete', targets.map((node) => node.path), err)
        }
    }, [reloadCurrent, selectedNodes])

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
    // Uploads (drag and drop)
    // ---------------------------------------------------------------------

    const removeTask = useCallback((taskId) => {
        setJobProgress((prev) => {
            const tasks = prev.tasks.filter((task) => task.id !== taskId)
            return { visible: tasks.length > 0, tasks }
        })
    }, [])

    const uploadOne = useCallback((file) => {
        const exists = nodes.some((node) => node.name === file.name)
        if (exists && !window.confirm('File exists, do you want to overwrite: ' + file.name + '?')) {
            return
        }

        const taskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
        setJobProgress((prev) => ({
            visible: true,
            tasks: [...prev.tasks, { id: taskId, message: file.name, progress: 0 }],
        }))

        uploadFile(file, cwd, {
            onProgress: (percent) => {
                setJobProgress((prev) => ({
                    ...prev,
                    tasks: prev.tasks.map((task) => (
                        task.id === taskId ? { ...task, progress: percent } : task
                    )),
                }))
            },
            onDone: (node) => {
                setNodes((prev) => {
                    const index = prev.findIndex((n) => n.name === file.name)
                    if (index === -1) {
                        return [...prev, { ...node, isSelected: false }]
                    }
                    const next = [...prev]
                    next[index] = { ...node, isSelected: prev[index].isSelected }
                    return next
                })
                setTimeout(() => removeTask(taskId), 2000)
            },
            onError: (err) => {
                console.error('could not upload file', file.name, err)
                setTimeout(() => removeTask(taskId), 2000)
            },
        })
    }, [cwd, nodes, removeTask])

    const handleDragEnter = useCallback((event) => {
        event.preventDefault()
        setOverlayVisible(true)
    }, [])

    const handleDragLeave = useCallback((event) => {
        if (event.target === event.currentTarget) {
            setOverlayVisible(false)
        }
    }, [])

    const handleDragDrop = useCallback((event) => {
        event.preventDefault()
        event.stopPropagation()
        const files = Array.from(event.dataTransfer?.files ?? [])
        files.forEach((file) => uploadOne(file))
        setOverlayVisible(false)
    }, [uploadOne])

    const closeOverlay = useCallback(() => setOverlayVisible(false), [])

    const handleNewMenuSelect = useCallback((key) => {
        if (key === 'folder') {
            handleNewFolderMenu()
        } else if (key === 'upload') {
            setOverlayVisible(true)
        }
    }, [handleNewFolderMenu])

    const newMenuItems = useMemo(() => [
        { key: 'folder', icon: 'create_new_folder', label: 'New folder' },
        { key: 'upload', icon: 'file_upload', label: 'Upload' },
    ], [])

    const handleJobProgressClose = useCallback(() => {
        setJobProgress((prev) => ({ ...prev, visible: false }))
    }, [])

    return (
        <div
            className="app"
            onClick={handleAppClick}
            onDragEnter={handleDragEnter}
            onDrop={handleDragDrop}
        >
            <UploadOverlay
                visible={overlayVisible}
                onClose={closeOverlay}
                onDrop={handleDragDrop}
                onDragLeave={handleDragLeave}
            />

            <JobProgressPanel
                visible={jobProgress.visible}
                tasks={jobProgress.tasks}
                onClose={handleJobProgressClose}
            />

            <ContextMenu
                visible={menu.visible}
                x={menu.x}
                y={menu.y}
                visibility={menuVisibility}
                onPreview={handlePreviewContextualMenu}
                onCopy={handleCopyContextualMenu}
                onRename={handleRenameContextualMenu}
                onDownload={handleDownloadContextualMenu}
                onDelete={handleDeleteContextualMenu}
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
                    <img className="logo-icon" src="/favicon.svg" alt="" width="32" height="32" />
                    <span className="logo-mark">pdrive</span>
                    {hostLabel && (
                        <span className="header-bar-host" title={hostLabel}>{hostLabel}</span>
                    )}
                </div>

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
                                dropTargetPath={dropTargetPath}
                                onRowClick={handleRowClick}
                                onRowRightClick={handleRowRightClick}
                                onRowDoubleClick={handleRowDoubleClick}
                            />
                        ) : (
                            <FileList
                                rows={listRows}
                                sort={sort}
                                dropTargetPath={dropTargetPath}
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
