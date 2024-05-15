<!--

pdrive - a web based document browser
Copyright (C) 2017 Huy Nguyen

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.

-->

<template>
    <div id="app" v-on:click="handleAppClick" v-on:dragenter="handleDragEnter" v-on:drop="handleDragDrop">

        <!-- Upload hover -->
        <!-- to make this target a valid drop target, we must listen to the dragover event  -->
        <div v-on:dragover.prevent v-on:drop="handleDragDrop" v-on:dragleave.self="handleDragLeave"
            v-show="uploadOverLay.visible" class="upload-overlay">
            <div style="cursor: pointer;">
                <i v-on:click="uploadOverLay.visible = false" class="material-icons md-48 md-light">close</i>
            </div>
            <div
                style="position:relative; margin:100px auto; width: 400px;padding: 20px; color: white; text-align:center; font-size:24px;">
                Drag your files here to upload
                <br>
                <i class="material-icons md-48">cloud_upload</i>
            </div>
        </div>

        <!--  Upload progress display -->
        <div v-show="jobProgress.visible" class="job-progress">
            <div class="job-progress-header">
                <div style="float:left">Uploading</div>
                <div style="float:right; cursor:pointer;"><i class="material-icons md-18">close</i></div>
                <div style="clear:both"></div>
            </div>
            <div class="job-progress-task" v-for="task in jobProgress.tasks">
                {{truncate(task.message, 30)}}
                <el-progress :percentage="task.progress"></el-progress>
            </div>
        </div>

        <!-- Right click contextual menu -->
        <div class="contextual-menu" v-bind:style="{ top: contextualMenu.y + 'px', left: contextualMenu.x + 'px' }"
            v-show="contextualMenu.visible">
            <!-- <div v-show="contextualMenuItemVisibility.preview"><i class="material-icons md-18">remove_red_eye</i>
                Preview</div> -->
            <div v-show="contextualMenuItemVisibility.copy" v-on:click="handleCopyContextualMenu"><i
                    class="material-icons md-18">content_copy</i> Duplicate</div>
            <div v-show="contextualMenuItemVisibility.rename" v-on:click="handleRenameContextualMenu"><i
                    class="material-icons md-18">edit</i> Rename</div>
            <div v-show="contextualMenuItemVisibility.download" v-on:click="handleDownloadContextualMenu"><i
                    class="material-icons md-18">file_download</i> Download</div>
            <div style="border-top: 2px solid #E5E9F2" v-show="contextualMenuItemVisibility.delete"
                v-on:click="handleDeleteContextualMenu"><i class="material-icons md-18">delete</i> Delete</div>
        </div>

        <!-- Rename Dialog -->
        <el-dialog v-model="renameDialog.visible">
            <template #header>
                Rename
            </template>
            <el-input v-model="renameDialog.newPath" v-on:keyup.enter.native="handleRenameDialogConfirm"
                name="renameDialogNewPath"></el-input>
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="renameDialog.visible = false">Cancel</el-button>
                    <el-button type="primary" v-on:click="handleRenameDialogConfirm">Rename</el-button>
                </span>
            </template>
        </el-dialog>

        <!-- Copy Dialog -->
        <el-dialog title="Create copy" v-model="copyDialog.visible">
            <template #header>
                Create Copy
            </template>

            <el-input v-model="copyDialog.newName" v-on:keyup.enter.native="handleCopyDialogConfirm"
                name="copyDialogNewPath"></el-input>
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="copyDialog.visible = false">Cancel</el-button>
                    <el-button type="primary" v-on:click="handleCopyDialogConfirm">Confirm</el-button>
                </span>
            </template>
        </el-dialog>

        <!-- New Folder Dialog -->
        <el-dialog v-model="newFolderDialog.visible">
            <template #header>
                Create new folder
            </template>
            <el-input placeholder="Name your new folder" v-model="newFolderDialog.newName"
                v-on:keyup.enter.native="hanldeNewFolderDialogConfirm" name="newFolderDialogName"></el-input>
            <template #footer>
                <span class="dialog-footer">
                    <el-button @click="newFolderDialog.visible = false">Cancel</el-button>
                    <el-button type="primary" @click="hanldeNewFolderDialogConfirm">Create folder</el-button>
                </span>
            </template>
        </el-dialog>

        <!-- Header Bar -->
        <el-row type="flex" justify="space-between" class="header-bar">
            <el-col :span="2">
                <span class="logo-mark">pDrive</span>
            </el-col>
            <!-- <el-col :span="16" style="padding-top: .5rem">
                <span style="color:rgb(36, 51, 112)">{{basedir}}</span>
            </el-col> -->

            <!-- View Mode Selection Toolbar -->
            <el-col class="header-bar-button-group" :span="6">
                <el-button-group style="float:right; ">
                    <el-tooltip content="Display As Table" placement="bottom">
                        <el-button class="header-bar-button" v-bind:class="{ active: viewMode === 'list' }"
                            v-on:click="viewMode = 'list'" :plain=true>
                            <el-icon>
                                <Fold />
                            </el-icon>
                        </el-button>
                    </el-tooltip>

                    <el-tooltip content="Display As Grid" placement="bottom">
                        <el-button class="header-bar-button" v-bind:class="{ active: viewMode === 'grid' }"
                            v-on:click="viewMode = 'grid'" :plain=true>
                            <el-icon>
                                <Menu />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                </el-button-group>
            </el-col>

        </el-row>

        <el-row class="main-view" :gutter="20">

            <!-- Sub Header Bar -->
            <el-col class="content-view" :span="24">
                <el-row class="toolbar-view">
                    <el-col :span="24">
                        <div style="float:left" class="breadcrumb-view">
                            <span v-for="(segment, index) in pathSegments">
                                <span v-on:click="handleSegmentClick(segment, $event)"
                                    class="segment">{{segment.name}}</span>
                                <i v-if="index < pathSegments.length-1" class="material-icons">chevron_right</i>
                            </span>
                        </div>
                        <div style="float:right;margin-right:20px;">
                            <el-dropdown menu-align="start" size="large">
                                <el-button style=" margin-top: 8px; margin-left:16px;" type="primary">New <i
                                        style="vertical-align: middle" class="material-icons md-18">arrow_drop_down</i>
                                </el-button>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item v-on:click.native="handleNewFolderMenu"><i
                                                style="vertical-align:text-bottom; margin-right:6px;"
                                                class="material-icons md-24">create_new_folder</i> New
                                            folder</el-dropdown-item>
                                        <el-dropdown-item v-on:click.native="uploadOverLay.visible = true"><i
                                                style="vertical-align:text-bottom; margin-right:6px;"
                                                class="material-icons md-24">file_upload</i> Upload</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </div>
                    </el-col>
                </el-row>

                <!-- Grid View -->
                <div class="grid-view noselect" v-if="viewMode === 'grid'">
                    <div class="grid-item" v-for="row in sortedNodes"
                        v-on:contextmenu="handleRowRightClick(row, $event)" v-on:click="handleRowClick(row, $event)"
                        v-on:dblclick="handleRowDoubleClick(row, $event)" v-bind:class="{selected: row.isSelected}"
                        style="float: left; width: 100px; margin: 30px;">

                        <div style="text-align: center; padding-bottom: 10px; height: 100px; vertical-align: middle;">
                            <i v-if="row.type == 'dir'" class="material-icons"
                                style="line-height: 100px; font-size: 64px">folder</i>
                            <img v-else-if="row.type == 'file' && (row.mimetype == 'image/jpeg' || row.mimetype == 'image/png')"
                                width=100 height=100 style="border: 1px solid #eee"
                                v-bind:src="'/download?file='+row.path" />
                            <i v-else-if="row.type == 'file'" class="material-icons md-24 md-dark"
                                style="line-height: 100px; font-size: 64px">insert_drive_file</i>
                        </div>
                        <div class="filename" style="text-align: center; font-size: .8em;">
                            <span style="margin-left: 10px">{{truncate(row.name, 40)}}</span>
                        </div>
                    </div>
                </div>



                <!-- List View -->
                <table v-if="viewMode === 'list'" cellspace="0" cellpadding="0" border="0">
                    <thead>
                        <tr>
                            <th v-on:click="toggleSort('name', $event)">
                                Name
                                <span v-if="currentSort.column == 'name'">
                                    <i v-if="currentSort.order == 'descending'"
                                        class="material-icons md-18">arrow_drop_down</i>
                                    <i v-else class="material-icons md-18">arrow_drop_up</i>
                                </span>
                            </th>
                            <th v-on:click="toggleSort('size', $event)">
                                Size
                                <span v-if="currentSort.column == 'size'">
                                    <i v-if="currentSort.order == 'descending'"
                                        class="material-icons md-18">arrow_drop_down</i>
                                    <i v-else class="material-icons md-18">arrow_drop_up</i>
                                </span>
                            </th>
                            <th v-on:click="toggleSort('mtime', $event)">
                                Last modified
                                <span v-if="currentSort.column == 'mtime'">
                                    <i v-if="currentSort.order == 'descending'"
                                        class="material-icons md-18">arrow_drop_down</i>
                                    <i v-else class="material-icons md-18">arrow_drop_up</i>
                                </span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in sortedNodes" v-on:contextmenu="handleRowRightClick(row, $event)"
                            v-on:click="handleRowClick(row, $event)" v-on:dblclick="handleRowDoubleClick(row, $event)"
                            v-bind:class="{selected: row.isSelected}">

                            <td>
                                <i v-if="row.type == 'dir'" class="material-icons md-18">folder</i>
                                <i v-else class="material-icons md-18 md-dark">insert_drive_file</i>
                                <span style="margin-left: 10px">{{truncate(row.name, 40)}}</span>
                            </td>
                            <td>{{formatSize(row)}}</td>
                            <td>{{row.mtime}}</td>
                        </tr>
                    </tbody>
                </table>

            </el-col>
        </el-row>


    </div>
