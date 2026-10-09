import React, { useState } from "react";
import ThemeToggle from "./ThemeToggle";

export default function Header({
    mobileOpen,
    setMobileOpen,
    title,
    subtitle,
    lastUpdated,
    onRefresh,
    refreshing = false,
    actions
}) {
    const [localRefreshing, setLocalRefreshing] = useState(false);

    const isSpinning = refreshing || localRefreshing;

    const handleRefreshClick = async () => {
        if (!onRefresh || isSpinning) return;
        setLocalRefreshing(true);
        try {
            await Promise.resolve(onRefresh());
        } catch (e) {
            console.error("Refresh error:", e);
        } finally {
            // Keep subtle spin feeling deliberate and smooth
            setTimeout(() => setLocalRefreshing(false), 450);
        }
    };

    return (
        <header className="control-header">
            <div className="header-left">
                {setMobileOpen && (
                    <button
                        type="button"
                        className="mobile-toggle"
                        onClick={() => setMobileOpen(!mobileOpen)}
                        aria-label="Toggle navigation menu"
                        aria-expanded={Boolean(mobileOpen)}
                    >
                        ☰
                    </button>
                )}
                <div>
                    <h1 className="header-title">{title}</h1>
                    {subtitle && <p className="modal-subtitle" style={{ margin: "2px 0 0 0" }}>{subtitle}</p>}
                </div>
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
                        className={`refresh-btn ${isSpinning ? "spinning" : ""}`}
                        onClick={handleRefreshClick}
                        disabled={isSpinning}
                        aria-label="Refresh telemetry data"
                        title="Refresh live data"
                    >
                        <span className="refresh-icon" aria-hidden="true">🔄</span>
                        <span>{isSpinning ? "Refreshing..." : "Refresh"}</span>
                    </button>
                )}
                {actions}
                <ThemeToggle />
            </div>
        </header>
    );
}


