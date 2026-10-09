import React from "react";

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an unhandled render error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{
                        padding: "3rem 2rem",
                        maxWidth: "720px",
                        margin: "2rem auto",
                        background: "var(--bg-card, #ffffff)",
                        border: "1px solid var(--border-color, #e2e8f0)",
                        borderRadius: "14px",
                        boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08))",
                        textAlign: "center",
                        color: "var(--color-text-main, #1e293b)"
                    }}
                >
                    <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
                    <h2 style={{ fontSize: "1.3rem", fontWeight: "700", marginBottom: "0.5rem" }}>
                        Application Render Error
                    </h2>
                    <p style={{ color: "var(--color-text-muted, #64748b)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                        An unexpected error occurred while rendering this view.
                    </p>

                    {this.state.error && (
                        <div
                            style={{
                                textAlign: "left",
                                background: "var(--bg-card-secondary, #f8fafc)",
                                border: "1px solid var(--border-color, #cbd5e1)",
                                borderRadius: "8px",
                                padding: "1rem",
                                fontSize: "0.82rem",
                                fontFamily: "monospace",
                                color: "var(--color-critical, #dc2626)",
                                marginBottom: "1.5rem",
                                overflowX: "auto"
                            }}
                        >
                            {this.state.error.toString()}
                        </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => { window.location.href = "/"; }}
                        >
                            Return to Overview
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={this.handleReset}
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
