// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useRef } from 'react'

import Modal from './Modal.jsx'

// Single-line text prompt used by the rename / copy / new folder dialogs.
export default function PromptDialog({
    open,
    title,
    value,
    placeholder,
    confirmText = 'OK',
    onChange,
    onConfirm,
    onCancel,
}) {
    const inputRef = useRef(null)

    useEffect(() => {
        if (!open) {
            return
        }
        // focus the input and put the caret at the end, ready to be edited
        const input = inputRef.current
        input.focus()
        const end = input.value.length
        input.setSelectionRange(end, end)
    }, [open])

    return (
        <Modal
            open={open}
            title={title}
            onClose={onCancel}
            footer={(
                <>
                    <button type="button" className="btn" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={onConfirm}>
                        {confirmText}
                    </button>
                </>
            )}
        >
            <input
                ref={inputRef}
                type="text"
                className="text-input"
                value={value ?? ''}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        onConfirm()
                    }
                }}
            />
        </Modal>
    )
}
