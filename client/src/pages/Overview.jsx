import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMetrics } from "../hooks/useMetrics";
import { useSystemHealth } from "../hooks/useSystemHealth";
import { getIncidents, getAllRemediationActions, getReliabilityOverview } from "../services/api";
import Header from "../components/Header";

export default function Overview() {
    const { metrics, loading: metricsLoading, error: metricsError, lastUpdated, refetch: refetchMetrics } = useMetrics(5000);
    const { services, globalStatus, refetch: refetchHealth } = useSystemHealth(5000);

    const [incidents, setIncidents] = useState([]);
    const [remediations, setRemediations] = useState([]);
    const [reliability, setReliability] = useState(null);
    const [loadingExtra, setLoadingExtra] = useState(true);

    const loadExtraData = async () => {
        try {
            const [incRes, remRes, relRes] = await Promise.allSettled([
                getIncidents(),
                getAllRemediationActions(),
                getReliabilityOverview()
            ]);

            if (incRes.status === "fulfilled") {
                const val = incRes.value;
                setIncidents(Array.isArray(val) ? val : (val?.incidents || []));
            }
            if (remRes.status === "fulfilled" && remRes.value.data) setRemediations(remRes.value.data || []);
            if (relRes.status === "fulfilled") setReliability(relRes.value || null);
        } catch (e) {
            console.error("Error loading overview extras:", e);
        } finally {
            setLoadingExtra(false);
        }
    };

    useEffect(() => {
        loadExtraData();
    }, []);

    const handleRefreshAll = () => {
        refetchMetrics();
        refetchHealth();
        loadExtraData();
    };

    const latestRemediation = remediations.length > 0 ? remediations[0] : null;

    return (
        <div className="page-container">
            <Header
                title="Operations Overview"
                lastUpdated={lastUpdated}
                onRefresh={handleRefreshAll}
            />

            {/* SYSTEM STATUS BANNER */}
            <div className="overview-status-banner">
                <div className="status-banner-left">
                    <span className={`status-indicator-badge ${globalStatus.toLowerCase()}`}>
                        ● {globalStatus}
                    </span>
                    <span className="banner-subtitle">
                        CloudOps AI is actively monitoring system health & infrastructure parameters
                    </span>
                </div>
                <button type="button" className="btn-secondary" onClick={handleRefreshAll}>
                    ⚡ Sync Live Telemetry
                </button>
            </div>

            {/* LIVE SYSTEM METRICS GRID */}
            <section className="dashboard-section">
                <h2 className="section-title">Live System Metrics</h2>
                {metricsLoading && !metrics ? (
                    <div className="card loading-card">Loading live metrics...</div>
                ) : metricsError ? (
                    <div className="card error-card">
                        ⚠️ Unable to connect to metrics service. Retrying...
                    </div>
                ) : (
                    <div className="metrics-grid">
                        <div className="metric-tile">
                            <span className="tile-label">CPU Usage</span>
                            <div className="tile-value-row">
                                <span className="tile-value">{metrics?.cpu?.value ?? "N/A"}</span>
                                <span className="tile-unit">{metrics?.cpu?.unit}</span>
                            </div>
                            <span className={`tile-status ${metrics?.cpu?.status?.toLowerCase()}`}>
                                {metrics?.cpu?.status || "Normal"}
                            </span>
                        </div>

                        <div className="metric-tile">
                            <span className="tile-label">Memory Usage</span>
                            <div className="tile-value-row">
                                <span className="tile-value">{metrics?.memory?.value ?? "N/A"}</span>
                                <span className="tile-unit">{metrics?.memory?.unit}</span>
                            </div>
                            <span className={`tile-status ${metrics?.memory?.status?.toLowerCase()}`}>
                                {metrics?.memory?.status || "Healthy"}
                            </span>
                        </div>

                        <div className="metric-tile">
                            <span className="tile-label">Request Rate</span>
                            <div className="tile-value-row">
                                <span className="tile-value">{metrics?.requestRate?.value ?? "N/A"}</span>
                                <span className="tile-unit">{metrics?.requestRate?.unit}</span>
                            </div>
                            <span className="tile-status healthy">
                                {metrics?.requestRate?.status || "Healthy"}
                            </span>
                        </div>

                        <div className="metric-tile">
                            <span className="tile-label">Error Rate</span>
                            <div className="tile-value-row">
                                <span className="tile-value">{metrics?.errorRate?.value ?? "N/A"}</span>
                                <span className="tile-unit">{metrics?.errorRate?.unit}</span>
                            </div>
                            <span className={`tile-status ${metrics?.errorRate?.status?.toLowerCase()}`}>
                                {metrics?.errorRate?.status || "Healthy"}
                            </span>
                        </div>

                        <div className="metric-tile">
                            <span className="tile-label">P95 Latency</span>
                            <div className="tile-value-row">
                                <span className="tile-value">{metrics?.p95Latency?.value ?? "N/A"}</span>
                                <span className="tile-unit">{metrics?.p95Latency?.unit}</span>
                            </div>
                            <span className={`tile-status ${metrics?.p95Latency?.status?.toLowerCase()}`}>
                                {metrics?.p95Latency?.status || "Healthy"}
                            </span>
                        </div>

                        <div className="metric-tile">
                            <span className="tile-label">Network Bandwidth</span>
                            <div className="tile-value-row">
                                <span className="tile-value">{metrics?.networkThroughput?.value ?? "N/A"}</span>
                                <span className="tile-unit">{metrics?.networkThroughput?.unit}</span>
                            </div>
                            <span className="tile-status healthy">Healthy</span>
                        </div>
                    </div>
                )}
            </section>

            {/* TWO-COLUMN GRID: SERVICE HEALTH & AI OPERATIONS */}
            <div className="two-column-grid">
                {/* SERVICE HEALTH */}
                <div className="ops-card">
                    <div className="card-header">
                        <h3>Service Health</h3>
                        <span className="card-tag">Real-Time Pings</span>
                    </div>
                    <div className="services-list">
                        {services.map((svc) => (
                            <div key={svc.name} className="service-row">
                                <div className="svc-info">
                                    <span className={`status-dot-sm ${svc.status.toLowerCase()}`} />
                                    <span className="svc-name">{svc.name}</span>
                                </div>
                                <span className={`svc-badge ${svc.status.toLowerCase()}`}>
                                    {svc.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* AI OPERATIONS SUMMARY */}
                <div className="ops-card">
                    <div className="card-header">
                        <h3>AI Operations Summary</h3>
                        <Link to="/ai-ops" className="link-action">View All Actions →</Link>
                    </div>

                    {latestRemediation ? (
                        <div className="ai-action-summary">
                            <div className="action-summary-header">
                                <span className="action-name">{latestRemediation.action}</span>
                                <span className={`status-pill ${latestRemediation.status?.toLowerCase()}`}>
                                    {latestRemediation.status}
                                </span>
                            </div>

                            <div className="summary-detail-grid">
                                <div>
                                    <span className="lbl">Target Service:</span>
                                    <span className="val">{latestRemediation.target}</span>
                                </div>
                                <div>
                                    <span className="lbl">Reason:</span>
                                    <span className="val">{latestRemediation.reason}</span>
                                </div>
                            </div>

                            {latestRemediation.verification && (
                                <div className="verification-block">
                                    <span className="ver-label">Verification Result:</span>
                                    <span className="ver-msg">{latestRemediation.verification.message}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="empty-state">
                            <p>No recent AI remediation actions executed.</p>
                            <span className="sub">CloudOps AI automatically suggests actions upon incident analysis.</span>
                        </div>
                    )}
                </div>
            </div>

            {/* RELIABILITY & ERROR BUDGET SUMMARY */}
            <section className="dashboard-section">
                <div className="ops-card">
                    <div className="card-header">
                        <h3>Reliability Overview</h3>
                        <Link to="/reliability" className="link-action">View Reliability Dashboard →</Link>
                    </div>

                    <div className="reliability-summary-grid">
                        <div className="rel-card">
                            <span className="rel-title">Availability</span>
                            <span className="rel-val">{reliability?.slos?.availability?.current !== undefined ? `${reliability.slos.availability.current}%` : "--"}</span>
                            <span className={`rel-status ${reliability?.slos?.availability?.status === "HEALTHY" ? "success" : "danger"}`}>
                                {reliability?.slos?.availability?.status === "HEALTHY" ? "✓ Within SLO" : "⚠️ Violated"}
                            </span>
                        </div>

                        <div className="rel-card">
                            <span className="rel-title">P95 Latency</span>
                            <span className="rel-val">{reliability?.slos?.latency?.current !== undefined ? `${reliability.slos.latency.current} ms` : "--"}</span>
                            <span className={`rel-status ${reliability?.slos?.latency?.status === "HEALTHY" ? "success" : "danger"}`}>
                                {reliability?.slos?.latency?.status === "HEALTHY" ? "✓ Within Target" : "⚠️ Violated"}
                            </span>
                        </div>

                        <div className="rel-card">
                            <span className="rel-title">Error Budget</span>
                            <span className="rel-val">{reliability?.errorBudget?.remainingPercent !== undefined ? `${reliability.errorBudget.remainingPercent}% remaining` : "--"}</span>
                            <span className="rel-sub">Burn Rate: {reliability?.errorBudget?.burnRate ?? "--"}</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* RECENT INCIDENTS */}
            <section className="dashboard-section">
                <div className="ops-card">
                    <div className="card-header">
                        <h3>Recent Incidents</h3>
                        <Link to="/incidents" className="link-action">View All Incidents →</Link>
                    </div>

                    {incidents.length === 0 ? (
                        <div className="empty-state">No active or historical incidents found.</div>
                    ) : (
                        <div className="table-responsive">
                            <table className="ops-table">
                                <thead>
                                    <tr>
                                        <th>Severity</th>
                                        <th>Title</th>
                                        <th>Status</th>
                                        <th>Source</th>
                                        <th>Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {incidents.slice(0, 5).map((inc) => (
                                        <tr key={inc._id}>
                                            <td>
                                                <span className={`severity-badge ${inc.severity?.toLowerCase()}`}>
                                                    {inc.severity}
                                                </span>
                                            </td>
                                            <td className="font-semibold">{inc.title}</td>
                                            <td>
                                                <span className={`status-pill ${inc.status?.toLowerCase()}`}>
                                                    {inc.status}
                                                </span>
                                            </td>
                                            <td>{inc.source || "Alertmanager"}</td>
                                            <td className="text-muted">
                                                {new Date(inc.createdAt).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>

            {/* LIVE OPERATIONS TIMELINE */}
            <section className="dashboard-section">
                <div className="ops-card">
                    <div className="card-header">
                        <h3>Live Operations Timeline</h3>
                    </div>
                    <div className="timeline-list">
                        <div className="timeline-item">
                            <span className="timeline-icon green">●</span>
                            <div className="timeline-content">
                                <span className="timeline-time">Just now</span>
                                <span className="timeline-title">Telemetry Sync Completed</span>
                                <span className="timeline-desc">All system health endpoints responded OK</span>
                            </div>
                        </div>

                        {latestRemediation && (
                            <div className="timeline-item">
                                <span className="timeline-icon purple">⚡</span>
                                <div className="timeline-content">
                                    <span className="timeline-time">
                                        {new Date(latestRemediation.createdAt || Date.now()).toLocaleTimeString()}
                                    </span>
                                    <span className="timeline-title">
                                        AI Remediation: {latestRemediation.action} on {latestRemediation.target}
                                    </span>
                                    <span className="timeline-desc">{latestRemediation.reason}</span>
                                </div>
                            </div>
                        )}

                        <div className="timeline-item">
                            <span className="timeline-icon blue">🔍</span>
                            <div className="timeline-content">
                                <span className="timeline-time">System Startup</span>
                                <span className="timeline-title">Prometheus & cAdvisor Agent Monitoring Active</span>
                                <span className="timeline-desc">Scraping metrics at 5s interval</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