</template>

<style media="screen">
    * {
        margin: 0px;
        padding: 0px;
    }

    body {
        background: white;
        font-family: "Avenir", "Arial", sans-serif;
    }

    .noselect {
        -webkit-touch-callout: none;
        /* iOS Safari */
        -webkit-user-select: none;
        /* Safari */
        -khtml-user-select: none;
        /* Konqueror HTML */
        -moz-user-select: none;
        /* Old versions of Firefox */
        -ms-user-select: none;
        /* Internet Explorer/Edge */
        user-select: none;
        /* Non-prefixed version, currently
                                    supported by Chrome, Edge, Opera and Firefox */
    }

    .logo-mark {
        font-size: 24px;
        color: white;
    }

    .header-bar {
        background: #20A0FF;
        padding: 16px 20px;
        box-sizing: border-box;
    }

    .upload-overlay {
        position: fixed;
        bottom: 0;
        right: 0px;
        background-color: rgba(0, 0, 0, .9);
        z-index: 999;
        padding: 20px;
        left: 0px;
        top: 0px;
    }

    .job-progress {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 300px;
        background-color: white;
        box-shadow: 0px 2px 6px #999;
        z-index: 999;
    }

    .job-progress-header {
        background: #8492A6;
        padding: 10px 20px;
        color: white;
    }

    .job-progress-task {
        padding: 20px;
        font-size: 12px;
    }

    .sidebar-view {
        padding: 16px 30px !important;
    }

    .sidebar-items {
        list-style: none;
    }

    .sidebar-items li {
        margin-bottom: 1em;
    }

    .toolbar-view {
        background: #324057;
        color: white;
    }

    .breadcrumb-view {
        padding: 16px 20px;
        border-right: 1px solid #1F2D3D;
    }

    .breadcrumb-view .segment {
        cursor: pointer;
        -webkit-user-select: none;
        /* Chrome all / Safari all */
        -moz-user-select: none;
        /* Firefox all */
        -ms-user-select: none;
        /* IE 10+ */
    }

    .contextual-menu {
        position: absolute;
        top: 0px;
        left: 0px;
        width: 200px;
        background: white;
        z-index: 999;
        font-size: 1em;
        box-shadow: 0px 0px 5px rgba(0, 0, 0, 0.5);
    }

    .contextual-menu div {
        padding: 10px;
        -webkit-user-select: none;
        /* Chrome all / Safari all */
        -moz-user-select: none;
        /* Firefox all */
        -ms-user-select: none;
        /* IE 10+ */
    }

    .contextual-menu div:hover {
        background: #E5E9F2;
        cursor: pointer;
    }

    .contextual-menu div:active {
        background: #1D8CE0;
        color: white;
    }

    .contextual-menu hr {
        border-bottom: 1px solid #e0e6ed;
    }

    .header-bar-button-group .el-button {
        background-color: #285688F1;
        border: 1px solid #28568821 !important;
        color: #345;
    }

    .header-bar-button.el-button {
        background-color: #285688F1;
    }

    .header-bar-button.el-button.active {
        background-color: #28568861 !important;
        color: white !important;
    }

    /* Grid View Styles */

    .grid-view .grid-item .filename {
        border-radius: 4px;
        padding: 4px;
    }

    .grid-view .grid-item.selected .filename {
        background: #5858ff;
        color: white;
        overflow-x: hidden;
    }

    .grid-view .grid-item .filename {
        overflow-x: hidden;
    }

    /* TABLE styles*/

    table {
        width: 100%;
        display: table;
        border-collapse: collapse;
        ;
        border-spacing: 0;
        box-sizing: content-box;
        font-size: 14px;
    }

    table thead {
        background: #EFF2F7
    }

    table tr {}

    table tr.selected {
        background: #58B7FF;
        color: white;
    }

    table td {
        height: 40px;
        border-bottom: 1px solid #e0e6ed;
        padding-left: 18px;
        padding-right: 18px;
        cursor: default;
        -webkit-user-select: none;
        /* Chrome all / Safari all */
        -moz-user-select: none;
        /* Firefox all */
        -ms-user-select: none;
        /* IE 10+ */
    }

    table th {
        border-bottom: 1px solid #e0e6ed;
        white-space: nowrap;
        overflow: hidden;
        background-color: #EFF2F7;
        text-align: left;
        height: 40px;
        padding-left: 18px;
        padding-right: 18px;
        cursor: pointer;
        -webkit-user-select: none;
        /* Chrome all / Safari all */
        -moz-user-select: none;
        /* Firefox all */
        -ms-user-select: none;
        /* IE 10+ */
    }


    /* Rules for sizing the icon. */

    .material-icons {
        vertical-align: top;
    }

    .material-icons.md-18 {
        font-size: 18px;
    }

    .material-icons.md-24 {
        font-size: 24px;
    }

    .material-icons.md-36 {
        font-size: 36px;
    }

    .material-icons.md-48 {
        font-size: 48px;
    }


    /* Rules for using icons as black on a light background. */

    .material-icons.md-dark {
        color: rgba(0, 0, 0, 0.3);
    }

    .material-icons.md-dark.md-inactive {
        color: rgba(0, 0, 0, 0.26);
    }


    /* Rules for using icons as white on a dark background. */

    .material-icons.md-light {
        color: rgba(255, 255, 255, 1);
    }

    .material-icons.md-light.md-inactive {
        color: rgba(255, 255, 255, 0.3);
    }
