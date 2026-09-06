import React from "react";
import { NavLink } from "react-router-dom";
import { useSystemHealth } from "../hooks/useSystemHealth";

export default function Sidebar({ mobileOpen, setMobileOpen, user, onLogout }) {
    const { globalStatus } = useSystemHealth();

    const prometheusUrl = import.meta.env.VITE_PROMETHEUS_URL || "http://localhost:9090";
    const grafanaUrl = import.meta.env.VITE_GRAFANA_URL || "http://localhost:3000";

    const mainNav = [
        { path: "/", label: "Overview", icon: "📊" },
        { path: "/observability", label: "Observability", icon: "📈" },
        { path: "/infrastructure", label: "Infrastructure", icon: "🖥️" },
        { path: "/incidents", label: "Incidents", icon: "🚨" },
        { path: "/ai-ops", label: "AI Operations", icon: "⚡" },
        { path: "/kubernetes", label: "Kubernetes", icon: "☸️" },
        { path: "/reliability", label: "Reliability", icon: "🎯" }
    ];

    const getStatusColor = () => {
        switch (globalStatus) {
            case "HEALTHY": return "#16A34A";
            case "WARNING": return "#F59E0B";
            case "CRITICAL": return "#DC2626";
            default: return "#64748B";
        }
    };

    return (
        <>
            {mobileOpen && (
                <div
                    className="sidebar-backdrop"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            <aside className={`control-sidebar ${mobileOpen ? "open" : ""}`}>
                {/* BRAND HEADER */}
                <div className="sidebar-brand">
                    <div className="brand-logo">☁️</div>
                    <div className="brand-titles">
                        <span className="brand-name">CLOUDOPS AI</span>
                        <span className="brand-sub">Autonomous Cloud Operations</span>
                    </div>
                </div>

                {/* NAVIGATION */}
                <nav className="sidebar-nav">
                    <div className="nav-section-title">MAIN</div>
                    {mainNav.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={item.path === "/"}
                            className={({ isActive }) =>
                                `nav-item ${isActive ? "active" : ""}`
                            }
                            onClick={() => setMobileOpen(false)}
                        >
                            <span className="nav-icon">{item.icon}</span>
                            <span className="nav-label">{item.label}</span>
                        </NavLink>
                    ))}

                    <div className="nav-section-title" style={{ marginTop: "1.5rem" }}>
                        OBSERVABILITY
                    </div>
                    <a
                        href={prometheusUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="nav-item external-link"
                    >
                        <span className="nav-icon">🔥</span>
                        <span className="nav-label">Prometheus ↗</span>
                    </a>
                    <a
                        href={grafanaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="nav-item external-link"
                    >
                        <span className="nav-icon">📈</span>
                        <span className="nav-label">Grafana ↗</span>
                    </a>
                </nav>

                {/* FOOTER: SYSTEM STATUS & USER PROFILE */}
                <div className="sidebar-footer">
                    <div className="system-status-widget">
                        <span
                            className="status-dot"
                            style={{ backgroundColor: getStatusColor() }}
                        />
                        <span className="status-text">{globalStatus} System State</span>
                    </div>

                    <div className="user-profile-widget">
                        <div className="user-avatar">
                            {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
                        </div>
                        <div className="user-details">
                            <span className="user-name">{user?.name || "Cloud Engineer"}</span>
                            <span className="user-role">{user?.role || "ENGINEER"}</span>
                        </div>
                        <button
                            type="button"
                            className="logout-btn"
                            onClick={onLogout}
                            title="Sign Out"
                        >
                            🚪
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
}
