import React, { useState, useEffect } from "react";
import { getAllRemediationActions } from "../services/api";
import Header from "../components/Header";
import { ModalPortal } from "../components/Modal";

export default function AIOperations() {
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedAction, setSelectedAction] = useState(null);

    const fetchActions = async () => {
        try {
            const res = await getAllRemediationActions();
            const rawData = Array.isArray(res) ? res : (res.data || res.actions || []);
            setActions(rawData);
            setError(null);
        } catch (err) {
            console.error("Error loading AI operations:", err);
            setError(err.message || "Failed to load AI operations history");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchActions();
        const interval = setInterval(fetchActions, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape" && selectedAction) {
                setSelectedAction(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedAction]);

    const successfulCount = actions.filter(a => a.status === "SUCCESS").length;
    const failedCount = actions.filter(a => a.status === "FAILED" || a.status === "UNVERIFIED").length;
    const rejectedCount = actions.filter(a => a.status === "REJECTED").length;
    const activeCount = actions.filter(a => a.status === "EXECUTING" || a.status === "PENDING" || a.status === "APPROVED").length;

    return (
        <div className="page-container">
            <Header
                title="AI Operations & Decision History"
                onRefresh={fetchActions}
            />

            {/* SUMMARY STATS */}
            <div className="metrics-grid">
                <div className="metric-tile">
                    <span className="tile-label">Total AI Actions</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{actions.length}</span>
                    </div>
                    <span className="tile-status healthy">Evaluated</span>
                </div>

                <div className="metric-tile">
                    <span className="tile-label">Successful Remediations</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{successfulCount}</span>
                    </div>
                    <span className="tile-status healthy">Verified Recoveries</span>
                </div>

                <div className="metric-tile">
                    <span className="tile-label">Failed / Unverified</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{failedCount}</span>
                    </div>
                    <span className="tile-status critical">Requires Review</span>
                </div>

                <div className="metric-tile">
                    <span className="tile-label">Active / Pending</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{activeCount}</span>
                    </div>
                    <span className="tile-status warning">In Progress</span>
                </div>
            </div>

            {/* RECENT REMEDIATION CARDS */}
            <section className="dashboard-section">
                <h2 className="section-title">Active & Recent AI Decisions</h2>
                {loading && actions.length === 0 ? (
                    <div className="empty-state">Loading AI decisions...</div>
                ) : error && actions.length === 0 ? (
                    <div className="empty-state error">⚠️ {error}</div>
                ) : actions.length === 0 ? (
                    <div className="empty-state">
                        <p style={{ fontWeight: 600, fontSize: "1.05rem", marginBottom: "0.5rem" }}>
                            No remediation actions recorded yet.
                        </p>
                        <p style={{ color: "var(--text-muted, #64748b)" }}>
                            AI decisions and remediation executions will appear here after an incident is analyzed and an approved action is executed.
                        </p>
                    </div>
                ) : (
                    <div className="ai-cards-grid">
                        {actions.slice(0, 4).map((act) => (
                            <div key={act._id} className="ai-action-card" onClick={() => setSelectedAction(act)}>
                                <div className="card-top-row">
                                    <span className="action-type-badge">⚡ {act.action}</span>
                                    <span className={`status-pill ${act.status?.toLowerCase()}`}>
                                        {act.status}
                                    </span>
                                </div>
                                {act.incident && typeof act.incident === "object" && (
                                    <h4 className="card-target" style={{ marginBottom: "0.25rem", color: "var(--text-main, #0f172a)" }}>
                                        Incident: <strong>{act.incident.title || "Incident Action"}</strong>
                                    </h4>
                                )}
                                <h4 className="card-target">Target: <code>{act.target}</code></h4>
                                <p className="card-reason">{act.reason}</p>

                                <div className="card-verification-box">
                                    <span className="ver-lbl">Policy Check:</span>
                                    <span className="ver-val">
                                        {act.policy?.approved ? "Approved" : "Rejected"}
                                        {act.policy?.rule ? ` (${act.policy.rule})` : ""}
                                    </span>
                                    {act.verification && act.verification.message && (
                                        <div className="ver-metric">
                                            <span>Telemetry: {act.verification.message}</span>
                                        </div>
                                    )}
                                </div>
                                <span className="card-timestamp">{new Date(act.createdAt).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* FULL ACTION HISTORY TABLE */}
            <section className="dashboard-section">
                <div className="ops-card">
                    <div className="card-header">
                        <h3>Audit History Log</h3>
                        <span className="card-tag">Immutable Audit Trail</span>
                    </div>

                    {actions.length === 0 ? (
                        <div className="empty-state" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted, #64748b)" }}>
                            No remediation audit records yet.
                        </div>
                    ) : (
                        <div className="table-responsive">
                            <table className="ops-table">
                                <thead>
                                    <tr>
                                        <th>Timestamp</th>
                                        <th>Action</th>
                                        <th>Target</th>
                                        <th>Reason</th>
                                        <th>Status</th>
                                        <th>Verification Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {actions.map((act) => (
                                        <tr key={act._id} className="clickable-row" onClick={() => setSelectedAction(act)}>
                                            <td className="text-muted">{new Date(act.createdAt).toLocaleString()}</td>
                                            <td className="font-semibold">{act.action}</td>
                                            <td><code>{act.target}</code></td>
                                            <td className="truncate-text">{act.reason}</td>
                                            <td>
                                                <span className={`status-pill ${act.status?.toLowerCase()}`}>
                                                    {act.status}
                                                </span>
                                            </td>
                                            <td>{act.verification?.message || act.result || act.error || "Pending"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>

            {/* ACTION INSPECTION MODAL */}
            {selectedAction && (
                <ModalPortal isOpen={Boolean(selectedAction)} onClose={() => setSelectedAction(null)}>
                    <div
                        className="modal-backdrop"
                        onClick={() => setSelectedAction(null)}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="audit-modal-title"
                    >
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 id="audit-modal-title" className="modal-title">AI Remediation Audit Detail</h3>
                                <button
                                    type="button"
                                    className="modal-close-btn"
                                    onClick={() => setSelectedAction(null)}
                                    aria-label="Close dialog"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="modal-body">
                                {selectedAction.incident && typeof selectedAction.incident === "object" && (
                                    <div className="detail-row">
                                        <span className="lbl">Incident:</span>
                                        <strong>{selectedAction.incident.title}</strong> ({selectedAction.incident.severity})
                                    </div>
                                )}
                                <div className="detail-row"><span className="lbl">Action:</span> <strong>{selectedAction.action}</strong></div>
                                <div className="detail-row"><span className="lbl">Target Service:</span> <code>{selectedAction.target}</code></div>
                                <div className="detail-row"><span className="lbl">Triggered By:</span> {selectedAction.triggeredBy || "CloudOps AI"}</div>
                                <div className="detail-row"><span className="lbl">Reason:</span> {selectedAction.reason}</div>
                                <div className="detail-row"><span className="lbl">Status:</span> <span className={`status-pill ${selectedAction.status?.toLowerCase()}`}>{selectedAction.status}</span></div>
                                <div className="detail-row">
                                    <span className="lbl">Policy Check:</span>
                                    <span>{selectedAction.policy?.approved ? "Approved" : "Rejected"}{selectedAction.policy?.reason ? ` - ${selectedAction.policy.reason}` : ""}</span>
                                </div>
                                {selectedAction.result && (
                                    <div className="detail-row"><span className="lbl">Execution Result:</span> {selectedAction.result}</div>
                                )}
                                {selectedAction.error && (
                                    <div className="detail-row"><span className="lbl">Execution Error:</span> <span style={{ color: "var(--color-critical)" }}>{selectedAction.error}</span></div>
                                )}
                                {selectedAction.verification && selectedAction.verification.message && (
                                    <div className="detail-row"><span className="lbl">Verification Telemetry:</span> {selectedAction.verification.message}</div>
                                )}
                                <div className="detail-row"><span className="lbl">Timestamp:</span> {new Date(selectedAction.createdAt).toLocaleString()}</div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setSelectedAction(null)}>Close</button>
                            </div>
                        </div>
                    </div>
                </ModalPortal>
            )}
        </div>
    );
}
