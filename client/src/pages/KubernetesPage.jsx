import React, { useState, useEffect } from "react";
import { getKubernetesOverview, executeKubernetesAction, getInfrastructureConnections } from "../services/api";
import Header from "../components/Header";
import { ModalPortal } from "../components/Modal";

export default function KubernetesPage() {
    const [k8sData, setK8sData] = useState(null);
    const [selectedEnvironment, setSelectedEnvironment] = useState("local");
    const [availableConnections, setAvailableConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);

    // Modal state for scaling
    const [scaleModalOpen, setScaleModalOpen] = useState(false);
    const [targetDeployment, setTargetDeployment] = useState(null);
    const [desiredReplicas, setDesiredReplicas] = useState(4);

    // Modal state for restart confirmation
    const [restartModalOpen, setRestartModalOpen] = useState(false);

    // Audit detail modal
    const [selectedAuditDetail, setSelectedAuditDetail] = useState(null);

    // Load available connections
    useEffect(() => {
        const loadConnections = async () => {
            try {
                const res = await getInfrastructureConnections();
                if (res.success) {
                    setAvailableConnections(res.connections || []);
                }
            } catch (e) {}
        };
        loadConnections();
    }, []);

    const fetchK8s = async (connId = selectedEnvironment) => {
        try {
            setLoading(true);
            setErrorMsg(null);
            const data = await getKubernetesOverview(undefined, connId);
            setK8sData(data);
        } catch (err) {
            console.error("K8s fetch error:", err);
            setErrorMsg(err.message || "Failed to connect to Kubernetes API");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchK8s(selectedEnvironment);
        const interval = setInterval(() => fetchK8s(selectedEnvironment), 10000);
        return () => clearInterval(interval);
    }, [selectedEnvironment]);

    const handleScaleSubmit = async (e) => {
        e.preventDefault();
        if (!targetDeployment) return;

        try {
            setActionLoading(true);
            setErrorMsg(null);
            setSuccessMsg(null);

            const res = await executeKubernetesAction({
                action: "SCALE_SERVICE",
                target: targetDeployment.name,
                namespace: targetDeployment.namespace,
                replicas: Number(desiredReplicas),
                connectionId: selectedEnvironment !== "local" ? selectedEnvironment : undefined,
                reason: `Manual scaling via UI to ${desiredReplicas} replicas`
            });

            setSuccessMsg(res.message || `Successfully scaled ${targetDeployment.name} to ${desiredReplicas} replicas.`);
            setScaleModalOpen(false);
            fetchK8s(selectedEnvironment);
        } catch (err) {
            setErrorMsg(err.message || "Scale action failed");
        } finally {
            setActionLoading(false);
        }
    };

    const handleRestartSubmit = async () => {
        if (!targetDeployment) return;

        try {
            setActionLoading(true);
            setErrorMsg(null);
            setSuccessMsg(null);

            const res = await executeKubernetesAction({
                action: "RESTART_SERVICE",
                target: targetDeployment.name,
                namespace: targetDeployment.namespace,
                connectionId: selectedEnvironment !== "local" ? selectedEnvironment : undefined,
                reason: `Manual rolling restart via UI`
            });

            setSuccessMsg(res.message || `Rolling restart initiated for ${targetDeployment.name}.`);
            setRestartModalOpen(false);
            fetchK8s(selectedEnvironment);
        } catch (err) {
            setErrorMsg(err.message || "Restart action failed");
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="page-container">
            <Header
                title="Kubernetes Cluster Control Center"
                onRefresh={() => fetchK8s(selectedEnvironment)}
            />

            {/* ENVIRONMENT SELECTOR BAR */}
            <div className="environment-control-bar">
                <div className="environment-label-group">
                    <span className="environment-label">Active Cluster Environment:</span>
                    <select
                        className="form-select"
                        value={selectedEnvironment}
                        onChange={(e) => setSelectedEnvironment(e.target.value)}
                        aria-label="Active Cluster Environment"
                    >
                        <option value="local">💻 Local Cluster (Minikube / Kind)</option>
                        {availableConnections.map((c) => (
                            <option key={c._id} value={c._id}>
                                🌐 {c.name} ({c.status})
                            </option>
                        ))}
                    </select>
                </div>
                <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                    {selectedEnvironment === "local" ? "Direct Kubeconfig Integration" : "Connected Agent Outbound Channel"}
                </span>
            </div>

            {/* Notification Badges */}
            {errorMsg && (
                <div className="alert-banner error">
                    <span>⚠️ {errorMsg}</span>
                    <button className="close-btn" onClick={() => setErrorMsg(null)}>×</button>
                </div>
            )}
            {successMsg && (
                <div className="alert-banner success">
                    <span>✅ {successMsg}</span>
                    <button className="close-btn" onClick={() => setSuccessMsg(null)}>×</button>
                </div>
            )}

            {loading && !k8sData ? (
                <div className="empty-state">Connecting to Kubernetes API...</div>
            ) : !k8sData?.connected ? (
                /* DISCONNECTED / UNCONFIGURED STATE */
                <section className="dashboard-section">
                    <div className="ops-card k8s-unconfigured-card">
                        <div className="k8s-icon-header">
                            <span className="big-k8s-icon">☸️</span>
                            <h2>Kubernetes Cluster Not Connected</h2>
                            <p className="k8s-sub">
                                {k8sData?.message || "The backend is operating in Standalone / Docker mode. Connect a Kubernetes cluster via KUBECONFIG or run in-cluster to enable live telemetry & pod orchestration."}
                            </p>
                        </div>

                        <div className="k8s-features-grid">
                            <div className="feature-tile">
                                <span className="feat-title">🔌 Local Minikube / Kind</span>
                                <p>Set <code>KUBECONFIG=~/.kube/config</code> to connect local Minikube or Kind cluster.</p>
                            </div>
                            <div className="feature-tile">
                                <span className="feat-title">☸️ Autonomous HPA Scaling</span>
                                <p>Execute real <code>SCALE_SERVICE</code> actions through the backend @kubernetes/client-node library.</p>
                            </div>
                            <div className="feature-tile">
                                <span className="feat-title">🔄 Rolling Restarts</span>
                                <p>Perform zero-downtime rolling pod updates via declarative deployment template annotations.</p>
                            </div>
                            <div className="feature-tile">
                                <span className="feat-title">🛡️ Policy & Audit Verification</span>
                                <p>Strict target whitelisting (min 1, max 10 replicas) with post-execution metric convergence checks.</p>
                            </div>
                        </div>

                        <div className="k8s-config-notice">
                            <code>Backend Status: KUBERNETES_UNAVAILABLE (Fallback to Docker mode)</code>
                        </div>
                    </div>
                </section>
            ) : (
                /* LIVE KUBERNETES DASHBOARD */
                <>
                    {/* Cluster Summary Metrics */}
                    <div className="metrics-grid">
                        <div className="metric-tile">
                            <span className="tile-label">Cluster Connection</span>
                            <div className="tile-value-row">
                                <span className="tile-value" style={{ fontSize: "1.1rem" }}>{k8sData.cluster}</span>
                            </div>
                            <span className="tile-status healthy">● Connected</span>
                        </div>
                        <div className="metric-tile">
                            <span className="tile-label">Nodes</span>
                            <div className="tile-value-row">
                                <span className="tile-value">
                                    {k8sData.summary?.nodesReady || 0} / {k8sData.summary?.nodesTotal || 0}
                                </span>
                            </div>
                            <span className="tile-status healthy">Ready</span>
                        </div>
                        <div className="metric-tile">
                            <span className="tile-label">Pods</span>
                            <div className="tile-value-row">
                                <span className="tile-value">
                                    {k8sData.summary?.podsRunning || 0} / {k8sData.summary?.podsTotal || 0}
                                </span>
                            </div>
                            <span className="tile-status healthy">Running</span>
                        </div>
                        <div className="metric-tile">
                            <span className="tile-label">Deployments</span>
                            <div className="tile-value-row">
                                <span className="tile-value">
                                    {k8sData.summary?.deploymentsHealthy || 0} / {k8sData.summary?.deploymentsTotal || 0}
                                </span>
                            </div>
                            <span className="tile-status healthy">Healthy</span>
                        </div>
                    </div>

                    {/* Nodes Table */}
                    <section className="dashboard-section">
                        <div className="ops-card">
                            <div className="section-header-row">
                                <h3>🖥️ Cluster Nodes</h3>
                                <span className="text-muted">Namespace: {k8sData.namespace}</span>
                            </div>
                            <div className="table-responsive">
                                <table className="ops-table">
                                    <thead>
                                        <tr>
                                            <th>Node Name</th>
                                            <th>Status</th>
                                            <th>Roles</th>
                                            <th>CPU</th>
                                            <th>Memory</th>
                                            <th>Kubelet Version</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {k8sData.nodes && k8sData.nodes.length > 0 ? (
                                            k8sData.nodes.map((node) => (
                                                <tr key={node.name}>
                                                    <td className="font-semibold">{node.name}</td>
                                                    <td>
                                                        <span className={`status-pill ${node.status === "Ready" ? "success" : "danger"}`}>
                                                            {node.status}
                                                        </span>
                                                    </td>
                                                    <td>{node.roles}</td>
                                                    <td>{node.cpu}</td>
                                                    <td>{node.memory}</td>
                                                    <td>{node.kubeletVersion}</td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="6" className="text-muted text-center">No nodes reported.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {/* Deployments Table with Action Buttons */}
                    <section className="dashboard-section">
                        <div className="ops-card">
                            <div className="section-header-row">
                                <h3>📦 Deployments & Safe Orchestration</h3>
                                <span className="text-muted">Policy Enforced: Min 1, Max 10 Replicas</span>
                            </div>
                            <div className="table-responsive">
                                <table className="ops-table">
                                    <thead>
                                        <tr>
                                            <th>Deployment</th>
                                            <th>Namespace</th>
                                            <th>Replicas (Ready/Desired)</th>
                                            <th>Available</th>
                                            <th>Status</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {k8sData.deployments && k8sData.deployments.length > 0 ? (
                                            k8sData.deployments.map((dep) => (
                                                <tr key={`${dep.namespace}-${dep.name}`}>
                                                    <td className="font-semibold">{dep.name}</td>
                                                    <td><code>{dep.namespace}</code></td>
                                                    <td><strong>{dep.ready}</strong> / {dep.desired}</td>
                                                    <td>{dep.available}</td>
                                                    <td>
                                                        <span className={`status-pill ${dep.status === "HEALTHY" ? "success" : "warning"}`}>
                                                            {dep.status}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="action-button-group" style={{ display: "flex", gap: "6px" }}>
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                disabled={actionLoading}
                                                                onClick={() => {
                                                                    setTargetDeployment(dep);
                                                                    setDesiredReplicas(dep.desired + 1 <= 10 ? dep.desired + 1 : dep.desired);
                                                                    setScaleModalOpen(true);
                                                                }}
                                                            >
                                                                ⚡ Scale
                                                            </button>
                                                            <button
                                                                className="btn btn-outline btn-sm"
                                                                disabled={actionLoading}
                                                                onClick={() => {
                                                                    setTargetDeployment(dep);
                                                                    setRestartModalOpen(true);
                                                                }}
                                                            >
                                                                🔄 Restart
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="6" className="text-muted text-center">No deployments found in namespace <code>{k8sData.namespace}</code>.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {/* Pods Table */}
                    <section className="dashboard-section">
                        <div className="ops-card">
                            <h3>🚀 Active Pods</h3>
                            <div className="table-responsive">
                                <table className="ops-table">
                                    <thead>
                                        <tr>
                                            <th>Pod Name</th>
                                            <th>Namespace</th>
                                            <th>Status</th>
                                            <th>Ready</th>
                                            <th>Restarts</th>
                                            <th>Node</th>
                                            <th>IP</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {k8sData.pods && k8sData.pods.length > 0 ? (
                                            k8sData.pods.map((pod) => (
                                                <tr key={pod.name}>
                                                    <td className="font-semibold">{pod.name}</td>
                                                    <td><code>{pod.namespace}</code></td>
                                                    <td>
                                                        <span className={`status-pill ${pod.status === "Running" ? "success" : "danger"}`}>
                                                            {pod.status}
                                                        </span>
                                                    </td>
                                                    <td>{pod.ready}</td>
                                                    <td>{pod.restarts}</td>
                                                    <td>{pod.node}</td>
                                                    <td><code>{pod.ip}</code></td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="7" className="text-muted text-center">No active pods in namespace.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {/* Kubernetes Remediation Action Audit Log */}
                    <section className="dashboard-section">
                        <div className="ops-card">
                            <h3>📜 Recent Kubernetes Remediation Audit History</h3>
                            <div className="table-responsive">
                                <table className="ops-table">
                                    <thead>
                                        <tr>
                                            <th>Action</th>
                                            <th>Target</th>
                                            <th>Triggered By</th>
                                            <th>Policy Status</th>
                                            <th>Execution Status</th>
                                            <th>Verification</th>
                                            <th>Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {k8sData.recentActions && k8sData.recentActions.length > 0 ? (
                                            k8sData.recentActions.map((act) => {
                                                const isPolicyApproved = act.policy?.approved;
                                                const execStatus = act.status;
                                                const isVerified = act.verification?.passed || act.verification?.status === "SUCCESS" || act.verification?.status === "VERIFIED";
                                                const isVerificationFailed = act.verification?.status === "FAILED";
                                                const hasDetails = act.error || act.notes || act.verification?.details || act.policy?.reason;

                                                return (
                                                    <tr key={act._id}>
                                                        <td style={{ whiteSpace: "nowrap" }}>
                                                            <strong style={{ color: "var(--color-blue-primary)" }}>{act.action}</strong>
                                                        </td>
                                                        <td><code>{act.target}</code></td>
                                                        <td className="text-muted">{act.triggeredBy || "SYSTEM"}</td>
                                                        <td>
                                                            <span className={`status-pill compact-pill ${isPolicyApproved ? "success" : "danger"}`}>
                                                                {isPolicyApproved ? "APPROVED" : "REJECTED"}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <span className={`status-pill compact-pill ${execStatus === "SUCCESS" || execStatus === "SUCCEEDED" ? "success" : execStatus === "FAILED" ? "danger" : execStatus === "RUNNING" || execStatus === "PENDING" ? "running" : "neutral"}`}>
                                                                {execStatus}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <span className={`status-pill compact-pill ${isVerified ? "info" : isVerificationFailed ? "danger" : "neutral"}`}>
                                                                {isVerified ? "VERIFIED" : isVerificationFailed ? "FAILED" : "UNVERIFIED"}
                                                            </span>
                                                            {hasDetails && (
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary btn-xs"
                                                                    style={{ marginLeft: "6px" }}
                                                                    onClick={() => setSelectedAuditDetail(act)}
                                                                    title="View Details"
                                                                >
                                                                    Details
                                                                </button>
                                                            )}
                                                        </td>
                                                        <td className="text-muted" style={{ whiteSpace: "nowrap" }}>
                                                            {new Date(act.createdAt).toLocaleTimeString()}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            <tr>
                                                <td colSpan="7" className="text-muted text-center">No Kubernetes actions performed yet.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                </>
            )}

            {/* SCALE MODAL */}
            {scaleModalOpen && targetDeployment && (
                <ModalPortal isOpen={scaleModalOpen} onClose={() => !actionLoading && setScaleModalOpen(false)}>
                    <div
                        className="modal-backdrop"
                        onClick={() => !actionLoading && setScaleModalOpen(false)}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="scale-modal-title"
                    >
                        <div className="modal-content" style={{ maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div className="modal-title-wrap">
                                    <h3 id="scale-modal-title" className="modal-title">Scale {targetDeployment.name}</h3>
                                    <p className="modal-subtitle">
                                        Current replicas: <strong>{targetDeployment.ready ?? targetDeployment.desired ?? 1}</strong>
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="modal-close-btn"
                                    onClick={() => setScaleModalOpen(false)}
                                    disabled={actionLoading}
                                    aria-label="Close dialog"
                                >
                                    ✕
                                </button>
                            </div>
                            <form onSubmit={handleScaleSubmit}>
                                <div className="modal-body">
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Desired replicas:</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="10"
                                            value={desiredReplicas}
                                            onChange={(e) => setDesiredReplicas(e.target.value)}
                                            className="form-input"
                                            required
                                            disabled={actionLoading}
                                        />
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setScaleModalOpen(false)}
                                        disabled={actionLoading}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={actionLoading}
                                    >
                                        {actionLoading ? (
                                            <>
                                                <span className="btn-spinner" />
                                                Scaling...
                                            </>
                                        ) : (
                                            "Confirm Scale"
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </ModalPortal>
            )}

            {/* RESTART MODAL */}
            {restartModalOpen && targetDeployment && (
                <ModalPortal isOpen={restartModalOpen} onClose={() => !actionLoading && setRestartModalOpen(false)}>
                    <div
                        className="modal-backdrop"
                        onClick={() => !actionLoading && setRestartModalOpen(false)}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="restart-modal-title"
                    >
                        <div className="modal-content" style={{ maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div className="modal-title-wrap">
                                    <h3 id="restart-modal-title" className="modal-title">Restart {targetDeployment.name}?</h3>
                                    <p className="modal-subtitle">
                                        Namespace: <code>{targetDeployment.namespace}</code>
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="modal-close-btn"
                                    onClick={() => setRestartModalOpen(false)}
                                    disabled={actionLoading}
                                    aria-label="Close dialog"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="modal-body">
                                <p style={{ margin: 0, color: "var(--color-text-main)", fontSize: "0.88rem", lineHeight: 1.5 }}>
                                    This action will restart the deployment pods.
                                </p>
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setRestartModalOpen(false)}
                                    disabled={actionLoading}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-danger"
                                    disabled={actionLoading}
                                    onClick={handleRestartSubmit}
                                >
                                    {actionLoading ? (
                                        <>
                                            <span className="btn-spinner" />
                                            Restarting...
                                        </>
                                    ) : (
                                        "Restart"
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </ModalPortal>
            )}

            {/* AUDIT DETAIL MODAL */}
            {selectedAuditDetail && (
                <ModalPortal isOpen={Boolean(selectedAuditDetail)} onClose={() => setSelectedAuditDetail(null)}>
                    <div
                        className="modal-backdrop"
                        onClick={() => setSelectedAuditDetail(null)}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="audit-modal-title"
                    >
                        <div className="modal-content" style={{ maxWidth: "560px" }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div className="modal-title-wrap">
                                    <h3 id="audit-modal-title" className="modal-title">
                                        Audit Details: {selectedAuditDetail.action}
                                    </h3>
                                    <p className="modal-subtitle">
                                        Target: <code>{selectedAuditDetail.target}</code> • {new Date(selectedAuditDetail.createdAt).toLocaleTimeString()}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="modal-close-btn"
                                    onClick={() => setSelectedAuditDetail(null)}
                                    aria-label="Close dialog"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                    <div style={{ background: "var(--bg-card-secondary)", padding: "8px 12px", borderRadius: "6px" }}>
                                        <span style={{ display: "block", fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase" }}>Execution</span>
                                        <span style={{ fontWeight: "700", fontSize: "0.9rem" }}>{selectedAuditDetail.status}</span>
                                    </div>
                                    <div style={{ background: "var(--bg-card-secondary)", padding: "8px 12px", borderRadius: "6px" }}>
                                        <span style={{ display: "block", fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase" }}>Verification</span>
                                        <span style={{ fontWeight: "700", fontSize: "0.9rem" }}>
                                            {selectedAuditDetail.verification?.status || (selectedAuditDetail.verification?.passed ? "VERIFIED" : "UNVERIFIED")}
                                        </span>
                                    </div>
                                </div>

                                {selectedAuditDetail.error && (
                                    <div style={{
                                        padding: "10px 12px",
                                        backgroundColor: "var(--color-critical-bg)",
                                        border: "1px solid var(--border-red)",
                                        borderRadius: "6px",
                                        color: "var(--color-critical)",
                                        fontSize: "0.82rem",
                                        fontFamily: "monospace",
                                        wordBreak: "break-word"
                                    }}>
                                        <strong>Error:</strong> {selectedAuditDetail.error}
                                    </div>
                                )}

                                {selectedAuditDetail.verification?.details && (
                                    <div style={{ fontSize: "0.84rem", color: "var(--color-text-main)" }}>
                                        <strong>Verification Info:</strong> {selectedAuditDetail.verification.details}
                                    </div>
                                )}

                                {selectedAuditDetail.policy?.reason && (
                                    <div style={{ fontSize: "0.84rem", color: "var(--color-text-muted)" }}>
                                        <strong>Policy:</strong> {selectedAuditDetail.policy.reason}
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setSelectedAuditDetail(null)}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </ModalPortal>
            )}
        </div>
    );
}
