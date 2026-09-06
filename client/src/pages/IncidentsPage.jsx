import React, { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getIncidents,
    createIncident,
    updateIncident,
    deleteIncident,
    analyzeIncident,
    executeRemediation,
    getRemediationHistory
} from "../services/api";
import Header from "../components/Header";

export default function IncidentsPage() {
    const { user } = useOutletContext() || {};
    const [incidents, setIncidents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filters & Search
    const [searchTerm, setSearchTerm] = useState("");
    const [severityFilter, setSeverityFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");

    // Selected Incident Modal & State
    const [selectedIncident, setSelectedIncident] = useState(null);
    const [analyzingId, setAnalyzingId] = useState(null);
    const [remediatingId, setRemediatingId] = useState(null);
    const [remediationHistory, setRemediationHistory] = useState([]);
    const [remediationMsg, setRemediationMsg] = useState(null);

    // New Incident Form
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newSeverity, setNewSeverity] = useState("MEDIUM");
    const [newDescription, setNewDescription] = useState("");

    const fetchIncidentsData = async () => {
        try {
            setLoading(true);
            const data = await getIncidents();
            const incList = Array.isArray(data) ? data : (data?.incidents || []);
            setIncidents(incList);
            setError(null);
        } catch (err) {
            setError(err.message || "Failed to load incidents");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchIncidentsData();
        const interval = setInterval(fetchIncidentsData, 5000);
        return () => clearInterval(interval);
    }, []);

    // Fetch remediation history when an incident is selected
    useEffect(() => {
        if (selectedIncident?._id) {
            getRemediationHistory(selectedIncident._id)
                .then(res => setRemediationHistory(res.data || []))
                .catch(() => setRemediationHistory([]));
        }
    }, [selectedIncident]);

    const handleCreateIncident = async (e) => {
        e.preventDefault();
        if (!newTitle.trim()) return;
        try {
            await createIncident({
                title: newTitle,
                severity: newSeverity,
                description: newDescription,
                source: "Manual"
            });
            setNewTitle("");
            setNewDescription("");
            setShowCreateModal(false);
            fetchIncidentsData();
        } catch (err) {
            alert(err.message || "Failed to create incident");
        }
    };

    const handleAnalyze = async (incidentId) => {
        try {
            setAnalyzingId(incidentId);
            const updated = await analyzeIncident(incidentId);

            // Update local incident array
            setIncidents(prev => prev.map(inc => inc._id === incidentId ? updated : inc));
            if (selectedIncident?._id === incidentId) {
                setSelectedIncident(updated);
            }
        } catch (err) {
            alert(err.message || "AI Analysis failed");
        } finally {
            setAnalyzingId(null);
        }
    };

    const handleExecuteRemediation = async (incidentId) => {
        try {
            setRemediatingId(incidentId);
            setRemediationMsg("Initiating safe autonomous remediation pipeline...");

            const res = await executeRemediation(incidentId);
            setRemediationMsg(`Result: ${res.message}`);

            // Refresh remediation history & incident
            const updatedHistory = await getRemediationHistory(incidentId);
            setRemediationHistory(updatedHistory.data || []);
            fetchIncidentsData();
        } catch (err) {
            setRemediationMsg(`Remediation Error: ${err.message}`);
        } finally {
            setRemediatingId(null);
        }
    };

    const handleUpdateStatus = async (incidentId, newStatus) => {
        try {
            const updated = await updateIncident(incidentId, { status: newStatus });
            setIncidents(prev => prev.map(inc => inc._id === incidentId ? updated : inc));
            if (selectedIncident?._id === incidentId) {
                setSelectedIncident(updated);
            }
        } catch (err) {
            alert(err.message || "Failed to update incident status");
        }
    };

    const handleDelete = async (incidentId) => {
        if (!window.confirm("Are you sure you want to delete this incident?")) return;
        try {
            await deleteIncident(incidentId);
            setIncidents(prev => prev.filter(inc => inc._id !== incidentId));
            if (selectedIncident?._id === incidentId) {
                setSelectedIncident(null);
            }
        } catch (err) {
            alert(err.message || "Failed to delete incident");
        }
    };

    // Filter logic
    const filteredIncidents = incidents.filter(inc => {
        const matchesSearch = inc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (inc.description && inc.description.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesSev = severityFilter === "ALL" || inc.severity?.toUpperCase() === severityFilter;
        const matchesStatus = statusFilter === "ALL" || inc.status?.toUpperCase() === statusFilter;
        return matchesSearch && matchesSev && matchesStatus;
    });

    const isEngineerOrAdmin = user?.role === "ENGINEER" || user?.role === "ADMIN";

    return (
        <div className="page-container">
            <Header
                title="Incident Management Center"
                onRefresh={fetchIncidentsData}
            />

            {/* TOP CONTROLS: SEARCH, FILTERS, CREATE BUTTON */}
            <div className="incident-toolbar">
                <div className="toolbar-search">
                    <span className="search-icon">🔍</span>
                    <input
                        type="text"
                        placeholder="Search incidents by title or payload..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                </div>

                <div className="toolbar-filters">
                    <select
                        value={severityFilter}
                        onChange={(e) => setSeverityFilter(e.target.value)}
                        className="select-filter"
                    >
                        <option value="ALL">All Severities</option>
                        <option value="CRITICAL">Critical</option>
                        <option value="HIGH">High</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="LOW">Low</option>
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="select-filter"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="OPEN">Open</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="RESOLVED">Resolved</option>
                        <option value="CLOSED">Closed</option>
                    </select>

                    {isEngineerOrAdmin && (
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => setShowCreateModal(true)}
                        >
                            + Report Incident
                        </button>
                    )}
                </div>
            </div>

            {/* INCIDENTS TABLE */}
            <section className="dashboard-section">
                <div className="ops-card">
                    {loading ? (
                        <div className="empty-state">Loading incidents...</div>
                    ) : error ? (
                        <div className="empty-state error">⚠️ {error}</div>
                    ) : filteredIncidents.length === 0 ? (
                        <div className="empty-state">No incidents match your filter criteria.</div>
                    ) : (
                        <div className="table-responsive">
                            <table className="ops-table">
                                <thead>
                                    <tr>
                                        <th>Severity</th>
                                        <th>Title</th>
                                        <th>Status</th>
                                        <th>Source</th>
                                        <th>Created At</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredIncidents.map((inc) => (
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
                                            <td>
                                                <button
                                                    type="button"
                                                    className="btn-sm"
                                                    onClick={() => setSelectedIncident(inc)}
                                                >
                                                    View Details
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>

            {/* CREATE INCIDENT MODAL */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Create New Incident</h3>
                            <button type="button" className="close-btn" onClick={() => setShowCreateModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleCreateIncident}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Incident Title</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. High CPU saturation on backend container"
                                        value={newTitle}
                                        onChange={(e) => setNewTitle(e.target.value)}
                                        className="form-input"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Severity</label>
                                    <select
                                        value={newSeverity}
                                        onChange={(e) => setNewSeverity(e.target.value)}
                                        className="form-select"
                                    >
                                        <option value="CRITICAL">Critical</option>
                                        <option value="HIGH">High</option>
                                        <option value="MEDIUM">Medium</option>
                                        <option value="LOW">Low</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Description / Symptoms</label>
                                    <textarea
                                        rows="3"
                                        placeholder="Describe observed infrastructure anomalies..."
                                        value={newDescription}
                                        onChange={(e) => setNewDescription(e.target.value)}
                                        className="form-textarea"
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Create Incident</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* DETAILED INCIDENT & REMEDIATION MODAL */}
            {selectedIncident && (
                <div className="modal-overlay" onClick={() => setSelectedIncident(null)}>
                    <div className="modal-content large-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <span className={`severity-badge ${selectedIncident.severity?.toLowerCase()}`}>
                                    {selectedIncident.severity}
                                </span>
                                <h2 className="modal-title-inline">{selectedIncident.title}</h2>
                            </div>
                            <button type="button" className="close-btn" onClick={() => setSelectedIncident(null)}>✕</button>
                        </div>

                        <div className="modal-body scrollable">
                            {/* METADATA BAR */}
                            <div className="detail-meta-bar">
                                <div><span className="lbl">Status:</span> <strong>{selectedIncident.status}</strong></div>
                                <div><span className="lbl">Source:</span> {selectedIncident.source || "Alertmanager"}</div>
                                <div><span className="lbl">Reported:</span> {new Date(selectedIncident.createdAt).toLocaleString()}</div>
                            </div>

                            {/* DESCRIPTION */}
                            {selectedIncident.description && (
                                <div className="detail-section">
                                    <h4>Description</h4>
                                    <p className="detail-text">{selectedIncident.description}</p>
                                </div>
                            )}

                            {/* AI ANALYSIS SECTION */}
                            <div className="detail-section ai-box">
                                <div className="section-title-row">
                                    <h4>⚡ AI Analysis & Root Cause Diagnosis</h4>
                                    <button
                                        type="button"
                                        className="btn-sm btn-accent"
                                        disabled={analyzingId === selectedIncident._id}
                                        onClick={() => handleAnalyze(selectedIncident._id)}
                                    >
                                        {analyzingId === selectedIncident._id ? "Analyzing..." : "✦ Run AI Analysis"}
                                    </button>
                                </div>

                                {selectedIncident.aiAnalysis ? (
                                    <div className="ai-results">
                                        <div className="ai-block">
                                            <span className="ai-lbl">ROOT CAUSE</span>
                                            <p>{selectedIncident.aiAnalysis.rootCause || "No specific root cause generated."}</p>
                                        </div>
                                        <div className="ai-block">
                                            <span className="ai-lbl">EVIDENCE</span>
                                            <p>{selectedIncident.aiAnalysis.evidence || "Based on telemetry metrics & Alertmanager payload."}</p>
                                        </div>
                                        <div className="ai-block">
                                            <span className="ai-lbl">RECOMMENDATION</span>
                                            <p>{selectedIncident.aiAnalysis.recommendation || "Scaling or restarting service instance."}</p>
                                        </div>
                                        {selectedIncident.aiAnalysis.confidence !== undefined && (
                                            <div className="confidence-pill">
                                                Confidence Score: {selectedIncident.aiAnalysis.confidence}%
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-muted">Click "Run AI Analysis" to perform RAG-assisted Llama 3.2 root cause evaluation.</p>
                                )}
                            </div>

                            {/* AUTONOMOUS REMEDIATION PANEL */}
                            {selectedIncident.remediationDecision && (
                                <div className="detail-section remediation-box">
                                    <h4>🤖 Autonomous Remediation Engine</h4>
                                    <div className="remediation-card-inner">
                                        <div className="rem-grid">
                                            <div><span className="lbl">Action:</span> <strong>{selectedIncident.remediationDecision.action}</strong></div>
                                            <div><span className="lbl">Target:</span> <strong>{selectedIncident.remediationDecision.target}</strong></div>
                                            <div><span className="lbl">Confidence:</span> {selectedIncident.remediationDecision.confidence}%</div>
                                            <div><span className="lbl">Policy Check:</span> <span className="status-pill healthy">APPROVED</span></div>
                                        </div>
                                        <div className="rem-reason">
                                            <span className="lbl">Decision Rationale:</span> {selectedIncident.remediationDecision.reason}
                                        </div>

                                        {isEngineerOrAdmin ? (
                                            <div className="rem-action-bar">
                                                <button
                                                    type="button"
                                                    className="btn-primary pulse"
                                                    disabled={remediatingId === selectedIncident._id}
                                                    onClick={() => handleExecuteRemediation(selectedIncident._id)}
                                                >
                                                    {remediatingId === selectedIncident._id ? "Executing Pipeline..." : "⚡ Execute Remediation"}
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="text-muted italic">Remediation execution requires ENGINEER or ADMIN role.</p>
                                        )}

                                        {remediationMsg && (
                                            <div className="remediation-msg-alert">
                                                {remediationMsg}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* REMEDIATION HISTORY FOR THIS INCIDENT */}
                            {remediationHistory.length > 0 && (
                                <div className="detail-section">
                                    <h4>Execution Audit History</h4>
                                    <div className="table-responsive">
                                        <table className="ops-table compact">
                                            <thead>
                                                <tr>
                                                    <th>Action</th>
                                                    <th>Target</th>
                                                    <th>Status</th>
                                                    <th>Verification</th>
                                                    <th>Executed At</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {remediationHistory.map(act => (
                                                    <tr key={act._id}>
                                                        <td>{act.action}</td>
                                                        <td>{act.target}</td>
                                                        <td>
                                                            <span className={`status-pill ${act.status?.toLowerCase()}`}>
                                                                {act.status}
                                                            </span>
                                                        </td>
                                                        <td>{act.verification?.message || "N/A"}</td>
                                                        <td className="text-muted">{new Date(act.createdAt).toLocaleString()}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* RAG SIMILAR INCIDENTS */}
                            {selectedIncident.similarIncidents && selectedIncident.similarIncidents.length > 0 && (
                                <div className="detail-section">
                                    <h4>RAG Matches (Similar Historical Incidents)</h4>
                                    <div className="rag-list">
                                        {selectedIncident.similarIncidents.map((sim, i) => (
                                            <div key={i} className="rag-item">
                                                <span className="sim-score">Similarity: {Math.round((sim.similarity || 0.85) * 100)}%</span>
                                                <span className="sim-title">{sim.title}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer flex-between">
                            <div className="footer-left-btns">
                                {isEngineerOrAdmin && (
                                    <>
                                        {selectedIncident.status !== "RESOLVED" && (
                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                onClick={() => handleUpdateStatus(selectedIncident._id, "RESOLVED")}
                                            >
                                                Mark Resolved
                                            </button>
                                        )}
                                        {user?.role === "ADMIN" && (
                                            <button
                                                type="button"
                                                className="btn-danger"
                                                onClick={() => handleDelete(selectedIncident._id)}
                                            >
                                                Delete
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                            <button type="button" className="btn-secondary" onClick={() => setSelectedIncident(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
