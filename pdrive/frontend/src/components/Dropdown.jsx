// pdrive - a web based document browser
// Copyright (C) 2017 Huy Nguyen
// Licensed under the GNU General Public License v3 or later. See LICENSE.

import { useEffect, useRef, useState } from 'react'

// Button + popup menu used by the "New" toolbar action.
export default function Dropdown({ items, onSelect, buttonClassName, buttonContent, ariaLabel }) {
    const [open, setOpen] = useState(false)
    const containerRef = useRef(null)

    useEffect(() => {
        if (!open) {
            return undefined
        }
        const handleMouseDown = (event) => {
            if (!containerRef.current?.contains(event.target)) {
                setOpen(false)
            }
        }
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handleMouseDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handleMouseDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open])

    return (
        <div className="dropdown" ref={containerRef}>
            <button
                type="button"
                className={buttonClassName}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={ariaLabel}
                onClick={() => setOpen((value) => !value)}
            >
                {buttonContent}
            </button>
            {open && (
                <ul className="dropdown-menu" role="menu">
                    {items.map((item) => (
                        <li key={item.key} role="none">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setOpen(false)
                                    onSelect(item.key)
                                }}
                            >
                                <i className="material-icons md-24 new-menu-icon">{item.icon}</i>
                                {item.label}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
