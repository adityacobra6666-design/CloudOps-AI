import React, { useState, useEffect, useCallback } from "react";
import Header from "../components/Header";
import { ModalPortal } from "../components/Modal";
import {
    getInfrastructureConnections,
    getInfrastructureConnectionById,
    createInfrastructureConnection,
    revokeInfrastructureConnection,
    deleteInfrastructureConnection
} from "../services/api";

export default function InfrastructureConnections() {
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(new Date().toISOString());
    const [error, setError] = useState(null);

    // Modal states
    const [showAddModal, setShowAddModal] = useState(false);
    const [activeDetailsId, setActiveDetailsId] = useState(null);
    const [detailsData, setDetailsData] = useState(null);
    const [detailsLoading, setDetailsLoading] = useState(false);

    // Add Connection Form state
    const [formData, setFormData] = useState({
        name: "",
        type: "KUBERNETES",
        environment: "production",
        description: ""
    });
    const [createdResult, setCreatedResult] = useState(null);
    const [creating, setCreating] = useState(false);
    const [copiedToken, setCopiedToken] = useState(false);
    const [installTab, setInstallTab] = useState("k8s");

    // Close modals on Escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                if (showAddModal) setShowAddModal(false);
                if (activeDetailsId) setActiveDetailsId(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [showAddModal, activeDetailsId]);

    // Fetch Connections
    const fetchConnections = useCallback(async (isManualRefresh = false) => {
        try {
            if (isManualRefresh) setRefreshing(true);
            setError(null);
            const res = await getInfrastructureConnections();
            if (res.success) {
                setConnections(res.connections || []);
                setLastUpdated(new Date().toISOString());
            }
        } catch (err) {
            setError(err.message || "Failed to load infrastructure connections");
        } finally {
            setLoading(false);
            if (isManualRefresh) {
                setTimeout(() => setRefreshing(false), 400);
            }
        }
    }, []);

    useEffect(() => {
        fetchConnections(false);
        const interval = setInterval(() => fetchConnections(false), 10000); // 10s auto-refresh
        return () => clearInterval(interval);
    }, [fetchConnections]);

    // Fetch Connection Details when modal opens
    useEffect(() => {
        if (!activeDetailsId) {
            setDetailsData(null);
            return;
        }

        let isMounted = true;
        setDetailsLoading(true);

        const loadDetails = async () => {
            try {
                const res = await getInfrastructureConnectionById(activeDetailsId);
                if (isMounted && res.success) {
                    setDetailsData(res.connection);
                }
            } catch (err) {
                console.error("Failed to load connection details:", err);
            } finally {
                if (isMounted) setDetailsLoading(false);
            }
        };

        loadDetails();
        const detailsInterval = setInterval(loadDetails, 5000);
        return () => {
            isMounted = false;
            clearInterval(detailsInterval);
        };
    }, [activeDetailsId]);

    // Handle Create Connection
    const handleCreate = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        setCreating(true);
        setError(null);

        try {
            const res = await createInfrastructureConnection(formData);
            if (res.success) {
                setCreatedResult(res);
                fetchConnections(false);
            }
        } catch (err) {
            setError(err.message || "Failed to create connection");
        } finally {
            setCreating(false);
        }
    };

    // Handle Revoke Connection
    const handleRevoke = async (id, name) => {
        if (!window.confirm(`Are you sure you want to revoke the connection for "${name}"? The agent will lose access immediately.`)) {
            return;
        }

        try {
            await revokeInfrastructureConnection(id);
            fetchConnections(false);
            if (activeDetailsId === id) {
                setActiveDetailsId(null);
            }
        } catch (err) {
            alert(`Failed to revoke connection: ${err.message}`);
        }
    };

    // Handle Delete Connection
    const handleDelete = async (id, name) => {
        if (!window.confirm(`Are you sure you want to delete "${name}"? All associated command history will be removed.`)) {
            return;
        }

        try {
            await deleteInfrastructureConnection(id);
            fetchConnections(false);
            if (activeDetailsId === id) {
                setActiveDetailsId(null);
            }
        } catch (err) {
            alert(`Failed to delete connection: ${err.message}`);
        }
    };

    // Helper for Status Badge
    const renderStatusBadge = (status) => {
        switch (status) {
            case "CONNECTED":
                return (
                    <span className="status-badge status-badge-connected">
                        <span className="status-dot" aria-hidden="true" />
                        Connected
                    </span>
                );
            case "DEGRADED":
                return (
                    <span className="status-badge status-badge-warning">
                        <span className="status-dot" aria-hidden="true" />
                        Degraded
                    </span>
                );
            case "DISCONNECTED":
                return (
                    <span className="status-badge status-badge-critical">
                        <span className="status-dot" aria-hidden="true" />
                        Disconnected
                    </span>
                );
            case "REVOKED":
                return (
                    <span className="status-badge status-badge-neutral">
                        <span className="status-dot" aria-hidden="true" />
                        Revoked
                    </span>
                );
            default:
                return (
                    <span className="status-badge status-badge-warning">
                        <span className="status-dot" aria-hidden="true" />
                        Pending
                    </span>
                );
        }
    };

    const formatRelativeTime = (dateStr) => {
        if (!dateStr) return "Never";
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 10) return "Just now";
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        return `${diffHr}h ago`;
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setCopiedToken(true);
        setTimeout(() => setCopiedToken(false), 2500);
    };

    // Calculate Summary Counts
    const totalCount = connections.length;
    const connectedCount = connections.filter(c => c.status === "CONNECTED").length;
    const pendingCount = connections.filter(c => c.status === "PENDING").length;
    const revokedCount = connections.filter(c => c.status === "REVOKED").length;

    const controlPlaneUrl = window.location.origin.includes("5173") ? "http://localhost:5000" : window.location.origin;

    return (
        <div className="page-container">
            <Header
                title="Infrastructure Connections"
                subtitle="Secure outbound-only connector agents monitoring private Kubernetes & Prometheus environments."
                lastUpdated={lastUpdated}
                onRefresh={() => fetchConnections(true)}
                refreshing={refreshing}
            />

            {/* ERROR BANNER */}
            {error && (
                <div className="error-banner">
                    <div>⚠️ <strong>Connection Error:</strong> {error}</div>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => fetchConnections(true)}>
                        Retry
                    </button>
                </div>
            )}

            {/* TOP METRICS SUMMARY */}
            <div className="metrics-grid" style={{ marginBottom: "1.75rem" }}>
                <div className="metric-tile">
                    <span className="tile-label">Connected Environments</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{totalCount}</span>
                    </div>
                    <span className="tile-meta">Single-Tenant Remote Connectors</span>
                </div>
                <div className="metric-tile">
                    <span className="tile-label">Active Agents</span>
                    <div className="tile-value-row">
                        <span className="tile-value" style={{ color: "var(--color-healthy)" }}>{connectedCount}</span>
                    </div>
                    <span className="tile-meta">Outbound HTTPS Active</span>
                </div>
                <div className="metric-tile">
                    <span className="tile-label">Pending Enrollment</span>
                    <div className="tile-value-row">
                        <span className="tile-value" style={{ color: "var(--color-sky-blue)" }}>{pendingCount}</span>
                    </div>
                    <span className="tile-meta">Awaiting Agent Startup</span>
                </div>
                <div className="metric-tile">
                    <span className="tile-label">Revoked</span>
                    <div className="tile-value-row">
                        <span className="tile-value" style={{ color: "var(--color-text-muted)" }}>{revokedCount}</span>
                    </div>
                    <span className="tile-meta">Access Tokens Invalidated</span>
                </div>
            </div>

            {/* ACTION HEADER BAR */}
            <div className="conn-action-header">
                <div>
                    <h2 style={{ fontSize: "1.15rem", fontWeight: "700", margin: 0, color: "var(--color-text-main)" }}>
                        Connected Customer Clusters
                    </h2>
                    <p style={{ fontSize: "0.82rem", color: "var(--color-text-muted)", margin: "3px 0 0" }}>
                        Private Kubernetes & telemetry agents communicate outward over TLS without inbound firewall rules.
                    </p>
                </div>
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                        setCreatedResult(null);
                        setFormData({ name: "", type: "KUBERNETES", environment: "production", description: "" });
                        setShowAddModal(true);
                    }}
                >
                    <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>+</span> Add Infrastructure
                </button>
            </div>

            {/* SKELETON LOADING STATE */}
            {loading ? (
                <div className="conn-grid">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="conn-card" style={{ gap: "1rem" }}>
                            <div className="skeleton skeleton-title" style={{ width: "50%" }} />
                            <div className="skeleton skeleton-text" style={{ width: "80%" }} />
                            <div className="skeleton skeleton-card" style={{ height: "90px" }} />
                        </div>
                    ))}
                </div>
            ) : connections.length === 0 ? (
                /* EMPTY STATE */
                <div className="empty-state">
                    <div className="empty-state-icon">🔗</div>
                    <h3 className="empty-state-title">No Connected Infrastructure Environments</h3>
                    <p className="empty-state-desc">
                        Connect your private Kubernetes clusters or Prometheus instances without opening any public ports.
                        The CloudOps Agent connects securely outbound to this control plane.
                    </p>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setShowAddModal(true)}
                    >
                        + Connect First Infrastructure
                    </button>
                </div>
            ) : (
                /* CONNECTIONS GRID */
                <div className="conn-grid">
                    {connections.map((conn) => {
                        const isRevoked = conn.status === "REVOKED";
                        return (
                            <div key={conn._id} className={`conn-card ${isRevoked ? "conn-card-revoked" : ""}`}>
                                <div>
                                    {/* TOP: Infrastructure icon, Name, Status badge */}
                                    <div className="conn-card-header">
                                        <div className="conn-title-group">
                                            <span className="conn-icon" aria-hidden="true">
                                                {conn.type === "KUBERNETES" ? "☸️" : "🔥"}
                                            </span>
                                            <div>
                                                <h3 className="conn-name">{conn.name}</h3>
                                                {/* SECONDARY: Environment • Type */}
                                                <div className="conn-sub-badge">
                                                    {conn.environment} • {conn.type}
                                                </div>
                                            </div>
                                        </div>
                                        {renderStatusBadge(conn.status)}
                                    </div>

                                    {conn.description && (
                                        <p className="conn-desc">{conn.description}</p>
                                    )}

                                    {/* MIDDLE: Last Seen, Agent ID */}
                                    <div className="conn-meta-grid">
                                        <div className="conn-meta-item">
                                            <span className="conn-meta-label">Last Seen</span>
                                            <span className="conn-meta-val">
                                                {formatRelativeTime(conn.lastSeenAt)}
                                            </span>
                                        </div>
                                        <div className="conn-meta-item">
                                            <span className="conn-meta-label">Agent ID</span>
                                            <span className="conn-meta-val conn-meta-mono">
                                                {conn.agentId || "Pending"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* BOTTOM: CPU, Memory, Pods */}
                                    <div className="conn-metrics-row">
                                        <span className="conn-metric-pill">
                                            CPU: <strong>{conn.telemetry?.metrics?.cpu != null ? `${conn.telemetry.metrics.cpu}%` : "—"}</strong>
                                        </span>
                                        <span className="conn-metric-pill">
                                            Memory: <strong>{conn.telemetry?.metrics?.memory != null ? `${conn.telemetry.metrics.memory}%` : "—"}</strong>
                                        </span>
                                        <span className="conn-metric-pill">
                                            Pods: <strong>{conn.k8sSummary?.podsCount ?? 0}</strong>
                                        </span>
                                    </div>
                                </div>

                                {/* FOOTER: Primary [View Details], Secondary [Revoke], [Delete] */}
                                <div className="conn-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setActiveDetailsId(conn._id)}
                                    >
                                        View Details
                                    </button>
                                    <div className="conn-footer-actions">
                                        {!isRevoked && (
                                            <button
                                                type="button"
                                                className="btn-subtle-danger"
                                                onClick={() => handleRevoke(conn._id, conn.name)}
                                                title="Revoke operational token"
                                            >
                                                Revoke
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="btn btn-icon"
                                            onClick={() => handleDelete(conn._id, conn.name)}
                                            title="Delete connection"
                                            aria-label={`Delete connection ${conn.name}`}
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ADD INFRASTRUCTURE MODAL */}
            {showAddModal && (
                <ModalPortal isOpen={showAddModal} onClose={() => setShowAddModal(false)}>
                    <div
                        className="modal-backdrop"
                        onClick={() => setShowAddModal(false)}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="add-modal-title"
                    >
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        {!createdResult ? (
                            <div>
                                <div className="modal-header">
                                    <div className="modal-title-wrap">
                                        <h3 id="add-modal-title" className="modal-title">Connect New Infrastructure</h3>
                                        <p className="modal-subtitle">
                                            Step 1 of 2: Configure environment details and generate enrollment token
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        className="modal-close-btn"
                                        onClick={() => setShowAddModal(false)}
                                        aria-label="Close dialog"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <form onSubmit={handleCreate}>
                                    <div className="modal-body">
                                        <div className="form-group">
                                            <label className="form-label">
                                                Connection / Cluster Name *
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                placeholder="e.g. Production US-East Cluster"
                                                className="form-input"
                                                value={formData.name}
                                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            />
                                        </div>

                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                                            <div className="form-group">
                                                <label className="form-label">Infrastructure Type</label>
                                                <select
                                                    className="form-select"
                                                    value={formData.type}
                                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                                >
                                                    <option value="KUBERNETES">Kubernetes Cluster</option>
                                                    <option value="PROMETHEUS">Prometheus Standalone</option>
                                                    <option value="DOCKER">Docker Host</option>
                                                    <option value="LINUX">Linux Host</option>
                                                </select>
                                            </div>

                                            <div className="form-group">
                                                <label className="form-label">Environment Stage</label>
                                                <select
                                                    className="form-select"
                                                    value={formData.environment}
                                                    onChange={(e) => setFormData({ ...formData, environment: e.target.value })}
                                                >
                                                    <option value="production">Production</option>
                                                    <option value="staging">Staging</option>
                                                    <option value="development">Development</option>
                                                    <option value="dr">Disaster Recovery</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Description (Optional)</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Primary microservices cluster on internal VPC"
                                                className="form-input"
                                                value={formData.description}
                                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            />
                                        </div>

                                        <div style={{
                                            padding: "0.85rem 1rem",
                                            backgroundColor: "var(--color-blue-light)",
                                            border: "1px solid var(--border-blue)",
                                            borderRadius: "8px",
                                            fontSize: "0.82rem",
                                            color: "var(--color-blue-primary)",
                                            lineHeight: 1.45
                                        }}>
                                            🔒 <strong>Outbound-Only HTTPS:</strong> Your private cluster or Prometheus does NOT need to be exposed to the public internet. The agent initiates all connections outward.
                                        </div>
                                    </div>

                                    <div className="modal-footer">
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => setShowAddModal(false)}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            className="btn btn-primary"
                                            disabled={creating}
                                        >
                                            {creating ? (
                                                <>
                                                    <span className="btn-spinner" />
                                                    Generating...
                                                </>
                                            ) : (
                                                "Generate Connection & Token 🚀"
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ) : (
                            <div>
                                <div className="modal-header">
                                    <div className="modal-title-wrap">
                                        <h3 className="modal-title" style={{ color: "var(--color-healthy)" }}>
                                            ✅ Connection Created: {createdResult.connection.name}
                                        </h3>
                                        <p className="modal-subtitle">
                                            Step 2 of 2: Deploy CloudOps Agent using the one-time enrollment token
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        className="modal-close-btn"
                                        onClick={() => setShowAddModal(false)}
                                        aria-label="Close dialog"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div className="modal-body">
                                    <div style={{
                                        padding: "0.85rem 1rem",
                                        backgroundColor: "var(--color-warning-bg)",
                                        border: "1px solid var(--color-warning-border)",
                                        borderRadius: "8px",
                                        color: "var(--color-warning)",
                                        fontSize: "0.82rem",
                                        marginBottom: "1rem"
                                    }}>
                                        ⚠️ <strong>IMPORTANT:</strong> Store this one-time enrollment token securely. It will <strong>NOT</strong> be displayed again once you close this window.
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">One-Time Enrollment Token</label>
                                        <div style={{ display: "flex", gap: "8px" }}>
                                            <input
                                                type="text"
                                                readOnly
                                                className="form-input"
                                                style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "var(--color-sky-blue)" }}
                                                value={createdResult.enrollmentToken}
                                            />
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                style={{ minWidth: "90px" }}
                                                onClick={() => handleCopy(createdResult.enrollmentToken)}
                                            >
                                                {copiedToken ? "Copied! ✓" : "Copy"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* INSTALLATION TABS */}
                                    <div style={{ marginBottom: "1rem" }}>
                                        <div style={{ display: "flex", gap: "6px", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px", marginBottom: "10px" }}>
                                            <button
                                                type="button"
                                                className={`btn btn-sm ${installTab === "k8s" ? "btn-primary" : "btn-ghost"}`}
                                                onClick={() => setInstallTab("k8s")}
                                            >
                                                ☸️ Kubernetes
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn btn-sm ${installTab === "docker" ? "btn-primary" : "btn-ghost"}`}
                                                onClick={() => setInstallTab("docker")}
                                            >
                                                🐳 Docker
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn btn-sm ${installTab === "cli" ? "btn-primary" : "btn-ghost"}`}
                                                onClick={() => setInstallTab("cli")}
                                            >
                                                💻 Local / CLI
                                            </button>
                                        </div>

                                        {installTab === "k8s" && (
                                            <div className="code-box-container">
                                                <div className="code-box-header">
                                                    <span>1. Create the Secret with your token:</span>
                                                    <button
                                                        type="button"
                                                        className="code-box-copy-btn"
                                                        onClick={() => handleCopy(`kubectl create namespace cloudops-agent\nkubectl create secret generic cloudops-agent-secret --namespace=cloudops-agent --from-literal=ENROLLMENT_TOKEN="${createdResult.enrollmentToken}"`)}
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                                <pre style={{ margin: "0 0 10px 0", color: "#38bdf8" }}>
{`kubectl create namespace cloudops-agent
kubectl create secret generic cloudops-agent-secret \\
  --namespace=cloudops-agent \\
  --from-literal=ENROLLMENT_TOKEN="${createdResult.enrollmentToken}"`}
                                                </pre>
                                                <div className="code-box-header">
                                                    <span>2. Apply RBAC and deployment manifests:</span>
                                                    <button
                                                        type="button"
                                                        className="code-box-copy-btn"
                                                        onClick={() => handleCopy(`kubectl apply -f agent/k8s/serviceaccount.yaml\nkubectl apply -f agent/k8s/role.yaml\nkubectl apply -f agent/k8s/rolebinding.yaml\nkubectl apply -f agent/k8s/deployment.yaml`)}
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                                <pre style={{ margin: 0, color: "#38bdf8" }}>
{`kubectl apply -f agent/k8s/serviceaccount.yaml
kubectl apply -f agent/k8s/role.yaml
kubectl apply -f agent/k8s/rolebinding.yaml
kubectl apply -f agent/k8s/deployment.yaml`}
                                                </pre>
                                            </div>
                                        )}

                                        {installTab === "docker" && (
                                            <div className="code-box-container">
                                                <div className="code-box-header">
                                                    <span>Run the agent container on your host:</span>
                                                    <button
                                                        type="button"
                                                        className="code-box-copy-btn"
                                                        onClick={() => handleCopy(`docker run -d --name cloudops-agent -e CLOUDOPS_URL="${controlPlaneUrl}" -e ENROLLMENT_TOKEN="${createdResult.enrollmentToken}" -e AGENT_NAME="${createdResult.connection.name}" -v ~/.kube:/root/.kube:ro cloudops-agent:latest`)}
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                                <pre style={{ margin: 0, color: "#38bdf8" }}>
{`docker run -d \\
  --name cloudops-agent \\
  -e CLOUDOPS_URL="${controlPlaneUrl}" \\
  -e ENROLLMENT_TOKEN="${createdResult.enrollmentToken}" \\
  -e AGENT_NAME="${createdResult.connection.name}" \\
  -v ~/.kube:/root/.kube:ro \\
  cloudops-agent:latest`}
                                                </pre>
                                            </div>
                                        )}

                                        {installTab === "cli" && (
                                            <div className="code-box-container">
                                                <div className="code-box-header">
                                                    <span>Run the standalone Node.js agent:</span>
                                                    <button
                                                        type="button"
                                                        className="code-box-copy-btn"
                                                        onClick={() => handleCopy(`cd agent\nENROLLMENT_TOKEN="${createdResult.enrollmentToken}" CLOUDOPS_URL="${controlPlaneUrl}" npm start`)}
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                                <pre style={{ margin: 0, color: "#38bdf8" }}>
{`cd agent
ENROLLMENT_TOKEN="${createdResult.enrollmentToken}" \\
CLOUDOPS_URL="${controlPlaneUrl}" \\
npm start`}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => setShowAddModal(false)}
                                    >
                                        Done & View Dashboard
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </ModalPortal>
        )}

            {/* DETAILS MODAL */}
            {activeDetailsId && (
                <ModalPortal isOpen={Boolean(activeDetailsId)} onClose={() => setActiveDetailsId(null)}>
                    <div
                        className="modal-backdrop"
                        onClick={() => setActiveDetailsId(null)}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="details-modal-title"
                    >
                        <div
                            className="modal-content"
                            style={{ maxWidth: "780px" }}
                            onClick={(e) => e.stopPropagation()}
                        >
                        {detailsLoading || !detailsData ? (
                            <div className="modal-body" style={{ textAlign: "center", padding: "3rem" }}>
                                <div className="btn-spinner" style={{ width: "32px", height: "32px", margin: "0 auto 12px" }} />
                                <div style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>
                                    Loading connection telemetry and cluster state...
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div className="modal-header">
                                    <div className="modal-title-wrap">
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                            <h3 id="details-modal-title" className="modal-title">{detailsData.name}</h3>
                                            {renderStatusBadge(detailsData.status)}
                                        </div>
                                        <p className="modal-subtitle">
                                            Agent ID: <span style={{ fontFamily: "monospace", color: "var(--color-blue-primary)" }}>{detailsData.agentId}</span> • Registered {detailsData.registeredAt ? new Date(detailsData.registeredAt).toLocaleDateString() : "Pending"}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        className="modal-close-btn"
                                        onClick={() => setActiveDetailsId(null)}
                                        aria-label="Close details dialog"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div className="modal-body">
                                    {/* TELEMETRY TILES */}
                                    <h4 style={{ fontSize: "0.92rem", fontWeight: "700", color: "var(--color-text-main)", margin: "0 0 0.8rem 0" }}>
                                        📊 Live Telemetry (Reported by Agent)
                                    </h4>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "1.5rem" }}>
                                        <div className="conn-meta-item" style={{ background: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">CPU Usage</span>
                                            <span style={{ fontSize: "1.15rem", fontWeight: "bold", color: "var(--color-text-main)" }}>
                                                {detailsData.telemetry?.metrics?.cpu ?? 0}%
                                            </span>
                                        </div>
                                        <div className="conn-meta-item" style={{ background: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">Memory</span>
                                            <span style={{ fontSize: "1.15rem", fontWeight: "bold", color: "var(--color-text-main)" }}>
                                                {detailsData.telemetry?.metrics?.memory ?? 0}%
                                            </span>
                                        </div>
                                        <div className="conn-meta-item" style={{ background: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">Request Rate</span>
                                            <span style={{ fontSize: "1.15rem", fontWeight: "bold", color: "var(--color-text-main)" }}>
                                                {detailsData.telemetry?.metrics?.requestRate ?? 0} req/s
                                            </span>
                                        </div>
                                        <div className="conn-meta-item" style={{ background: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">P95 Latency</span>
                                            <span style={{ fontSize: "1.15rem", fontWeight: "bold", color: "var(--color-text-main)" }}>
                                                {detailsData.telemetry?.metrics?.p95Latency ?? 0} ms
                                            </span>
                                        </div>
                                    </div>

                                    {/* K8S TOPOLOGY SUMMARY */}
                                    <h4 style={{ fontSize: "0.92rem", fontWeight: "700", color: "var(--color-text-main)", margin: "0 0 0.8rem 0" }}>
                                        ☸️ Cluster Resources (Private Kubernetes via Agent)
                                    </h4>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "1.5rem" }}>
                                        <div style={{ backgroundColor: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">Nodes</span>
                                            <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--color-text-main)", display: "block", marginTop: "2px" }}>
                                                {detailsData.k8sSummary?.nodesCount || 0}
                                            </span>
                                        </div>
                                        <div style={{ backgroundColor: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">Pods</span>
                                            <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--color-text-main)", display: "block", marginTop: "2px" }}>
                                                {detailsData.k8sSummary?.podsCount || 0}
                                            </span>
                                        </div>
                                        <div style={{ backgroundColor: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">Deployments</span>
                                            <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--color-text-main)", display: "block", marginTop: "2px" }}>
                                                {detailsData.k8sSummary?.deploymentsCount || 0}
                                            </span>
                                        </div>
                                        <div style={{ backgroundColor: "var(--bg-card-secondary)", padding: "10px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                            <span className="conn-meta-label">Services</span>
                                            <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--color-text-main)", display: "block", marginTop: "2px" }}>
                                                {detailsData.k8sSummary?.servicesCount || 0}
                                            </span>
                                        </div>
                                    </div>

                                    {/* COMMAND HISTORY */}
                                    <h4 style={{ fontSize: "0.92rem", fontWeight: "700", color: "var(--color-text-main)", margin: "0 0 0.8rem 0" }}>
                                        ⚡ Remediation Command History
                                    </h4>
                                    {!detailsData.recentCommands || detailsData.recentCommands.length === 0 ? (
                                        <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", fontStyle: "italic", margin: "0 0 1rem 0" }}>
                                            No remediation commands executed on this environment yet.
                                        </p>
                                    ) : (
                                        <div style={{ overflowX: "auto", border: "1px solid var(--border-color)", borderRadius: "8px", marginBottom: "1rem" }}>
                                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                                                <thead>
                                                    <tr style={{ backgroundColor: "var(--table-header-bg)", borderBottom: "1px solid var(--border-color)", textAlign: "left", color: "var(--color-text-muted)" }}>
                                                        <th style={{ padding: "8px 12px" }}>Action</th>
                                                        <th style={{ padding: "8px 12px" }}>Target</th>
                                                        <th style={{ padding: "8px 12px" }}>Status</th>
                                                        <th style={{ padding: "8px 12px" }}>Executed</th>
                                                        <th style={{ padding: "8px 12px" }}>Verification</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {detailsData.recentCommands.map((cmd) => (
                                                        <tr key={cmd._id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                                            <td style={{ padding: "8px 12px", fontWeight: "600", color: "var(--color-blue-primary)" }}>{cmd.action}</td>
                                                            <td style={{ padding: "8px 12px", color: "var(--color-text-main)" }}>{cmd.target?.name || "deployment"}</td>
                                                            <td style={{ padding: "8px 12px" }}>
                                                                <span style={{
                                                                    color: cmd.status === "SUCCEEDED" ? "var(--color-healthy)" : cmd.status === "FAILED" ? "var(--color-critical)" : "var(--color-warning)",
                                                                    fontWeight: "700"
                                                                }}>
                                                                    {cmd.status}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{formatRelativeTime(cmd.completedAt || cmd.createdAt)}</td>
                                                            <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{cmd.verification?.status || cmd.result?.message || "N/A"}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                <div className="modal-footer" style={{ justifyContent: "space-between" }}>
                                    {detailsData.status !== "REVOKED" ? (
                                        <button
                                            type="button"
                                            className="btn-subtle-danger"
                                            onClick={() => handleRevoke(detailsData._id, detailsData.name)}
                                        >
                                            Revoke Connection
                                        </button>
                                    ) : (
                                        <span style={{ fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                                            This connection has been revoked.
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setActiveDetailsId(null)}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </ModalPortal>
        )}
        </div>
    );
}
