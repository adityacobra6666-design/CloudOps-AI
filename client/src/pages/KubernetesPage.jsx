import { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { getKubernetesOverview, executeKubernetesAction, getInfrastructureConnections } from "../services/api";
import Header from "../components/Header";
import { ModalPortal } from "../components/Modal";

export default function KubernetesPage() {
    const outletCtx = useOutletContext();
    let user = outletCtx?.user;
    if (!user) {
        try {
            const stored = localStorage.getItem("user");
            if (stored) user = JSON.parse(stored);
        } catch {
            user = null;
        }
    }
    const isAuthorized = user?.role === "ENGINEER" || user?.role === "ADMIN";

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
    const [desiredReplicas, setDesiredReplicas] = useState(2);

    // Modal state for restart confirmation
    const [restartModalOpen, setRestartModalOpen] = useState(false);

    // Audit detail modal
    const [selectedAuditDetail, setSelectedAuditDetail] = useState(null);

    // Load available connections and select connected agent
    useEffect(() => {
        let isMounted = true;
        const loadConnections = async () => {
            try {
                const res = await getInfrastructureConnections();
                if (res.success && isMounted) {
                    const connections = res.connections || [];
                    setAvailableConnections(connections);
                    const connected = connections.find(c => c.status === "CONNECTED");
                    if (connected) {
                        setSelectedEnvironment(current => (current === "local" || !connections.some(c => c._id === current)) ? connected._id : current);
                    } else if (connections.length > 0) {
                        setSelectedEnvironment(current => (current === "local" || !connections.some(c => c._id === current)) ? connections[0]._id : current);
                    }
                }
            } catch (e) {
                console.warn("Failed to load connections:", e?.message);
            }
        };
        loadConnections();
        return () => { isMounted = false; };
    }, []);

    const [retrying, setRetrying] = useState(false);

    const fetchK8s = useCallback(async (connId = selectedEnvironment, showLoading = true, forceRefresh = false) => {
        try {
            if (showLoading) setLoading(true);
            setErrorMsg(null);
            const queryConnId = connId || selectedEnvironment || "local";
            const data = await getKubernetesOverview(undefined, queryConnId, forceRefresh);
            setK8sData(data);
            return data;
        } catch (err) {
            console.error("K8s fetch error:", err);
            setErrorMsg(err.message || "Failed to connect to Kubernetes API");
            return null;
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [selectedEnvironment]);

    const handleRetry = async () => {
        try {
            setRetrying(true);
            setErrorMsg(null);
            setSuccessMsg(null);
            const queryConnId = selectedEnvironment || "local";
            const data = await fetchK8s(queryConnId, false, true);
            if (data?.clusterReachable) {
                setSuccessMsg("Cluster query succeeded! Live Kubernetes telemetry refreshed.");
            } else if (data?.statusMessage) {
                setErrorMsg(`Diagnostic check: ${data.statusMessage}`);
            }
        } catch (err) {
            setErrorMsg(err?.message || "Failed to retry cluster connection.");
        } finally {
            setRetrying(false);
        }
    };

    useEffect(() => {
        let isMounted = true;
        const queryConnId = selectedEnvironment || "local";
        getKubernetesOverview(undefined, queryConnId)
            .then(data => {
                if (isMounted) {
                    setK8sData(data);
                    setLoading(false);
                }
            })
            .catch(err => {
                if (isMounted) {
                    setErrorMsg(err.message || "Failed to connect to Kubernetes API");
                    setLoading(false);
                }
            });

        const interval = setInterval(() => {
            fetchK8s(selectedEnvironment, false, false);
        }, 10000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [fetchK8s, selectedEnvironment]);

    // Active connection state helper
    const currentConnection = availableConnections.find(c => c._id === selectedEnvironment);
    const isAgentTarget = Boolean(currentConnection || (selectedEnvironment && selectedEnvironment !== "local"));
    const isAgentConnected = isAgentTarget
        ? (k8sData?.agentConnected ?? (currentConnection?.status === "CONNECTED"))
        : Boolean(k8sData?.agentConnected);
    const isClusterReachable = Boolean(k8sData?.clusterReachable || (k8sData?.connected && k8sData?.mode !== "docker_fallback"));
    const isConnectionAvailable = isClusterReachable;

    const isChecking = loading && !k8sData;
    const isClusterUnavailable = isAgentTarget && isAgentConnected && !isClusterReachable;
    const isAgentDisconnected = isAgentTarget && !isAgentConnected;
    const isDockerFallback = !isAgentTarget && !isClusterReachable;

    const getEffectiveConnectionId = () => {
        if (selectedEnvironment && selectedEnvironment !== "local") {
            return selectedEnvironment;
        }
        const connected = availableConnections.find(c => c.status === "CONNECTED") || availableConnections[0];
        if (connected?._id) return connected._id;
        return undefined;
    };

    const handleScaleSubmit = async (e) => {
        e.preventDefault();
        if (!targetDeployment) return;

        try {
            setActionLoading(true);
            setErrorMsg(null);
            setSuccessMsg(null);

            const effectiveConnectionId = getEffectiveConnectionId();
            const targetName = targetDeployment.name?.trim();
            const targetNamespace = (targetDeployment.namespace || k8sData?.namespace || "cloudops").trim();
            const numReplicas = parseInt(desiredReplicas, 10);

            if (isNaN(numReplicas) || numReplicas < 1 || numReplicas > 10) {
                setErrorMsg(`Desired replicas must be an integer between 1 and 10.`);
                setActionLoading(false);
                return;
            }

            const payload = {
                action: "SCALE_SERVICE",
                target: targetName,
                namespace: targetNamespace,
                replicas: numReplicas,
                reason: `Manual scaling via UI to ${numReplicas} replicas`
            };

            if (effectiveConnectionId) {
                payload.connectionId = effectiveConnectionId;
            }

            const res = await executeKubernetesAction(payload);

            if (res.success) {
                setSuccessMsg(res.message || `Successfully scaled ${targetName} to ${numReplicas} replicas.`);
                setScaleModalOpen(false);
                fetchK8s(effectiveConnectionId || selectedEnvironment);
            } else {
                setErrorMsg(res.message || "Scale action failed or was rejected.");
            }
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

            const effectiveConnectionId = getEffectiveConnectionId();
            const targetName = targetDeployment.name?.trim();
            const targetNamespace = (targetDeployment.namespace || k8sData?.namespace || "cloudops").trim();

            const payload = {
                action: "RESTART_SERVICE",
                target: targetName,
                namespace: targetNamespace,
                reason: `Manual rolling restart via UI`
            };

            if (effectiveConnectionId) {
                payload.connectionId = effectiveConnectionId;
            }

            const res = await executeKubernetesAction(payload);

            if (res.success) {
                setSuccessMsg(res.message || `Rolling restart initiated for ${targetName}.`);
                setRestartModalOpen(false);
                fetchK8s(effectiveConnectionId || selectedEnvironment);
            } else {
                setErrorMsg(res.message || "Restart action failed or was rejected.");
            }
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
                        {availableConnections.length === 0 && (
                            <option value="local">💻 Direct Local Host (Docker Fallback)</option>
                        )}
                        {availableConnections.map((c) => {
                            let stateLabel = "Checking...";
                            if (c.status === "REVOKED") {
                                stateLabel = "Revoked";
                            } else if (c.status !== "CONNECTED") {
                                stateLabel = "Agent Disconnected";
                            } else if (c.k8sSummary?.clusterConnected !== false && !c.k8sSummary?.k8sError && c.k8sSummary?.updatedAt) {
                                stateLabel = "Cluster Reachable";
                            } else if (c.k8sSummary?.k8sError) {
                                stateLabel = "Agent Connected, Cluster Unavailable";
                            } else if (!c.k8sSummary?.updatedAt) {
                                stateLabel = "Checking Connection";
                            } else {
                                stateLabel = "Agent Connected";
                            }
                            return (
                                <option key={c._id} value={c._id}>
                                    🌐 {c.name} ({stateLabel})
                                </option>
                            );
                        })}
                        {availableConnections.length > 0 && (
                            <option value="local">💻 Direct Local Host (Docker Mode)</option>
                        )}
                    </select>
                </div>
                <div className="k8s-status-badges">
                    {isAgentTarget ? (
                        <>
                            <span className={`k8s-badge ${isAgentConnected ? "connected" : "disconnected"}`}>
                                {isAgentConnected ? "● Agent Connected" : "○ Agent Disconnected"}
                            </span>
                            <span className={`k8s-badge ${isClusterReachable ? "connected" : "disconnected"}`}>
                                {isClusterReachable ? "● Cluster Reachable" : "○ Cluster Unavailable"}
                            </span>
                        </>
                    ) : (
                        <span className={`k8s-badge ${isClusterReachable ? "connected" : "docker"}`}>
                            {isClusterReachable ? "● Local Cluster Reachable" : "🐳 Docker Host Mode"}
                        </span>
                    )}
                </div>
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

            {k8sData?.dataStatus === "STALE" && (
                <div className="alert-banner warning" style={{ backgroundColor: "rgba(245, 158, 11, 0.15)", border: "1px solid rgba(245, 158, 11, 0.4)", color: "#D97706", marginBottom: "1rem", padding: "0.75rem 1rem", borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>⚠️ <strong>Connected but telemetry stale:</strong> {k8sData.statusMessage || "The remote agent heartbeat is older than 60 seconds. Displayed resource counts may be outdated."}</span>
                </div>
            )}

            {isChecking ? (
                <div className="empty-state">
                    <span className="btn-spinner" style={{ width: "22px", height: "22px", display: "inline-block", marginRight: "10px" }} />
                    Checking cluster connection...
                </div>
            ) : isClusterUnavailable ? (
                /* AGENT CONNECTED, CLUSTER UNAVAILABLE STATE */
                <section className="dashboard-section">
                    <div className="ops-card k8s-unconfigured-card" style={{ borderColor: "rgba(239, 68, 68, 0.4)" }}>
                        <div className="k8s-icon-header">
                            <span className="big-k8s-icon">☸️</span>
                            <div className="k8s-status-badges" style={{ justifyContent: "center", marginBottom: "0.75rem" }}>
                                <span className="k8s-badge connected">
                                    ● Agent Connected ({currentConnection?.name || "Local Agent"})
                                </span>
                                <span className="k8s-badge disconnected">
                                    ○ Cluster API Unreachable
                                </span>
                            </div>
                            <h2>Kubernetes Cluster API Unavailable</h2>
                            <p className="k8s-sub">
                                The authenticated agent outbound channel is active, but the agent cannot reach your Kubernetes cluster API server.
                            </p>
                        </div>

                        <div className="k8s-diagnostic-box">
                            <span className="k8s-diagnostic-label">Diagnostic Error Details:</span>
                            <code>{k8sData?.statusMessage || "Cluster API unreachable (connection refused or network timeout)"}</code>
                        </div>

                        <div className="k8s-features-grid" style={{ maxWidth: "780px", margin: "0 auto 2rem auto" }}>
                            <div className="feature-tile">
                                <span className="feat-title">1. Verify Cluster State</span>
                                <p>If using Minikube or Kind locally, verify the cluster is active: run <code>minikube status</code> or <code>minikube start</code>.</p>
                            </div>
                            <div className="feature-tile">
                                <span className="feat-title">2. Test Kubeconfig</span>
                                <p>On your agent host, run <code>kubectl get nodes</code> to verify the kubeconfig server endpoint is valid.</p>
                            </div>
                            <div className="feature-tile">
                                <span className="feat-title">3. Secure Channel</span>
                                <p>All queries route securely through the existing authenticated outbound agent channel. No inbound ports required.</p>
                            </div>
                        </div>

                        <div className="k8s-action-row">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleRetry}
                                disabled={retrying}
                                style={{ padding: "0.6rem 1.4rem", fontSize: "0.95rem" }}
                            >
                                {retrying ? (
                                    <>
                                        <span className="btn-spinner" />
                                        Retrying Connection...
                                    </>
                                ) : (
                                    "🔄 Retry Connection"
                                )}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => fetchK8s(selectedEnvironment, true, false)}
                                disabled={retrying}
                            >
                                Refresh Status
                            </button>
                        </div>
                    </div>
                </section>
            ) : isAgentDisconnected ? (
                /* AGENT DISCONNECTED STATE */
                <section className="dashboard-section">
                    <div className="ops-card k8s-unconfigured-card" style={{ borderColor: "rgba(239, 68, 68, 0.4)" }}>
                        <div className="k8s-icon-header">
                            <span className="big-k8s-icon">📡</span>
                            <div className="k8s-status-badges" style={{ justifyContent: "center", marginBottom: "0.75rem" }}>
                                <span className="k8s-badge disconnected">
                                    ○ Agent Disconnected
                                </span>
                                <span className="k8s-badge disconnected">
                                    ○ Cluster Unavailable
                                </span>
                            </div>
                            <h2>Infrastructure Agent Disconnected</h2>
                            <p className="k8s-sub">
                                The agent <strong>"{currentConnection?.name || selectedEnvironment}"</strong> has not sent a heartbeat within the last 60 seconds.
                            </p>
                        </div>

                        <div className="k8s-diagnostic-box">
                            <span className="k8s-diagnostic-label">Agent Status:</span>
                            <code>{k8sData?.statusMessage || "Agent heartbeat timeout (> 60s without telemetry ping)"}</code>
                        </div>

                        <div className="k8s-action-row">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleRetry}
                                disabled={retrying}
                            >
                                {retrying ? (
                                    <>
                                        <span className="btn-spinner" />
                                        Checking Agent...
                                    </>
                                ) : (
                                    "🔄 Retry Connection"
                                )}
                            </button>
                        </div>
                    </div>
                </section>
            ) : isDockerFallback ? (
                /* STANDALONE DOCKER MODE CARD */
                <section className="dashboard-section">
                    <div className="ops-card k8s-unconfigured-card">
                        <div className="k8s-icon-header">
                            <span className="big-k8s-icon">🐳</span>
                            <div className="k8s-status-badges" style={{ justifyContent: "center", marginBottom: "0.75rem" }}>
                                <span className="k8s-badge docker">
                                    🐳 Operating in Standalone Docker Mode
                                </span>
                            </div>
                            <h2>Standalone Docker Host Mode</h2>
                            <p className="k8s-sub">
                                No connected Kubernetes agent or local cluster configuration found. The system is operating in standard Docker container management mode.
                            </p>
                        </div>

                        <div className="k8s-features-grid" style={{ maxWidth: "780px", margin: "0 auto 2rem auto" }}>
                            <div className="feature-tile">
                                <span className="feat-title">🔌 Connect Kubernetes</span>
                                <p>Start your local Minikube or Kind cluster, then launch the CloudOps agent locally to bridge telemetry.</p>
                            </div>
                            <div className="feature-tile">
                                <span className="feat-title">📡 Outbound Telemetry</span>
                                <p>The agent establishes an outbound HTTPS polling channel to Render. No public ports or DNS required.</p>
                            </div>
                            <div className="feature-tile">
                                <span className="feat-title">🛡️ Policy Enforcement</span>
                                <p>Read-only cluster queries and safe deployment scaling (1-10 replicas) are cryptographically validated.</p>
                            </div>
                        </div>

                        <div className="k8s-config-notice">
                            <code>Current Mode: STANDALONE_DOCKER (Kubernetes Not Configured)</code>
                        </div>

                        <div className="k8s-action-row">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleRetry}
                                disabled={retrying}
                            >
                                {retrying ? (
                                    <>
                                        <span className="btn-spinner" />
                                        Detecting Cluster...
                                    </>
                                ) : (
                                    "🔄 Detect Cluster / Retry"
                                )}
                            </button>
                        </div>
                    </div>
                </section>
            ) : (
                /* LIVE KUBERNETES DASHBOARD */
                <>
                    {/* Control Row with Refresh Button */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span className="k8s-badge connected" style={{ padding: "4px 10px", fontSize: "0.82rem" }}>
                                ● Live Kubernetes Cluster
                            </span>
                            <span className="text-muted" style={{ fontSize: "0.85rem" }}>
                                Namespace: <strong>{k8sData?.namespace || "cloudops"}</strong>
                            </span>
                        </div>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={handleRetry}
                            disabled={retrying}
                        >
                            {retrying ? (
                                <>
                                    <span className="btn-spinner" />
                                    Refreshing...
                                </>
                            ) : (
                                "🔄 Refresh Telemetry"
                            )}
                        </button>
                    </div>
                    {/* Cluster Summary Metrics */}
                    <div className="metrics-grid">
                        <div className="metric-tile">
                            <span className="tile-label">Cluster Connection</span>
                            <div className="tile-value-row">
                                <span className="tile-value" style={{ fontSize: "1.1rem" }}>{typeof k8sData.cluster === "string" ? k8sData.cluster : (k8sData.cluster?.server || k8sData.cluster?.context || k8sData.cluster?.source || "Connected cluster")}</span>
                            </div>
                            {k8sData.dataStatus === "CONNECTED" ? (
                                <span className="tile-status healthy">● Connected and data fresh</span>
                            ) : k8sData.dataStatus === "STALE" ? (
                                <span className="tile-status warning" style={{ color: "var(--color-warning, #D97706)" }}>⚠️ Connected but telemetry stale</span>
                            ) : k8sData.dataStatus === "KUBERNETES_ERROR" ? (
                                <span className="tile-status danger" style={{ color: "var(--color-danger, #DC2626)" }}>❌ Kubernetes query failed</span>
                            ) : k8sData.dataStatus === "NO_RESOURCES" ? (
                                <span className="tile-status info" style={{ color: "var(--color-info, #2563EB)" }}>ℹ️ No resources genuinely found</span>
                            ) : (
                                <span className={`tile-status ${k8sData.connected ? "healthy" : "danger"}`}>{k8sData.statusMessage || (k8sData.connected ? "● Connected" : "○ Disconnected")}</span>
                            )}
                        </div>
                        <div className="metric-tile">
                            <span className="tile-label">Nodes</span>
                            <div className="tile-value-row">
                                <span className="tile-value">
                                    {k8sData.summary?.nodesReady ?? k8sData.nodes?.filter(n => n.status === "Ready").length ?? 0} / {k8sData.summary?.nodesTotal ?? k8sData.counts?.nodes ?? k8sData.nodes?.length ?? 0}
                                </span>
                            </div>
                            <span className="tile-status healthy">Ready</span>
                        </div>
                        <div className="metric-tile">
                            <span className="tile-label">Pods</span>
                            <div className="tile-value-row">
                                <span className="tile-value">
                                    {k8sData.summary?.podsRunning ?? k8sData.pods?.filter(p => p.status === "Running").length ?? 0} / {k8sData.summary?.podsTotal ?? k8sData.counts?.pods ?? k8sData.pods?.length ?? 0}
                                </span>
                            </div>
                            <span className="tile-status healthy">Running</span>
                        </div>
                        <div className="metric-tile">
                            <span className="tile-label">Deployments</span>
                            <div className="tile-value-row">
                                <span className="tile-value">
                                    {k8sData.summary?.deploymentsHealthy ?? k8sData.deployments?.filter(d => (d.readyReplicas ?? d.ready ?? 0) >= (d.replicas ?? d.desired ?? 0)).length ?? 0} / {k8sData.summary?.deploymentsTotal ?? k8sData.counts?.deployments ?? k8sData.deployments?.length ?? 0}
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
                                <span className="text-muted">Namespace: {k8sData.namespace || "cloudops"}</span>
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
                                                <td colSpan="6" className="text-muted text-center">
                                                    {k8sData.dataStatus === "KUBERNETES_ERROR"
                                                        ? `Kubernetes query failed: ${k8sData.statusMessage || "Cluster unreachable"}`
                                                        : k8sData.dataStatus === "STALE"
                                                            ? "Agent telemetry stale: No recent node updates received."
                                                            : "No nodes reported."}
                                                </td>
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
                                                <tr key={`${dep.namespace || "cloudops"}-${dep.name}`}>
                                                    <td className="font-semibold">{dep.name}</td>
                                                    <td><code>{dep.namespace || k8sData.namespace || "cloudops"}</code></td>
                                                    <td><strong>{dep.ready ?? dep.readyReplicas ?? 0}</strong> / {dep.desired ?? dep.replicas ?? 0}</td>
                                                    <td>{dep.available ?? dep.availableReplicas ?? 0}</td>
                                                    <td>
                                                        <span className={`status-pill ${(dep.status === "HEALTHY" || ((dep.readyReplicas ?? dep.ready ?? 0) >= (dep.replicas ?? dep.desired ?? 0))) ? "success" : "warning"}`}>
                                                            {dep.status || ((dep.readyReplicas ?? dep.ready ?? 0) >= (dep.replicas ?? dep.desired ?? 0) ? "HEALTHY" : "DEGRADED")}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {(() => {
                                                            const isStateful = dep.name === "cloudops-mongodb" || dep.name?.includes("mongo") || dep.name?.includes("db");
                                                            const scaleDisabled = actionLoading || !isAuthorized || !isConnectionAvailable || isStateful;
                                                            const scaleTitle = !isAuthorized
                                                                ? "Remediation execution requires ENGINEER or ADMIN role"
                                                                : (!isConnectionAvailable
                                                                    ? "Cluster connection unavailable"
                                                                    : (isStateful
                                                                        ? "Scaling is disabled for stateful database singleton. Use Restart Service for recovery."
                                                                        : "Scale this deployment"));

                                                            return (
                                                                <div className="action-button-group" style={{ display: "flex", gap: "6px" }}>
                                                                    <button
                                                                        className="btn btn-secondary btn-sm"
                                                                        disabled={scaleDisabled}
                                                                        title={scaleTitle}
                                                                        onClick={() => {
                                                                            setTargetDeployment(dep);
                                                                            const current = Number(dep.desired ?? dep.replicas ?? dep.readyReplicas ?? dep.ready ?? 1);
                                                                            const next = current + 1 <= 10 ? current + 1 : current;
                                                                            setDesiredReplicas(next);
                                                                            setErrorMsg(null);
                                                                            setScaleModalOpen(true);
                                                                        }}
                                                                    >
                                                                        ⚡ Scale
                                                                    </button>
                                                                    <button
                                                                        className="btn btn-outline btn-sm"
                                                                        disabled={actionLoading || !isAuthorized || !isConnectionAvailable}
                                                                        title={!isAuthorized ? "Remediation execution requires ENGINEER or ADMIN role" : (!isConnectionAvailable ? "Cluster connection unavailable" : "Trigger rolling restart")}
                                                                        onClick={() => {
                                                                            setTargetDeployment(dep);
                                                                            setErrorMsg(null);
                                                                            setRestartModalOpen(true);
                                                                        }}
                                                                    >
                                                                        🔄 Restart
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="6" className="text-muted text-center">
                                                    {k8sData.dataStatus === "KUBERNETES_ERROR"
                                                        ? `Kubernetes query failed: ${k8sData.statusMessage || "Cluster unreachable"}`
                                                        : k8sData.dataStatus === "STALE"
                                                            ? "Agent telemetry stale: No recent deployment updates received."
                                                            : `No deployments found in namespace ${k8sData.namespace || "cloudops"}.`}
                                                </td>
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
                                                    <td>{pod.node || "—"}</td>
                                                    <td><code>{pod.ip}</code></td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="7" className="text-muted text-center">
                                                    {k8sData.dataStatus === "KUBERNETES_ERROR"
                                                        ? `Kubernetes query failed: ${k8sData.statusMessage || "Cluster unreachable"}`
                                                        : k8sData.dataStatus === "STALE"
                                                            ? "Agent telemetry stale: No recent pod updates received."
                                                            : `No active pods in namespace ${k8sData.namespace || "cloudops"}.`}
                                                </td>
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
                                        Current replicas: <strong>{targetDeployment.ready ?? targetDeployment.readyReplicas ?? targetDeployment.desired ?? targetDeployment.replicas ?? 1}</strong>
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
                                    {errorMsg && (
                                        <div className="alert-banner error" style={{ marginBottom: "12px" }}>
                                            <span>⚠️ {errorMsg}</span>
                                        </div>
                                    )}
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
                                        Namespace: <code>{targetDeployment.namespace || k8sData?.namespace || "cloudops"}</code>
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
                                {errorMsg && (
                                    <div className="alert-banner error" style={{ marginBottom: "12px" }}>
                                        <span>⚠️ {errorMsg}</span>
                                    </div>
                                )}
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