</style>

<script>
    import $ from "jquery";
    import { ref, nextTick } from 'vue'
    import { Search } from '@element-plus/icons'



    export default {
        name: 'app',
        data() {
            return {
                basedir: null,
                cwd: null,
                inodes: [],
                lastClickedRow: null,
                viewMode: "list",           // possible values: list, grid
                currentSort: {
                    order: "descending",
                    column: "mtime"
                },
                contextualMenu: {
                    visible: false,
                    x: 100,
                    y: 100
                },
                renameDialog: {
                    visible: false,
                    node: null,
                    newPath: null
                },
                copyDialog: {
                    visible: false,
                    node: null,
                    newName: null
                },
                newFolderDialog: {
                    visible: false,
                    newName: null
                },
                uploadOverLay: {
                    visible: false
                },
                jobProgress: {
                    visible: false,
                    tasks: []
                }
            };
        },
        computed: {
            cwdName() {
                if (!this.cwd)
                    return "";
                var name = this.cwd.replace(this.basedir, "");
                name = name == "" ? "My drive" : name;
                return name;
            },
            sortedNodes() {
                var column = this.currentSort.column;
                var order = this.currentSort.order;
                return this.inodes.sort(function (a, b) {
                    // always place directories on top
                    if (a.type != b.type) {
                        return a.type == "dir" ? -1 : 1;
                    }
                    if (typeof (a[column]) == "string") {
                        var val = a[column].localeCompare(b[column]);
                    } else {
                        var val = a[column] - b[column];
                    }
                    if (order == "descending") {
                        val = val * -1;
                    }
                    return val;
                });
            },
            pathSegments() {
                if (!this.cwd) {
                    return [];
                }
                var relative_cwd = this.cwd.replace(this.basedir, "");
                var path_components = relative_cwd.split("/").filter((s) => s != "");
                var segments = [];
                var fullPath = this.basedir;
                segments.push({
                    "name": this.basedir,
                    "component": "",
                    "path": fullPath
                });
                for (var i = 0; i < path_components.length; i++) {
                    fullPath += "/" + path_components[i];
                    var name = path_components[i];
                    segments.push({
                        "name": name,
                        "component": path_components[i],
                        "path": fullPath
                    });
                }
                return segments;
            },
            contextualMenuItemVisibility() {
                var nodes = this.getCurrentSelectedRows();
                return {
                    "preview": nodes.length > 1 ? false : true,
                    "rename": nodes.length > 1 ? false : true,
                    "download": nodes.length > 1 ? false : true,
                    "copy": nodes.length > 1 ? false : true,
                    "delete": true,
                }
            }

        },
        methods: {
            formatSize(row, column) {
                if (row.type == "dir") {
                    return "--";
                }
                if (row.size < 1024) {
                    return String(row.size) + " Bytes";
                } else if (row.size < Math.pow(1024, 2)) {
                    return String(Math.round(row.size / 1024, 2)) + " KB";
                } else if (row.size < Math.pow(1024, 3)) {
                    return String(Math.round(row.size / Math.pow(1024, 2), 2)) + " MB";
                } else {
                    return String(Math.round(row.size / Math.pow(1024, 3), 2)) + " GB";
                }
            },
            sendFile(file, basedir, progressCallback, doneCallback, extra) {
                console.log("sending file " + file.name);
                var uri = "/upload";
                var xhr = new XMLHttpRequest();
                var fd = new FormData();

                xhr.open("POST", uri, true);
                xhr.onreadystatechange = function (event) {
                    if (xhr.readyState == 4 && xhr.status == 200) {
                        var data = xhr.responseText;
                        doneCallback(event, file, extra, data);
                    }
                };
                xhr.onprogress = function (event) {
                    progressCallback(event, file, extra);
                };
                fd.append('file', file);
                fd.append('basedir', basedir);
                xhr.send(fd);
            },

            // DRAG AND DROP
            handleDragEnter(event) {
                console.log("enter");
                console.log(event.target)
                this.uploadOverLay.visible = true;
            },
            handleDragOver(event) {
                console.log("over");
                console.log(event.target)
                this.uploadOverLay.visible = true;
            },
            handleDragLeave(event) {
                console.log("leaving");
                console.log(event.target)
                this.uploadOverLay.visible = false;
            },
            handleDragDrop(event) {
                event.stopImmediatePropagation();
                event.preventDefault();
                console.log("drop");
                console.log(event.target);
                var files = event.dataTransfer.files;
                for (var i = 0; i < files.length; i++) {
                    var file = files[i];
                    if (this.inodes.filter((node) => node.name == file.name).length > 0) {
                        if (!confirm('File exists, do you want to overwrite: ' + file.name + "?")) {
                            continue;
                        }
                    }
                    var task = {
                        id: Date.now(),
                        message: files[i].name,
                        progress: 0
                    };
                    this.jobProgress.tasks.push(task);
                    var progressfn = function (evt, file, task) {
                        if (evt.lengthComputable) {
                            var percentComplete = (evt.loaded / evt.total) * 100;
                            task.progress = percentComplete;
                        }
                    }.bind(this);
                    var completfn = function (evt, file, task, data) {
                        var node = JSON.parse(data);
                        node.isSelected = false;

                        // only add new node if not already present
                        if (this.inodes.filter((node) => node.name == file.name).length == 0) {
                            this.inodes.push(node);
                        }

                        setTimeout(function () {
                            this.jobProgress.tasks = this.jobProgress.tasks.filter((t) => t.message != task.message);
                            if (this.jobProgress.tasks.length == 0) {
                                this.jobProgress.visible = false;
                            }

                        }.bind(this), 2000)
                    }.bind(this);
                    this.jobProgress.visible = true;
                    this.sendFile(files[i], this.cwd, progressfn, completfn, task);
                }
                this.uploadOverLay.visible = false;
                return false;
            },

            handleRowClick(row, event) {
                event.stopImmediatePropagation();
                this.contextualMenu.visible = false;

                if (event.shiftKey && this.lastClickedRow) {
                    var a = this.inodes.findIndex(function (n) {
                        return this.lastClickedRow == n.name;
                    }.bind(this));
                    var b = this.inodes.findIndex(function (n) {
                        return row.name == n.name;
                    }.bind(this));
                    if (a < b) {
                        var start = a;
                        var stop = b;
                    } else {
                        var start = b;
                        var stop = a;
                    }
                    for (var i = start; i <= stop; i++) {
                        this.inodes[i].isSelected = true;
                    }
                    // row.isSelected = true;
                } else if (!event.metaKey) {
                    this.clearSelection();
                }

                row.isSelected = true;
                this.lastClickedRow = row.name;
            },

            handleRowRightClick(row, event) {
                if (!row.isSelected)
                    this.clearSelection();
                row.isSelected = true;
                this.contextualMenu.x = event.pageX;
                this.contextualMenu.y = event.pageY;
                this.contextualMenu.visible = true;
                event.preventDefault();
                return false;

            },
            handleAppClick(event) {
                this.contextualMenu.visible = false;
                this.clearSelection();

            },
            handleRowDoubleClick(row, event) {
                if (row.type == "file") {
                    window.open("/serve?file=" + row.path);
                } else {
                    this.openFolder(row.path);
                }
            },

            truncate: function (text, stop, clamp) {
                return text.slice(0, stop) + (stop < text.length ? clamp || ' ...' : '')
            },

            toggleSort(column, event) {
                event.preventDefault();
                var order = this.currentSort.order == "descending" ? "ascending" : "descending";
                this.currentSort.column = column;
                this.currentSort.order = order;
                return false;
            },

            clearSelection() {
                for (var i = 0; i < this.inodes.length; i++) {
                    this.inodes[i].isSelected = false;
                }
            },
            getCurrentSelectedRows() {
                return this.inodes.filter((row) => row.isSelected)
            },

            // New Folder Dialog
            hanldeNewFolderDialogConfirm(event) {
                this.newFolderDialog.visible = false;
                this.newFolder(this.cwd + "/" + this.newFolderDialog.newName);
            },

            // Copy Dialog
            handleCopyDialogConfirm(event) {
                this.copyDialog.visible = false;
                this.copyNode(this.copyDialog.node, this.cwd + "/" + this.copyDialog.newName);
            },

            // Rename Dialog
            handleRenameDialogConfirm(event) {
                this.renameNode(this.renameDialog.node, this.renameDialog.newPath);
                this.renameDialog.visible = false;
            },

            // New menu commands
            handleNewFolderMenu(event) {
                this.newFolderDialog.visible = true;
                setTimeout(() => {
                    $("input[name='newFolderDialogName']").focus();
                }, 300)
            },

            // contextual menu commands
            handleCopyContextualMenu(event) {
                this.copyDialog.node = this.getCurrentSelectedRows()[0];
                var name = this.copyDialog.node.path.split("/");
                name = name[name.length - 1];
                this.copyDialog.newName = name;
                this.copyDialog.visible = true;

                setTimeout(() => {
                    $("input[name='copyDialogNewPath']").focus();
                }, 300)
            },

            async handleRenameContextualMenu(event) {
                this.renameDialog.node = this.getCurrentSelectedRows()[0];
                this.renameDialog.newPath = this.renameDialog.node.path;
                this.renameDialog.visible = true;
                setTimeout(() => {
                    $("input[name='renameDialogNewPath']").focus();
                }, 300)
            },

            handleDownloadContextualMenu(event) {
                let nodes_to_download = this.getCurrentSelectedRows();
                if (nodes_to_download.length == 1) {
                    var n = nodes_to_download[0];
                    window.open("/download?file=" + n.path);
                } else {
                    alert("Sorry, downloading multiple files at once is not enabled");
                }
            },

            handleDeleteContextualMenu(event) {
                let nodes_to_delete = this.getCurrentSelectedRows();
                let paths = nodes_to_delete.map((r) => r.path);
                let payload = {
                    "command": "rm",
                    "paths": paths
                };
                let nodes_to_delete_names = nodes_to_delete.map((r) => r.name);

                $.post("/api", {
                    "payload": JSON.stringify(payload)
                }, function (data) {
                    console.log(nodes_to_delete_names)
                    this.inodes = this.inodes.filter((r) => nodes_to_delete_names.indexOf(r.name) < 0);
                }.bind(this));
            },

            handleSegmentClick(segment, event) {
                this.openFolder(segment.path);
            },

            renameNode(node, newPath) {
                var payload = {
                    "command": "mv",
                    "paths": [node.path],
                    "destination": newPath
                }
                var newPathComponents = newPath.split("/");
                this.callApi(payload, function (data) {
                    node.path = newPath;
                    node.name = newPathComponents[newPathComponents.length - 1];
                }.bind(this));
            },

            copyNode(node, newPath) {
                var payload = {
                    "command": "cp",
                    "paths": [node.path],
                    "destination": newPath
                }
                var newPathComponents = newPath.split("/");
                var newNode = JSON.parse(JSON.stringify(node));
                newNode.path = newPath;
                newNode.name = newPathComponents[newPathComponents.length - 1];
                this.inodes.push(newNode);
                this.callApi(payload, function (data) { }.bind(this));
            },

            openFolder(path) {
                var payload = {
                    "command": "ls",
                    "path": path
                };
                $.post("/api", {
                    "payload": JSON.stringify(payload)
                }, function (data) {
                    var data = JSON.parse(data);
                    this.cwd = data.cwd;
                    this.basedir = data.basedir;
                    var nodes = data.nodes;
                    this.inodes = [];
                    for (var i = 0; i < nodes.length; i++) {
                        nodes[i].isSelected = false;
                        this.inodes.push(nodes[i]);
                    }
                }.bind(this));

            },

            newFolder(path) {
                var payload = {
                    "command": "mkdir",
                    "path": path
                };
                this.callApi(payload, function (data) {
                    var node = JSON.parse(data);
                    node.isSelected = true;
                    this.inodes.push(node);
                }.bind(this));
            },

            callApi(payload, callback) {
                var data = {
                    "payload": JSON.stringify(payload)
                };
                $.post("/api", data, callback);
            },

        },

        // this is called by Vue upon initialization
        created() {
            $.getJSON("/api", ((data) => {
                this.cwd = data.cwd;
                this.basedir = data.basedir;
                var nodes = data.nodes;
                for (var i = 0; i < nodes.length; i++) {
                    nodes[i].isSelected = false;
                    this.inodes.push(nodes[i]);
                }

            }).bind(this));
        }

    }
</script>