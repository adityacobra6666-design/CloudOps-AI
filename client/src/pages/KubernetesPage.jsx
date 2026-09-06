import React, { useState, useEffect } from "react";
import { getKubernetesOverview, executeKubernetesAction } from "../services/api";
import Header from "../components/Header";

export default function KubernetesPage() {
    const [k8sData, setK8sData] = useState(null);
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

    const fetchK8s = async () => {
        try {
            setLoading(true);
            setErrorMsg(null);
            const data = await getKubernetesOverview();
            setK8sData(data);
        } catch (err) {
            console.error("K8s fetch error:", err);
            setErrorMsg(err.message || "Failed to connect to Kubernetes API");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchK8s();
        const interval = setInterval(fetchK8s, 10000);
        return () => clearInterval(interval);
    }, []);

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
                reason: `Manual scaling via UI to ${desiredReplicas} replicas`
            });

            setSuccessMsg(res.message || `Successfully scaled ${targetDeployment.name} to ${desiredReplicas} replicas.`);
            setScaleModalOpen(false);
            fetchK8s();
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
                reason: `Manual rolling restart via UI`
            });

            setSuccessMsg(res.message || `Rolling restart initiated for ${targetDeployment.name}.`);
            setRestartModalOpen(false);
            fetchK8s();
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
                onRefresh={fetchK8s}
            />

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
                                            k8sData.recentActions.map((act) => (
                                                <tr key={act._id}>
                                                    <td><strong>{act.action}</strong></td>
                                                    <td><code>{act.target}</code></td>
                                                    <td>{act.triggeredBy}</td>
                                                    <td>
                                                        <span className={`status-pill ${act.policy?.approved ? "success" : "danger"}`}>
                                                            {act.policy?.approved ? "APPROVED" : "REJECTED"}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className={`status-pill ${act.status === "SUCCESS" ? "success" : act.status === "FAILED" ? "danger" : "warning"}`}>
                                                            {act.status}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {act.verification ? (
                                                            <span style={{ fontSize: "0.85rem", color: act.verification.passed || act.verification.status === "SUCCESS" ? "#0284c7" : "#dc2626" }}>
                                                                {act.verification.passed || act.verification.status === "SUCCESS" ? "✓ Verified" : "❌ Failed"} ({act.verification.metric || "Convergence"})
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted">N/A</span>
                                                        )}
                                                    </td>
                                                    <td className="text-muted">{new Date(act.createdAt).toLocaleTimeString()}</td>
                                                </tr>
                                            ))
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
                <div className="modal-backdrop">
                    <div className="modal-content ops-card">
                        <h3>⚡ Scale Deployment</h3>
                        <p>Adjust desired replicas for <strong>{targetDeployment.name}</strong> (Namespace: <code>{targetDeployment.namespace}</code>).</p>
                        <form onSubmit={handleScaleSubmit}>
                            <div className="form-group" style={{ margin: "16px 0" }}>
                                <label style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}>Desired Replicas (1 - 10):</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="10"
                                    value={desiredReplicas}
                                    onChange={(e) => setDesiredReplicas(e.target.value)}
                                    className="form-control"
                                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                                    required
                                />
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                                <button type="button" className="btn btn-secondary" onClick={() => setScaleModalOpen(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                                    {actionLoading ? "Scaling..." : "Confirm Scale"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* RESTART MODAL */}
            {restartModalOpen && targetDeployment && (
                <div className="modal-backdrop">
                    <div className="modal-content ops-card">
                        <h3>🔄 Confirm Rolling Restart</h3>
                        <p>Are you sure you want to perform a rolling restart on deployment <strong>{targetDeployment.name}</strong> in namespace <code>{targetDeployment.namespace}</code>?</p>
                        <p className="text-muted" style={{ fontSize: "0.9rem", marginTop: "8px" }}>
                            Kubernetes will gracefully cycle all running pod replicas without causing service downtime.
                        </p>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" }}>
                            <button type="button" className="btn btn-secondary" onClick={() => setRestartModalOpen(false)}>Cancel</button>
                            <button type="button" className="btn btn-danger" disabled={actionLoading} onClick={handleRestartSubmit}>
                                {actionLoading ? "Restarting..." : "Confirm Restart"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
