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
import PromptDialog from './components/PromptDialog.jsx'
import UploadOverlay from './components/UploadOverlay.jsx'
import { fetchListing, postCommand, uploadFile } from './api.js'
import { basename, sortNodes } from './utils.js'

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
    const [lastClickedRow, setLastClickedRow] = useState(null)
    const [viewMode, setViewMode] = useState('list')       // possible values: list, grid
    const [sort, setSort] = useState({ column: 'mtime', order: 'descending' })

    const [menu, setMenu] = useState({ visible: false, x: 100, y: 100 })
    const [renameDialog, setRenameDialog] = useState({ visible: false, node: null, value: '' })
    const [copyDialog, setCopyDialog] = useState({ visible: false, node: null, value: '' })
    const [newFolderDialog, setNewFolderDialog] = useState({ visible: false, value: '' })

    const [overlayVisible, setOverlayVisible] = useState(false)
    const [jobProgress, setJobProgress] = useState({ visible: false, tasks: [] })

    const sortedNodes = useMemo(() => sortNodes(nodes, sort), [nodes, sort])
    const selectedNodes = useMemo(() => nodes.filter((node) => node.isSelected), [nodes])

    const pathSegments = useMemo(() => {
        if (!cwd) {
            return []
        }
        const relativeCwd = cwd.replace(basedir, '')
        const components = relativeCwd.split('/').filter((segment) => segment !== '')
        const segments = [{ name: basedir, component: '', path: basedir }]
        let fullPath = basedir
        components.forEach((component) => {
            fullPath += '/' + component
            segments.push({ name: component, component, path: fullPath })
        })
        return segments
    }, [cwd, basedir])

    const menuVisibility = useMemo(() => {
        // Duplicate / rename / download only make sense for a single selection
        const single = selectedNodes.length <= 1
        return {
            preview: single,
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
    }, [])

    // Label the tab with the machine pdrive is serving files from. This is
    // more useful than window.location.hostname, which is usually just
    // localhost when the server is reached through an ssh tunnel.
    useEffect(() => {
        if (hostname === null) {
            return
        }
        const label = hostname || window.location.hostname
        document.title = label ? `${label} - pdrive` : 'pdrive'
    }, [hostname])

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

    const clearSelection = useCallback(() => {
        setNodes((prev) => prev.map((node) => (
            node.isSelected ? { ...node, isSelected: false } : node
        )))
    }, [])

    const handleAppClick = useCallback(() => {
        setMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev))
        clearSelection()
    }, [clearSelection])

    const handleRowClick = useCallback((row, event) => {
        event.stopPropagation()
        setMenu((prev) => ({ ...prev, visible: false }))

        setNodes((prev) => {
            const names = sortNodes(prev, sort).map((node) => node.name)
            const toSelect = new Set([row.name])

            if (event.shiftKey && lastClickedRow) {
                const a = names.indexOf(lastClickedRow)
                const b = names.indexOf(row.name)
                if (a >= 0 && b >= 0) {
                    const [start, stop] = a < b ? [a, b] : [b, a]
                    for (let i = start; i <= stop; i += 1) {
                        toSelect.add(names[i])
                    }
                }
                return prev.map((node) => (
                    toSelect.has(node.name) && !node.isSelected ? { ...node, isSelected: true } : node
                ))
            }

            if (event.metaKey) {
                // cmd/ctrl click adds to the current selection
                return prev.map((node) => (
                    toSelect.has(node.name) && !node.isSelected ? { ...node, isSelected: true } : node
                ))
            }

            return prev.map((node) => {
                const isSelected = toSelect.has(node.name)
                return node.isSelected === isSelected ? node : { ...node, isSelected }
            })
        })

        setLastClickedRow(row.name)
    }, [lastClickedRow, sort])

    const handleRowRightClick = useCallback((row, event) => {
        event.preventDefault()
        setNodes((prev) => {
            const cleared = row.isSelected
                ? prev
                : prev.map((node) => (node.isSelected ? { ...node, isSelected: false } : node))
            return cleared.map((node) => (
                node.name === row.name && !node.isSelected ? { ...node, isSelected: true } : node
            ))
        })
        setMenu({ visible: true, x: event.pageX, y: event.pageY })
    }, [])

    const handleRowDoubleClick = useCallback((row) => {
        if (row.type === 'file') {
            window.open('/serve?file=' + row.path)
        } else {
            openFolder(row.path)
        }
    }, [openFolder])

    const handleSegmentClick = useCallback((segment) => {
        openFolder(segment.path)
    }, [openFolder])

    const toggleSort = useCallback((column) => {
        setSort((prev) => ({
            column,
            order: prev.order === 'descending' ? 'ascending' : 'descending',
        }))
    }, [])

    // ---------------------------------------------------------------------
    // Contextual menu commands
    // ---------------------------------------------------------------------

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
        window.open('/download?file=' + selectedNodes[0].path)
    }, [selectedNodes])

    const handleDeleteContextualMenu = useCallback(async () => {
        const targets = selectedNodes
        if (targets.length === 0) {
            return
        }
        const names = new Set(targets.map((node) => node.name))
        try {
            await postCommand({ command: 'rm', paths: targets.map((node) => node.path) })
            setNodes((prev) => prev.filter((node) => !names.has(node.name)))
        } catch (err) {
            console.error('could not delete', [...names], err)
        }
    }, [selectedNodes])

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
        setNodes((prev) => [...prev, { ...node, name: basename(newPath), path: newPath }])
        try {
            await postCommand({ command: 'cp', paths: [node.path], destination: newPath })
        } catch (err) {
            console.error('could not copy node', node.path, err)
        }
    }, [copyDialog, cwd])

    const confirmRename = useCallback(async () => {
        const { node, value } = renameDialog
        setRenameDialog({ visible: false, node: null, value: '' })
        const newPath = value.trim()
        if (!node || !newPath) {
            return
        }
        try {
            await postCommand({ command: 'mv', paths: [node.path], destination: newPath })
            setNodes((prev) => prev.map((n) => (
                n.path === node.path ? { ...n, name: basename(newPath), path: newPath } : n
            )))
        } catch (err) {
            console.error('could not rename node', node.path, err)
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

            {/* Header Bar */}
            <div className="header-bar">
                <span className="logo-mark">pDrive</span>

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
            </div>

            <div className="main-view">
                <div className="content-view">
                    {/* Sub Header Bar */}
                    <div className="toolbar-view">
                        <div className="breadcrumb-view">
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

                    {viewMode === 'grid' ? (
                        <FileGrid
                            nodes={sortedNodes}
                            onRowClick={handleRowClick}
                            onRowRightClick={handleRowRightClick}
                            onRowDoubleClick={handleRowDoubleClick}
                        />
                    ) : (
                        <FileList
                            nodes={sortedNodes}
                            sort={sort}
                            onRowClick={handleRowClick}
                            onRowRightClick={handleRowRightClick}
                            onRowDoubleClick={handleRowDoubleClick}
                            onToggleSort={toggleSort}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
