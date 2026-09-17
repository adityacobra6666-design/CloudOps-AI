`import React, { useEffect, useMemo, useState } from "react";
import {
    getIncidents,
    analyzeIncident,
    updateIncident,
    deleteIncident,
    executeRemediation,
    getRemediationHistory,
} from "../services/api";

const Dashboard = () => {
    const [incidents, setIncidents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [analyzingId, setAnalyzingId] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [search, setSearch] = useState("");
    const [severityFilter, setSeverityFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");

    // Remediation state
    const [remediating, setRemediating] = useState(false);
    const [remediationResult, setRemediationResult] = useState(null);
    const [remediationHistory, setRemediationHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    const loadIncidents = async () => {
        try {
            setLoading(true);
            setError("");

            // IMPORTANT:
            // api.js returns the parsed backend result directly:
            // { success: true, incidents: [...] }
            const response = await getIncidents();

            setIncidents(response?.incidents || []);
        } catch (err) {
            console.error("Failed to load incidents:", err);
            setError(err.message || "Failed to fetch incidents");
            setIncidents([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadIncidents();
    }, []);

    const filteredIncidents = useMemo(() => {
        const query = search.trim().toLowerCase();

        return incidents.filter((incident) => {
            const matchesSearch =
                !query ||
                String(incident.title || "").toLowerCase().includes(query) ||
                String(incident.description || "").toLowerCase().includes(query) ||
                String(incident.source || "").toLowerCase().includes(query);

            const matchesSeverity =
                severityFilter === "all" ||
                String(incident.severity || "").toLowerCase() === severityFilter;

            const matchesStatus =
                statusFilter === "all" ||
                String(incident.status || "").toLowerCase() === statusFilter;

            return matchesSearch && matchesSeverity && matchesStatus;
        });
    }, [incidents, search, severityFilter, statusFilter]);

    const stats = useMemo(() => {
        return {
            total: incidents.length,
            critical: incidents.filter(
                (i) => String(i.severity).toLowerCase() === "critical"
            ).length,
            warning: incidents.filter(
                (i) => String(i.severity).toLowerCase() === "warning"
            ).length,
            info: incidents.filter(
                (i) => String(i.severity).toLowerCase() === "info"
            ).length,
            open: incidents.filter(
                (i) => String(i.status).toLowerCase() === "open"
            ).length,
            resolved: incidents.filter(
                (i) => String(i.status).toLowerCase() === "resolved"
            ).length,
        };
    }, [incidents]);

    const handleAnalyze = async (incident) => {
        try {
            setAnalyzingId(incident._id);
            setError("");

            const result = await analyzeIncident(incident._id);

            setAnalysis({
                incident,
                result,
            });

            // Refresh because the backend saves AI analysis/embedding.
            await loadIncidents();
        } catch (err) {
            console.error("AI analysis failed:", err);
            setError(err.message || "AI analysis failed");
        } finally {
            setAnalyzingId(null);
        }
    };

    const handleRemediate = async (incident) => {
        try {
            setRemediating(true);
            setRemediationResult(null);
            setError("");

            const result = await executeRemediation(incident._id);

            setRemediationResult(result);

            await loadIncidents();
            await loadRemediationHistory(incident._id);
        } catch (err) {
            console.error("Remediation failed:", err);
            setError(err.message || "Remediation failed");
        } finally {
            setRemediating(false);
        }
    };

    const loadRemediationHistory = async (incidentId) => {
        try {
            setHistoryLoading(true);
            const result = await getRemediationHistory(incidentId);
            setRemediationHistory(result?.data || []);
        } catch (err) {
            console.error("Failed to load remediation history:", err);
            setRemediationHistory([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    const handleResolve = async (incident) => {
        try {
            setError("");

            await updateIncident(incident._id, {
                status:
                    String(incident.status).toLowerCase() === "resolved"
                        ? "open"
                        : "resolved",
            });

            await loadIncidents();
        } catch (err) {
            console.error("Status update failed:", err);
            setError(err.message || "Failed to update incident");
        }
    };

    const handleDelete = async (incident) => {
        const confirmed = window.confirm(
            `Delete incident "${incident.title}"?`
        );

        if (!confirmed) return;

        try {
            setError("");

            await deleteIncident(incident._id);

            if (analysis?.incident?._id === incident._id) {
                setAnalysis(null);
            }

            await loadIncidents();
        } catch (err) {
            console.error("Delete failed:", err);
            setError(err.message || "Failed to delete incident");
        }
    };

    const severityClass = (severity) => {
        const value = String(severity || "").toLowerCase();

        if (value === "critical") return "critical";
        if (value === "warning" || value === "medium") return "warning";
        return "info";
    };

    const formatDate = (value) => {
        if (!value) return "N/A";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return "N/A";

        return date.toLocaleString();
    };

    return (
        <div className="dashboard-page">
            <style>{`
                .dashboard-page {
                    min-height: 100vh;
                    padding: 32px;
                    color: #e9e7f2;
                    background:
                        radial-gradient(circle at top right, rgba(125, 63, 220, 0.16), transparent 35%),
                        #0b0a11;
                    box-sizing: border-box;
                }

                .dashboard-container {
                    max-width: 1250px;
                    margin: 0 auto;
                }

                .dashboard-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    gap: 20px;
                    margin-bottom: 28px;
                }

                .eyebrow {
                    color: #a66cff;
                    font-size: 13px;
                    font-weight: 800;
                    letter-spacing: 3px;
                    margin-bottom: 8px;
                }

                .dashboard-title {
                    margin: 0;
                    font-size: 34px;
                    font-weight: 800;
                }

                .dashboard-subtitle {
                    margin: 8px 0 0;
                    color: #8d899c;
                }

                .refresh-button,
                .action-button {
                    border: 1px solid #312d3e;
                    border-radius: 10px;
                    background: #15131d;
                    color: #e9e7f2;
                    padding: 11px 16px;
                    cursor: pointer;
                    font-weight: 700;
                }

                .refresh-button:hover,
                .action-button:hover {
                    border-color: #8a4ff0;
                }

                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 16px;
                    margin-bottom: 20px;
                }

                .stat-card {
                    padding: 20px;
                    border: 1px solid #292532;
                    border-radius: 16px;
                    background: rgba(18, 16, 25, 0.92);
                }

                .stat-label {
                    color: #8d899c;
                    font-size: 13px;
                }

                .stat-value {
                    margin-top: 7px;
                    font-size: 30px;
                    font-weight: 800;
                }

                .critical-text { color: #ff5f6d; }
                .warning-text { color: #ffb020; }
                .success-text { color: #31c46b; }

                .panel {
                    border: 1px solid #292532;
                    border-radius: 18px;
                    background: rgba(15, 14, 21, 0.94);
                    overflow: hidden;
                }

                .panel-header {
                    padding: 22px;
                    border-bottom: 1px solid #292532;
                }

                .panel-title {
                    margin: 0;
                    font-size: 24px;
                }

                .filters {
                    display: grid;
                    grid-template-columns: 1fr 180px 180px;
                    gap: 12px;
                    margin-top: 18px;
                }

                .filter-input,
                .filter-select {
                    width: 100%;
                    box-sizing: border-box;
                    padding: 12px 14px;
                    border-radius: 10px;
                    border: 1px solid #302c3b;
                    background: #121019;
                    color: #eeeaf7;
                    outline: none;
                }

                .filter-input:focus,
                .filter-select:focus {
                    border-color: #8a4ff0;
                }

                .error-box {
                    margin: 18px 22px 0;
                    padding: 13px 15px;
                    border: 1px solid #69303b;
                    border-radius: 10px;
                    background: #26141a;
                    color: #ff9ca6;
                }

                .incident-list {
                    display: grid;
                    gap: 1px;
                    background: #292532;
                }

                .incident-card {
                    padding: 20px 22px;
                    background: #0f0e15;
                }

                .incident-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    gap: 16px;
                }

                .incident-title {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 800;
                }

                .incident-description {
                    margin: 7px 0 0;
                    color: #9290a0;
                    line-height: 1.5;
                }

                .badges {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                    margin-top: 14px;
                }

                .badge {
                    display: inline-flex;
                    align-items: center;
                    border-radius: 999px;
                    padding: 5px 9px;
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: .5px;
                    text-transform: uppercase;
                }

                .badge.critical {
                    color: #ff7783;
                    background: rgba(255, 77, 94, .12);
                }

                .badge.warning {
                    color: #ffc45d;
                    background: rgba(255, 176, 32, .12);
                }

                .badge.info {
                    color: #8eb9ff;
                    background: rgba(65, 133, 255, .12);
                }

                .badge.status-open {
                    color: #ffb84d;
                    background: rgba(255, 176, 32, .1);
                }

                .badge.status-resolved {
                    color: #5be08a;
                    background: rgba(49, 196, 107, .1);
                }

                .incident-meta {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 16px;
                    margin-top: 14px;
                    color: #777385;
                    font-size: 12px;
                }

                .incident-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 17px;
                }

                .ai-button {
                    border-color: #6f3bd0;
                    background: #211536;
                    color: #c89cff;
                }

                .delete-button {
                    color: #ff8b96;
                }

                .empty-state,
                .loading-state {
                    padding: 70px 20px;
                    text-align: center;
                    color: #858091;
                }

                .empty-title {
                    color: #ddd9e8;
                    font-size: 18px;
                    font-weight: 800;
                    margin-bottom: 8px;
                }

                .analysis-panel {
                    margin-top: 20px;
                    border: 1px solid #58329a;
                    border-radius: 18px;
                    background: #12101a;
                    overflow: hidden;
                }

                .analysis-header {
                    padding: 18px 20px;
                    border-bottom: 1px solid #332a44;
                }

                .analysis-header h3 {
                    margin: 0;
                }

                .analysis-body {
                    padding: 20px;
                }

                .analysis-pre {
                    white-space: pre-wrap;
                    word-break: break-word;
                    color: #d8d3e2;
                    line-height: 1.65;
                    margin: 0;
                    font-family: inherit;
                }

                .similar-list {
                    margin-top: 18px;
                    color: #aaa5b5;
                }

                .similar-list strong {
                    color: #ddd9e8;
                }

                @media (max-width: 900px) {
                    .stats-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }

                    .filters {
                        grid-template-columns: 1fr;
                    }
                }

                @media (max-width: 600px) {
                    .dashboard-page {
                        padding: 18px;
                    }

                    .dashboard-header {
                        flex-direction: column;
                    }

                    .stats-grid {
                        grid-template-columns: 1fr;
                    }

                    .incident-top {
                        flex-direction: column;
                    }
                }

                /* =============================== */
                /* REMEDIATION STYLES              */
                /* =============================== */

                .remediation-panel {
                    margin-top: 20px;
                    border: 1px solid #2a5a3a;
                    border-radius: 18px;
                    background: #0e1514;
                    overflow: hidden;
                }

                .remediation-header {
                    padding: 18px 20px;
                    border-bottom: 1px solid #243830;
                }

                .remediation-header h3 {
                    margin: 0;
                }

                .remediation-body {
                    padding: 20px;
                }

                .remediation-decision {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 14px;
                    margin-bottom: 18px;
                }

                .remediation-field {
                    padding: 12px 14px;
                    border: 1px solid #293530;
                    border-radius: 10px;
                    background: #111a17;
                }

                .remediation-field-label {
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: 1.5px;
                    color: #6b9b80;
                    text-transform: uppercase;
                    margin-bottom: 6px;
                }

                .remediation-field-value {
                    font-size: 15px;
                    color: #d0ebe0;
                    font-weight: 600;
                }

                .remediate-button {
                    border: 1px solid #2a7a4a;
                    border-radius: 10px;
                    background: #163028;
                    color: #5be08a;
                    padding: 12px 22px;
                    cursor: pointer;
                    font-weight: 800;
                    font-size: 14px;
                    letter-spacing: 0.5px;
                    width: 100%;
                    margin-top: 4px;
                }

                .remediate-button:hover {
                    background: #1d4035;
                    border-color: #3aaf65;
                }

                .remediate-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .remediation-result {
                    margin-top: 16px;
                    padding: 14px;
                    border-radius: 10px;
                    border: 1px solid #293530;
                    background: #111a17;
                }

                .remediation-result.success {
                    border-color: #2a7a4a;
                }

                .remediation-result.failed {
                    border-color: #69303b;
                    background: #1a1114;
                }

                .verification-metric {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 10px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    background: rgba(91, 224, 138, 0.06);
                    font-weight: 600;
                }

                .policy-badge {
                    display: inline-flex;
                    padding: 4px 10px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: 0.5px;
                }

                .policy-badge.approved {
                    color: #5be08a;
                    background: rgba(49, 196, 107, 0.1);
                }

                .policy-badge.rejected {
                    color: #ff7783;
                    background: rgba(255, 77, 94, 0.1);
                }

                .history-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 14px;
                    font-size: 13px;
                }

                .history-table th {
                    text-align: left;
                    padding: 10px 12px;
                    color: #6b9b80;
                    font-weight: 800;
                    font-size: 11px;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                    border-bottom: 1px solid #243830;
                }

                .history-table td {
                    padding: 10px 12px;
                    color: #c0dbd0;
                    border-bottom: 1px solid #1a2822;
                }

                .status-chip {
                    display: inline-flex;
                    padding: 3px 8px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                }

                .status-chip.success { color: #5be08a; background: rgba(49, 196, 107, .1); }
                .status-chip.failed { color: #ff7783; background: rgba(255, 77, 94, .1); }
                .status-chip.executing { color: #ffc45d; background: rgba(255, 176, 32, .1); }
                .status-chip.rejected { color: #ff7783; background: rgba(255, 77, 94, .1); }
                .status-chip.unverified { color: #8eb9ff; background: rgba(65, 133, 255, .1); }
                .status-chip.approved { color: #5be08a; background: rgba(49, 196, 107, .1); }
                .status-chip.pending { color: #aaa5b5; background: rgba(150, 150, 150, .1); }

                @media (max-width: 600px) {
                    .remediation-decision {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>

            <div className="dashboard-container">
                <div className="dashboard-header">
                    <div>
                        <div className="eyebrow">CLOUDOPS AI</div>
                        <h1 className="dashboard-title">Operations Dashboard</h1>
                        <p className="dashboard-subtitle">
                            Infrastructure incidents, monitoring and AI-assisted RCA
                        </p>
                    </div>

                    <button
                        className="refresh-button"
                        onClick={loadIncidents}
                        disabled={loading}
                    >
                        {loading ? "Refreshing..." : "↻ Refresh"}
                    </button>
                </div>

                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-label">Total Incidents</div>
                        <div className="stat-value">{stats.total}</div>
                    </div>

                    <div className="stat-card">
                        <div className="stat-label">Critical</div>
                        <div className="stat-value critical-text">
                            {stats.critical}
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="stat-label">Open</div>
                        <div className="stat-value warning-text">
                            {stats.open}
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="stat-label">Resolved</div>
                        <div className="stat-value success-text">
                            {stats.resolved}
                        </div>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-header">
                        <div className="eyebrow">INCIDENT CENTER</div>
                        <h2 className="panel-title">Recent Incidents</h2>

                        <div className="filters">
                            <input
                                className="filter-input"
                                type="search"
                                placeholder="Search incidents, servers..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />

                            <select
                                className="filter-select"
                                value={severityFilter}
                                onChange={(e) =>
                                    setSeverityFilter(e.target.value)
                                }
                            >
                                <option value="all">All Severities</option>
                                <option value="critical">Critical</option>
                                <option value="warning">Warning</option>
                                <option value="info">Info</option>
                            </select>

                            <select
                                className="filter-select"
                                value={statusFilter}
                                onChange={(e) =>
                                    setStatusFilter(e.target.value)
                                }
                            >
                                <option value="all">All Status</option>
                                <option value="open">Open</option>
                                <option value="resolved">Resolved</option>
                            </select>
                        </div>
                    </div>

                    {error && <div className="error-box">{error}</div>}

                    {loading ? (
                        <div className="loading-state">
                            Loading incidents...
                        </div>
                    ) : filteredIncidents.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-title">
                                {incidents.length === 0
                                    ? "No incidents yet"
                                    : "No matching incidents"}
                            </div>

                            <div>
                                {incidents.length === 0
                                    ? "Prometheus/Alertmanager incidents will appear here."
                                    : "Try changing the search or filters."}
                            </div>
                        </div>
                    ) : (
                        <div className="incident-list">
                            {filteredIncidents.map((incident) => {
                                const severity = severityClass(
                                    incident.severity
                                );

                                const isResolved =
                                    String(incident.status).toLowerCase() ===
                                    "resolved";

                                return (
                                    <div
                                        className="incident-card"
                                        key={incident._id}
                                    >
                                        <div className="incident-top">
                                            <div>
                                                <h3 className="incident-title">
                                                    {incident.title ||
                                                        "Untitled Incident"}
                                                </h3>

                                                <p className="incident-description">
                                                    {incident.description ||
                                                        "No description available."}
                                                </p>

                                                <div className="badges">
                                                    <span
                                                        className={`badge ${severity}`}
                                                    >
                                                        {incident.severity ||
                                                            "info"}
                                                    </span>

                                                    <span
                                                        className={`badge ${
                                                            isResolved
                                                                ? "status-resolved"
                                                                : "status-open"
                                                        }`}
                                                    >
                                                        {incident.status ||
                                                            "open"}
                                                    </span>
                                                </div>

                                                <div className="incident-meta">
                                                    <span>
                                                        Source:{" "}
                                                        {incident.source ||
                                                            "N/A"}
                                                    </span>

                                                    <span>
                                                        Category:{" "}
                                                        {incident.category ||
                                                            "N/A"}
                                                    </span>

                                                    <span>
                                                        Created:{" "}
                                                        {formatDate(
                                                            incident.createdAt
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="incident-actions">
                                            <button
                                                className="action-button ai-button"
                                                onClick={() =>
                                                    handleAnalyze(incident)
                                                }
                                                disabled={
                                                    analyzingId ===
                                                    incident._id
                                                }
                                            >
                                                {analyzingId === incident._id
                                                    ? "Analyzing..."
                                                    : "✦ AI Analyze"}
                                            </button>

                                            <button
                                                className="action-button"
                                                onClick={() =>
                                                    handleResolve(incident)
                                                }
                                            >
                                                {isResolved
                                                    ? "Reopen"
                                                    : "Resolve"}
                                            </button>

                                            <button
                                                className="action-button delete-button"
                                                onClick={() =>
                                                    handleDelete(incident)
                                                }
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {analysis && (
                    <div className="analysis-panel">
                        <div className="analysis-header">
                            <div className="eyebrow">RAG + OLLAMA</div>
                            <h3>
                                AI Analysis —{" "}
                                {analysis.incident?.title || "Incident"}
                            </h3>
                        </div>

                        <div className="analysis-body">
                            <pre className="analysis-pre">
                                {analysis.result?.analysis ||
                                    "No AI analysis returned."}
                            </pre>

                            {Array.isArray(
                                analysis.result?.similarIncidents
                            ) &&
                                analysis.result.similarIncidents.length >
                                    0 && (
                                    <div className="similar-list">
                                        <strong>
                                            Similar historical incidents:
                                        </strong>

                                        <ul>
                                            {analysis.result.similarIncidents.map(
                                                (item) => (
                                                    <li key={item.id}>
                                                        {item.title}
                                                    </li>
                                                )
                                            )}
                                        </ul>
                                    </div>
                                )}
                        </div>
                    </div>
                )}

                {/* ================================= */}
                {/* REMEDIATION DECISION              */}
                {/* ================================= */}

                {analysis?.result?.remediationDecision && (
                    <div className="remediation-panel">
                        <div className="remediation-header">
                            <div className="eyebrow" style={{color: '#5be08a'}}>AUTONOMOUS REMEDIATION</div>
                            <h3>AI Recommendation</h3>
                        </div>

                        <div className="remediation-body">
                            <div className="remediation-decision">
                                <div className="remediation-field">
                                    <div className="remediation-field-label">Action</div>
                                    <div className="remediation-field-value">
                                        {analysis.result.remediationDecision.action?.replace("_", " ") || "N/A"}
                                    </div>
                                </div>

                                <div className="remediation-field">
                                    <div className="remediation-field-label">Target</div>
                                    <div className="remediation-field-value">
                                        {analysis.result.remediationDecision.target || "N/A"}
                                    </div>
                                </div>

                                <div className="remediation-field">
                                    <div className="remediation-field-label">Reason</div>
                                    <div className="remediation-field-value">
                                        {analysis.result.remediationDecision.reason || "N/A"}
                                    </div>
                                </div>

                                <div className="remediation-field">
                                    <div className="remediation-field-label">Confidence</div>
                                    <div className="remediation-field-value">
                                        {analysis.result.remediationDecision.confidence != null
                                            ? `${Math.round(analysis.result.remediationDecision.confidence * 100)}%`
                                            : "N/A"}
                                    </div>
                                </div>
                            </div>

                            <button
                                className="remediate-button"
                                onClick={() => handleRemediate(analysis.incident)}
                                disabled={remediating}
                            >
                                {remediating
                                    ? "⏳ Executing Remediation..."
                                    : "⚡ Execute Remediation"}
                            </button>

                            {remediationResult && (
                                <div className={`remediation-result ${remediationResult.success ? 'success' : 'failed'}`}>
                                    <div style={{marginBottom: 8}}>
                                        <span className={`status-chip ${remediationResult.success ? 'success' : 'failed'}`}>
                                            {remediationResult.success ? "SUCCESS ✓" : "FAILED ✗"}
                                        </span>
                                    </div>

                                    <div style={{color: '#aaa5b5', fontSize: 14}}>
                                        {remediationResult.message}
                                    </div>

                                    {remediationResult.data?.action?.verification &&
                                     remediationResult.data.action.verification.before != null && (
                                        <div className="verification-metric">
                                            <span>📊</span>
                                            <span>
                                                {remediationResult.data.action.verification.metric}:
                                                {" "}{remediationResult.data.action.verification.before}
                                                {" → "}
                                                {remediationResult.data.action.verification.after}
                                            </span>
                                        </div>
                                    )}

                                    {remediationResult.data?.action?.policy && (
                                        <div style={{marginTop: 10}}>
                                            <span className={`policy-badge ${remediationResult.data.action.policy.approved ? 'approved' : 'rejected'}`}>
                                                Policy: {remediationResult.data.action.policy.approved ? 'APPROVED' : 'REJECTED'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ACTION HISTORY */}
                            {remediationHistory.length > 0 && (
                                <div style={{marginTop: 20}}>
                                    <div className="remediation-field-label" style={{marginBottom: 10}}>
                                        Action History
                                    </div>
                                    <table className="history-table">
                                        <thead>
                                            <tr>
                                                <th>Time</th>
                                                <th>Action</th>
                                                <th>Target</th>
                                                <th>Status</th>
                                                <th>Verification</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {remediationHistory.map((item) => (
                                                <tr key={item._id}>
                                                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                                                    <td>{item.action?.replace("_", " ")}</td>
                                                    <td>{item.target}</td>
                                                    <td>
                                                        <span className={`status-chip ${item.status?.toLowerCase()}`}>
                                                            {item.status}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {item.verification?.status ? (
                                                            <span className={`status-chip ${item.verification.status.toLowerCase()}`}>
                                                                {item.verification.status}
                                                            </span>
                                                        ) : (
                                                            "—"
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
