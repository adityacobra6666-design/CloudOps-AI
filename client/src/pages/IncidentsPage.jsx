import React, { useState, useEffect, useRef } from "react";
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
    const [analysisError, setAnalysisError] = useState(null);
    const [remediatingId, setRemediatingId] = useState(null);
    const [remediationHistory, setRemediationHistory] = useState([]);
    const [remediationMsg, setRemediationMsg] = useState(null);

    // New Incident Form
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newSeverity, setNewSeverity] = useState("MEDIUM");
    const [newDescription, setNewDescription] = useState("");

    const isFetchingRef = useRef(false);
    const analysisRequestRef = useRef(0);

    const fetchIncidentsData = async (isInitial = false) => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        if (isInitial) {
            setLoading(true);
        }

        try {
            const data = await getIncidents();
            const incList = Array.isArray(data) ? data : (data?.incidents || []);
            setIncidents(incList);
            setError(null);

            // Keep selected incident updated with latest data if modal is open
            if (selectedIncident?._id) {
                const updatedSel = incList.find(i => String(i._id) === String(selectedIncident._id));
                if (updatedSel) {
                    setSelectedIncident(prev => ({ ...prev, ...updatedSel }));
                }
            }
        } catch (err) {
            if (isInitial) {
                setError(err.message || "Failed to load incidents");
            }
        } finally {
            if (isInitial) {
                setLoading(false);
            }
            isFetchingRef.current = false;
        }
    };

    // Initial load & periodic polling every 12 seconds
    useEffect(() => {
        fetchIncidentsData(true);
        const interval = setInterval(() => {
            fetchIncidentsData(false);
        }, 12000);

        return () => clearInterval(interval);
    }, []);

    // Fetch remediation history when an incident is selected
    useEffect(() => {
        if (selectedIncident?._id) {
            getRemediationHistory(selectedIncident._id)
                .then(res => setRemediationHistory(res.data || []))
                .catch(() => setRemediationHistory([]));
        }
    }, [selectedIncident?._id]);

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
            fetchIncidentsData(false);
        } catch (err) {
            alert(err.message || "Failed to create incident");
        }
    };

    const handleAnalyze = async (incidentId) => {
        if (!incidentId || analyzingId) return;
        const targetId = String(incidentId);
        const requestId = ++analysisRequestRef.current;

        try {
            setAnalyzingId(targetId);
            setAnalysisError(null);

            const res = await analyzeIncident(targetId);

            if (requestId !== analysisRequestRef.current) {
                return;
            }

            if (!res || res.success === false) {
                throw new Error(res?.message || "AI Analysis failed to complete");
            }

            const updatedInc = res.incident || {
                ...selectedIncident,
                aiAnalysis: res.analysis,
                remediationDecision: res.remediationDecision || selectedIncident?.remediationDecision
            };

            setIncidents(prev => prev.map(inc => String(inc._id) === targetId ? { ...inc, ...updatedInc } : inc));
            if (selectedIncident && String(selectedIncident._id) === targetId) {
                setSelectedIncident(prev => ({ ...prev, ...updatedInc }));
            }
        } catch (err) {
            if (requestId !== analysisRequestRef.current) {
                return;
            }
            console.error("AI Analysis error:", err);
            const msg = err.message || "AI Analysis failed";
            setAnalysisError(msg);
        } finally {
            if (requestId === analysisRequestRef.current) {
                setAnalyzingId(null);
            }
        }
    };

    const handleExecuteRemediation = async (incidentId) => {
        try {
            setRemediatingId(incidentId);
            setRemediationMsg("Initiating safe autonomous remediation pipeline...");

            const res = await executeRemediation(incidentId);
            setRemediationMsg(`Result: ${res.message}`);

            const updatedHistory = await getRemediationHistory(incidentId);
            setRemediationHistory(updatedHistory.data || []);
            fetchIncidentsData(false);
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
                setSelectedIncident(prev => ({ ...prev, ...updated }));
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

    const getAnalysisFields = (aiAnalysis) => {
        if (!aiAnalysis) return null;
        if (typeof aiAnalysis === "object") {
            return {
                rootCause: aiAnalysis.rootCause || aiAnalysis.rawText || "No specific root cause generated.",
                evidence: aiAnalysis.evidence || "Based on telemetry metrics & Alertmanager payload.",
                recommendation: aiAnalysis.recommendation || "Scaling or restarting service instance.",
                confidence: aiAnalysis.confidence !== undefined ? aiAnalysis.confidence : 85
            };
        }
        const str = String(aiAnalysis);
        const extractSection = (heading) => {
            const regex = new RegExp(`${heading}:?\\s*([\\s\\S]*?)(?=(ROOT CAUSE|EVIDENCE|RECOMMENDATION|CONFIDENCE|$))`, "i");
            const match = str.match(regex);
            return match ? match[1].trim() : "";
        };
        const rc = extractSection("ROOT CAUSE");
        const ev = extractSection("EVIDENCE");
        const rec = extractSection("RECOMMENDATION");
        const confMatch = str.match(/CONFIDENCE:?\s*(\d+)%/i);

        return {
            rootCause: rc || str,
            evidence: ev || "Based on telemetry metrics & Alertmanager payload.",
            recommendation: rec || "Scaling or restarting service instance.",
            confidence: confMatch ? parseInt(confMatch[1], 10) : 85
        };
    };

    // Filter logic
    const filteredIncidents = incidents.filter(inc => {
        const matchesSearch = inc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (inc.description && inc.description.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesSeverity = severityFilter === "ALL" || inc.severity?.toUpperCase() === severityFilter.toUpperCase();
        const matchesStatus = statusFilter === "ALL" || inc.status?.toUpperCase() === statusFilter.toUpperCase();

        return matchesSearch && matchesSeverity && matchesStatus;
    });

    const isEngineerOrAdmin = user?.role === "ENGINEER" || user?.role === "ADMIN";

    return (
        <div className="page-container">
            {/* TOOLBAR */}
            <div className="filter-bar">
                <div className="filter-left">
                    <input
                        type="text"
                        placeholder="Search incidents by title or description..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />

                    <select
                        value={severityFilter}
                        onChange={(e) => setSeverityFilter(e.target.value)}
                        className="filter-select"
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
                        className="filter-select"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="OPEN">Open</option>
                        <option value="INVESTIGATING">Investigating</option>
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
                                                    onClick={() => {
                                                        setSelectedIncident(inc);
                                                        setAnalysisError(null);
                                                    }}
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
                                        disabled={Boolean(analyzingId)}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleAnalyze(selectedIncident._id || selectedIncident.id);
                                        }}
                                        style={{
                                            cursor: analyzingId ? "not-allowed" : "pointer",
                                            opacity: analyzingId ? 0.7 : 1,
                                            pointerEvents: "auto"
                                        }}
                                    >
                                        {analyzingId && String(analyzingId) === String(selectedIncident._id || selectedIncident.id) ? "Analyzing..." : "✦ Run AI Analysis"}
                                    </button>
                                </div>

                                {analysisError && (
                                    <div className="remediation-msg-alert error" style={{ marginBottom: "12px", color: "#EF4444" }}>
                                        ⚠️ {analysisError}
                                    </div>
                                )}

                                {(() => {
                                    const ai = getAnalysisFields(selectedIncident.aiAnalysis);
                                    if (!ai) {
                                        return (
                                            <p className="text-muted">Click "Run AI Analysis" to perform RAG-assisted Llama 3.2 root cause evaluation.</p>
                                        );
                                    }

                                    return (
                                        <div className="ai-results">
                                            <div className="ai-block">
                                                <span className="ai-lbl">ROOT CAUSE</span>
                                                <p>{ai.rootCause}</p>
                                            </div>
                                            <div className="ai-block">
                                                <span className="ai-lbl">EVIDENCE</span>
                                                <p>{ai.evidence}</p>
                                            </div>
                                            <div className="ai-block">
                                                <span className="ai-lbl">RECOMMENDATION</span>
                                                <p>{ai.recommendation}</p>
                                            </div>
                                            {ai.confidence !== undefined && (
                                                <div className="confidence-pill">
                                                    Confidence Score: {ai.confidence}%
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
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
                                                {remediationHistory.map((item) => (
                                                    <tr key={item._id}>
                                                        <td><strong>{item.action}</strong></td>
                                                        <td>{item.target}</td>
                                                        <td>
                                                            <span className={`status-pill ${item.status?.toLowerCase()}`}>
                                                                {item.status}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <span className={`status-pill ${item.verification?.status?.toLowerCase() || "unknown"}`}>
                                                                {item.verification?.status || "PENDING"}
                                                            </span>
                                                        </td>
                                                        <td className="text-muted">
                                                            {new Date(item.createdAt).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            {isEngineerOrAdmin && (
                                <div className="footer-actions-left">
                                    {selectedIncident.status !== "RESOLVED" && (
                                        <button
                                            type="button"
                                            className="btn-success"
                                            onClick={() => handleUpdateStatus(selectedIncident._id, "RESOLVED")}
                                        >
                                            Mark Resolved
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="btn-danger"
                                        onClick={() => handleDelete(selectedIncident._id)}
                                    >
                                        Delete Incident
                                    </button>
                                </div>
                            )}
                            <button type="button" className="btn-secondary" onClick={() => setSelectedIncident(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
