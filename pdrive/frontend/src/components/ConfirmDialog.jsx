// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useRef } from 'react'

import Modal from './Modal.jsx'

// Yes / no dialog for actions that cannot be taken back. `danger` paints the
// confirm button red, and the safe choice (Cancel) is the one that gets the
// focus, so a stray Enter or Space does not delete anything.
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmText = 'OK',
    cancelText = 'Cancel',
    danger = false,
    onConfirm,
    onCancel,
}) {
    const cancelRef = useRef(null)

    useEffect(() => {
        if (open) {
            cancelRef.current?.focus()
        }
    }, [open])

    return (
        <Modal
            open={open}
            title={title}
            onClose={onCancel}
            footer={(
                <>
                    <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
                        {cancelText}
                    </button>
                    <button
                        type="button"
                        className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')}
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </button>
                </>
            )}
        >
            <p className="confirm-message">{message}</p>
        </Modal>
    )
}
