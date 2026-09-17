import React from "react";
import ThemeToggle from "./ThemeToggle";

export default function Header({ mobileOpen, setMobileOpen, title, lastUpdated, onRefresh }) {
    return (
        <header className="control-header">
            <div className="header-left">
                <button
                    type="button"
                    className="mobile-toggle"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    aria-label="Toggle navigation"
                >
                    ☰
                </button>
                <h1 className="header-title">{title}</h1>
            </div>

            <div className="header-right">
                {lastUpdated && (
                    <span className="last-updated">
                        Updated {Math.max(0, Math.floor((new Date() - new Date(lastUpdated)) / 1000))}s ago
                    </span>
                )}
                {onRefresh && (
                    <button
                        type="button"
                        className="refresh-btn"
                        onClick={onRefresh}
                        title="Refresh metrics"
                    >
                        🔄 Refresh
                    </button>
                )}
                <ThemeToggle />
            </div>
        </header>
    );
}

