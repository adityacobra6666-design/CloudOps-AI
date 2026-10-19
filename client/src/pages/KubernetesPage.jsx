import { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getKubernetesOverview,
    scaleKubernetesDeployment,
    restartKubernetesDeployment,
    getInfrastructureConnections
} from "../services/api";
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
    const [operationalProgress, setOperationalProgress] = useState(null);
    const [inProgressDeployments, setInProgressDeployments] = useState(new Set());
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
                    // Only auto-select if an active agent is online and current selection is no longer valid
                    if (connected) {
                        setSelectedEnvironment(current => (!current || (!connections.some(c => c._id === current) && current !== "local")) ? connected._id : current);
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
        return undefined;
    };

    const handleScaleSubmit = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!targetDeployment || actionLoading) return;

        const targetName = targetDeployment.name?.trim();
        const targetNamespace = (targetDeployment.namespace || k8sData?.namespace || "cloudops").trim();
        const numReplicas = Number(desiredReplicas);

        if (desiredReplicas === "" || isNaN(numReplicas) || !Number.isInteger(numReplicas) || numReplicas < 1 || numReplicas > 10) {
            setErrorMsg("Desired replicas must be an integer between 1 and 10 (no decimals or negative values).");
            return;
        }

        try {
            setActionLoading(true);
            setOperationalProgress(`Scaling ${targetName} to ${numReplicas} replicas...`);
            setErrorMsg(null);
            setSuccessMsg(null);
            setInProgressDeployments(prev => new Set(prev).add(targetName));

            const effectiveConnectionId = getEffectiveConnectionId();
            const payload = {
                replicas: numReplicas,
                namespace: targetNamespace,
                reason: `Manual scaling via UI to ${numReplicas} replicas`
            };

            if (effectiveConnectionId) {
                payload.connectionId = effectiveConnectionId;
            }

            setOperationalProgress(`Submitting scale request to Kubernetes API...`);
            const res = await scaleKubernetesDeployment(targetName, payload);

            if (res.success) {
                const ready = res.readyReplicas ?? res.newReplicas ?? numReplicas;
                const total = res.newReplicas ?? numReplicas;
                setSuccessMsg(res.message || `Successfully scaled ${targetName} to ${total} replicas (${ready}/${total} ready).`);
                setScaleModalOpen(false);
                setOperationalProgress(null);

                // Refresh immediately without tearing down screen, then poll convergence
                fetchK8s(effectiveConnectionId || selectedEnvironment, false, true);
                setTimeout(() => fetchK8s(effectiveConnectionId || selectedEnvironment, false, false), 2500);
                setTimeout(() => fetchK8s(effectiveConnectionId || selectedEnvironment, false, false), 5000);
            } else {
                setErrorMsg(res.message || "Scale action failed or was rejected.");
            }
        } catch (err) {
            setErrorMsg(err.message || "Scale action failed");
        } finally {
            setActionLoading(false);
            setOperationalProgress(null);
            setInProgressDeployments(prev => {
                const next = new Set(prev);
                next.delete(targetName);
                return next;
            });
        }
    };

    const handleRestartSubmit = async () => {
        if (!targetDeployment || actionLoading) return;
        const targetName = targetDeployment.name?.trim();
        const targetNamespace = (targetDeployment.namespace || k8sData?.namespace || "cloudops").trim();

        if (inProgressDeployments.has(targetName)) {
            setErrorMsg(`An operation is already in progress for deployment "${targetName}". Please wait for it to complete.`);
            return;
        }

        try {
            setActionLoading(true);
            setOperationalProgress(`Triggering rolling restart for ${targetName}...`);
            setErrorMsg(null);
            setSuccessMsg(null);
            setInProgressDeployments(prev => new Set(prev).add(targetName));

            const effectiveConnectionId = getEffectiveConnectionId();
            const payload = {
                namespace: targetNamespace,
                reason: "Manual rolling restart via CloudOps AI dashboard"
            };

            if (effectiveConnectionId) {
                payload.connectionId = effectiveConnectionId;
            }

            setOperationalProgress(`Updating pod template annotation and tracking rollout convergence...`);
            const res = await restartKubernetesDeployment(targetName, payload);

            if (res.success) {
                const ready = res.readyReplicas ?? targetDeployment.ready ?? 1;
                const desired = res.desiredReplicas ?? targetDeployment.desired ?? ready;
                setSuccessMsg(res.message || `Rolling restart completed successfully for ${targetName} (${ready}/${desired} pods ready).`);
                setRestartModalOpen(false);
                setOperationalProgress(null);

                // Refresh immediately without tearing down screen, then poll convergence
                fetchK8s(effectiveConnectionId || selectedEnvironment, false, true);
                setTimeout(() => fetchK8s(effectiveConnectionId || selectedEnvironment, false, false), 2500);
                setTimeout(() => fetchK8s(effectiveConnectionId || selectedEnvironment, false, false), 6000);
            } else {
                setErrorMsg(res.message || "Restart action failed or was rejected.");
            }
        } catch (err) {
            setErrorMsg(err.message || "Restart action failed");
        } finally {
            setActionLoading(false);
            setOperationalProgress(null);
            setInProgressDeployments(prev => {
                const next = new Set(prev);
                next.delete(targetName);
                return next;
            });
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
                            let stateLabel;
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
                                                            const isOperationRunning = inProgressDeployments.has(dep.name);
                                                            const scaleDisabled = actionLoading || isOperationRunning || !isAuthorized || !isConnectionAvailable || isStateful;
                                                            const restartDisabled = actionLoading || isOperationRunning || !isAuthorized || !isConnectionAvailable;
                                                            const scaleTitle = !isAuthorized
                                                                ? "Remediation execution requires ENGINEER or ADMIN role"
                                                                : (!isConnectionAvailable
                                                                    ? "Cluster connection unavailable"
                                                                    : (isOperationRunning
                                                                        ? `Kubernetes operation currently in progress for ${dep.name}`
                                                                        : (isStateful
                                                                            ? "Scaling is disabled for stateful database singleton. Use Restart Service for recovery."
                                                                            : "Scale this deployment")));
                                                            const restartTitle = !isAuthorized
                                                                ? "Remediation execution requires ENGINEER or ADMIN role"
                                                                : (!isConnectionAvailable
                                                                    ? "Cluster connection unavailable"
                                                                    : (isOperationRunning
                                                                        ? `Kubernetes operation currently in progress for ${dep.name}`
                                                                        : "Trigger rolling restart"));

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
                                                                        {isOperationRunning ? <span className="btn-spinner" style={{ width: "12px", height: "12px" }} /> : "⚡"} Scale
                                                                    </button>
                                                                    <button
                                                                        className="btn btn-outline btn-sm"
                                                                        disabled={restartDisabled}
                                                                        title={restartTitle}
                                                                        onClick={() => {
                                                                            setTargetDeployment(dep);
                                                                            setErrorMsg(null);
                                                                            setRestartModalOpen(true);
                                                                        }}
                                                                    >
                                                                        {isOperationRunning ? <span className="btn-spinner" style={{ width: "12px", height: "12px" }} /> : "🔄"} Restart
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
            {scaleModalOpen && targetDeployment && (() => {
                const currentReplicas = Number(targetDeployment.desired ?? targetDeployment.replicas ?? targetDeployment.readyReplicas ?? targetDeployment.ready ?? 1);
                const desiredVal = parseInt(desiredReplicas, 10);
                const isValid = !isNaN(desiredVal) && desiredVal >= 1 && desiredVal <= 10 && Number.isInteger(Number(desiredReplicas));
                const delta = isValid ? (desiredVal - currentReplicas) : 0;

                return (
                    <ModalPortal isOpen={scaleModalOpen} onClose={() => !actionLoading && setScaleModalOpen(false)}>
                        <div
                            className="modal-backdrop"
                            onClick={() => !actionLoading && setScaleModalOpen(false)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape" && !actionLoading) setScaleModalOpen(false);
                            }}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="scale-modal-title"
                            tabIndex={-1}
                        >
                            <div className="modal-content" style={{ maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
                                <div className="modal-header">
                                    <div className="modal-title-wrap">
                                        <h3 id="scale-modal-title" className="modal-title">Scale Deployment</h3>
                                        <p className="modal-subtitle">
                                            Target: <code style={{ color: "#38bdf8", fontWeight: 600 }}>{targetDeployment.name}</code> &bull; Namespace: <code>{targetDeployment.namespace || k8sData?.namespace || "cloudops"}</code>
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
                                    <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                        {errorMsg && (
                                            <div className="alert-banner error" style={{ margin: 0 }}>
                                                <span>⚠️ {errorMsg}</span>
                                            </div>
                                        )}

                                        {/* Active operation progress banner */}
                                        {actionLoading && operationalProgress && (
                                            <div className="alert-banner info" style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                                                <span className="btn-spinner" style={{ width: "16px", height: "16px" }} />
                                                <span style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>{operationalProgress}</span>
                                            </div>
                                        )}

                                        {/* Replica Change Preview Box */}
                                        <div style={{
                                            background: "rgba(15, 23, 42, 0.65)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "8px",
                                            padding: "14px 16px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between"
                                        }}>
                                            <div>
                                                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-muted)" }}>Current</div>
                                                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--color-text-main)" }}>
                                                    {currentReplicas}
                                                </div>
                                                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                                                    {targetDeployment.ready ?? targetDeployment.readyReplicas ?? currentReplicas} Ready
                                                </div>
                                            </div>

                                            <div style={{ fontSize: "1.4rem", color: "var(--color-text-muted)", padding: "0 8px" }}>
                                                ➔
                                            </div>

                                            <div>
                                                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-muted)" }}>Desired</div>
                                                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: isValid ? "#38bdf8" : "#f87171" }}>
                                                    {isValid ? desiredVal : "--"}
                                                </div>
                                                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                                                    Policy: 1 - 10
                                                </div>
                                            </div>

                                            <div style={{ textAlign: "right" }}>
                                                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-muted)" }}>Change</div>
                                                <span className={`status-pill compact-pill ${delta > 0 ? "success" : delta < 0 ? "warning" : "neutral"}`} style={{ fontSize: "0.82rem", fontWeight: 600, padding: "4px 8px" }}>
                                                    {delta > 0 ? `+${delta} (Scale Out)` : delta < 0 ? `${delta} (Scale In)` : "Re-apply (Sync)"}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Stepper & Input Controls */}
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
                                                <span>Desired Replicas (1 - 10):</span>
                                                <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>Whole numbers only</span>
                                            </label>

                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    style={{ width: "38px", height: "38px", padding: 0, fontSize: "1.1rem", fontWeight: 700 }}
                                                    disabled={actionLoading || desiredVal <= 1}
                                                    onClick={() => setDesiredReplicas(Math.max(1, (desiredVal || currentReplicas) - 1))}
                                                    aria-label="Decrease replica count"
                                                >
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="10"
                                                    step="1"
                                                    value={desiredReplicas}
                                                    onChange={(e) => setDesiredReplicas(e.target.value)}
                                                    className="form-input"
                                                    style={{ textAlign: "center", fontSize: "1.1rem", fontWeight: 700, height: "38px" }}
                                                    required
                                                    disabled={actionLoading}
                                                    aria-label="Desired Replicas"
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    style={{ width: "38px", height: "38px", padding: 0, fontSize: "1.1rem", fontWeight: 700 }}
                                                    disabled={actionLoading || desiredVal >= 10}
                                                    onClick={() => setDesiredReplicas(Math.min(10, (desiredVal || currentReplicas) + 1))}
                                                    aria-label="Increase replica count"
                                                >
                                                    +
                                                </button>
                                            </div>

                                            {/* Preset Chips */}
                                            <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" }}>
                                                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginRight: "4px" }}>Presets:</span>
                                                {[1, 2, 4, 6, 8, 10].map((preset) => (
                                                    <button
                                                        key={preset}
                                                        type="button"
                                                        className={`btn btn-xs ${desiredVal === preset ? "btn-primary" : "btn-secondary"}`}
                                                        style={{ minWidth: "28px", padding: "2px 8px" }}
                                                        disabled={actionLoading}
                                                        onClick={() => setDesiredReplicas(preset)}
                                                    >
                                                        {preset}
                                                    </button>
                                                ))}
                                            </div>

                                            {!isValid && desiredReplicas !== "" && (
                                                <div style={{ color: "#f87171", fontSize: "0.78rem", marginTop: "6px" }}>
                                                    ⚠️ Replicas must be a whole number between 1 and 10 (no decimals or negative values).
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
                                            ℹ️ Submitting this request patches the Kubernetes deployment spec directly. Telemetry will automatically refresh after rollout convergence.
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
                                            disabled={actionLoading || !isValid}
                                        >
                                            {actionLoading ? (
                                                <>
                                                    <span className="btn-spinner" />
                                                    Applying Scale...
                                                </>
                                            ) : delta === 0 ? (
                                                `Confirm Re-apply (${isValid ? desiredVal : ""} Pods)`
                                            ) : (
                                                `Confirm Scale to ${isValid ? desiredVal : ""} Pods`
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </ModalPortal>
                );
            })()}

            {/* RESTART MODAL */}
            {restartModalOpen && targetDeployment && (() => {
                const activePods = targetDeployment.ready ?? targetDeployment.readyReplicas ?? targetDeployment.desired ?? targetDeployment.replicas ?? 1;

                return (
                    <ModalPortal isOpen={restartModalOpen} onClose={() => !actionLoading && setRestartModalOpen(false)}>
                        <div
                            className="modal-backdrop"
                            onClick={() => !actionLoading && setRestartModalOpen(false)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape" && !actionLoading) setRestartModalOpen(false);
                            }}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="restart-modal-title"
                            tabIndex={-1}
                        >
                            <div className="modal-content" style={{ maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
                                <div className="modal-header">
                                    <div className="modal-title-wrap">
                                        <h3 id="restart-modal-title" className="modal-title">Trigger Rolling Restart</h3>
                                        <p className="modal-subtitle">
                                            Target: <code style={{ color: "#38bdf8", fontWeight: 600 }}>{targetDeployment.name}</code> &bull; Namespace: <code>{targetDeployment.namespace || k8sData?.namespace || "cloudops"}</code>
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
                                <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                    {errorMsg && (
                                        <div className="alert-banner error" style={{ margin: 0 }}>
                                            <span>⚠️ {errorMsg}</span>
                                        </div>
                                    )}

                                    {actionLoading && operationalProgress && (
                                        <div className="alert-banner info" style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                                            <span className="btn-spinner" style={{ width: "16px", height: "16px" }} />
                                            <span style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>{operationalProgress}</span>
                                        </div>
                                    )}

                                    <div style={{
                                        background: "rgba(15, 23, 42, 0.65)",
                                        border: "1px solid var(--border-color)",
                                        borderRadius: "8px",
                                        padding: "14px 16px"
                                    }}>
                                        <div style={{ fontWeight: 600, color: "var(--color-text-main)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                                            <span>🔄 Rolling Update Mechanics</span>
                                        </div>
                                        <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.82rem", lineHeight: 1.5 }}>
                                            This will update the deployment's pod template annotation (<code>kubectl.kubernetes.io/restartedAt</code>).
                                            Kubernetes will roll out replacement pods sequentially according to your rolling update strategy without downtime.
                                        </p>
                                    </div>

                                    <div style={{
                                        background: "rgba(245, 158, 11, 0.08)",
                                        border: "1px solid rgba(245, 158, 11, 0.25)",
                                        borderRadius: "8px",
                                        padding: "12px 14px",
                                        fontSize: "0.82rem",
                                        color: "#fcd34d",
                                        lineHeight: 1.4
                                    }}>
                                        <strong>Notice:</strong> All <strong>{activePods}</strong> active pod(s) will be replaced incrementally. Existing pods will only be terminated as newly scheduled replacement pods become Ready.
                                    </div>

                                    <p style={{ margin: 0, color: "var(--color-text-main)", fontSize: "0.85rem", fontWeight: 500 }}>
                                        Are you sure you want to initiate a rolling restart for <code>{targetDeployment.name}</code>?
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
                                            "Confirm Rolling Restart"
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </ModalPortal>
                );
            })()}

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
