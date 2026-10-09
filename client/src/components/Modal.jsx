import React, { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Global Modal Portal Wrapper
 * Ensures modals render directly into document.body so they are never
 * clipped, trapped, or displaced by parent transforms, filters, or overflows.
 * Handles body scroll locking and Escape key navigation automatically.
 */
export function ModalPortal({ children, isOpen = true, onClose }) {
    useEffect(() => {
        if (!isOpen) return;

        // Prevent underlying page scrolling while modal is open
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (e) => {
            if (e.key === "Escape" && onClose) {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(children, document.body);
}

/**
 * Standard Centered Modal Component
 */
export default function Modal({
    isOpen = true,
    onClose,
    title,
    subtitle,
    children,
    footer,
    maxWidth = "560px",
    className = "",
    ariaLabelledBy = "modal-dialog-title"
}) {
    useEffect(() => {
        if (!isOpen) return;

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (e) => {
            if (e.key === "Escape" && onClose) {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            className="modal-backdrop"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy}
        >
            <div
                className={`modal-content ${className}`}
                style={{ maxWidth }}
                onClick={(e) => e.stopPropagation()}
            >
                {(title || onClose) && (
                    <div className="modal-header">
                        <div className="modal-title-wrap">
                            {title && (
                                <h3 id={ariaLabelledBy} className="modal-title">
                                    {title}
                                </h3>
                            )}
                            {subtitle && (
                                <p className="modal-subtitle">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                        {onClose && (
                            <button
                                type="button"
                                className="modal-close-btn"
                                onClick={onClose}
                                aria-label="Close dialog"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}
                <div className="modal-body">
                    {children}
                </div>
                {footer && (
                    <div className="modal-footer">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
