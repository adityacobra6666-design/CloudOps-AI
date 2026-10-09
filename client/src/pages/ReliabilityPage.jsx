import React, { useState, useEffect } from "react";
import { getReliabilityOverview } from "../services/api";
import Header from "../components/Header";

export default function ReliabilityPage() {
    const [reliability, setReliability] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchReliability = async () => {
        try {
            setLoading(true);
            const data = await getReliabilityOverview();
            setReliability(data);
        } catch (err) {
            console.error("Error loading reliability data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReliability();
    }, []);

    const slos = reliability?.slos;
    const errorBudget = reliability?.errorBudget;

    return (
        <div className="page-container">
            <Header
                title="Reliability & SLO Dashboard"
                subtitle="Service Level Objectives, error budget burn rates, and availability telemetry."
                onRefresh={fetchReliability}
                refreshing={loading}
            />

            {loading ? (
                <div className="slo-cards-grid">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="slo-card">
                            <div className="skeleton skeleton-title" style={{ width: "60%", height: "18px" }} />
                            <div className="skeleton skeleton-card" style={{ height: "50px", margin: "10px 0" }} />
                            <div className="skeleton skeleton-text" style={{ width: "80%" }} />
                        </div>
                    ))}
                </div>
            ) : (
                <>
                    {/* SLO CARDS GRID */}
                    <div className="slo-cards-grid">
                        <div className="slo-card">
                            <div className="slo-header">
                                <span className="slo-name">Availability SLO</span>
                                <span className={`status-pill ${slos?.availability?.status === "HEALTHY" ? "healthy" : "critical"}`}>
                                    {slos?.availability?.status || "HEALTHY"}
                                </span>
                            </div>
                            <div className="slo-value">{slos?.availability?.current}%</div>
                            <div className="slo-target">Target: ≥ {slos?.availability?.target}% ({slos?.availability?.period})</div>
                            <div className="slo-progress-bar">
                                <div
                                    className="slo-progress-fill healthy"
                                    style={{ width: `${Math.min(100, slos?.availability?.current || 99.94)}%` }}
                                />
                            </div>
                        </div>

                        <div className="slo-card">
                            <div className="slo-header">
                                <span className="slo-name">P95 Latency SLO</span>
                                <span className={`status-pill ${slos?.latency?.status === "HEALTHY" ? "healthy" : "critical"}`}>
                                    {slos?.latency?.status || "HEALTHY"}
                                </span>
                            </div>
                            <div className="slo-value">{slos?.latency?.current} ms</div>
                            <div className="slo-target">Target: ≤ {slos?.latency?.target} ms ({slos?.latency?.period})</div>
                            <div className="slo-progress-bar">
                                <div
                                    className="slo-progress-fill healthy"
                                    style={{ width: "88%" }}
                                />
                            </div>
                        </div>

                        <div className="slo-card">
                            <div className="slo-header">
                                <span className="slo-name">Error Rate SLO</span>
                                <span className={`status-pill ${slos?.errorRate?.status === "HEALTHY" ? "healthy" : "critical"}`}>
                                    {slos?.errorRate?.status || "HEALTHY"}
                                </span>
                            </div>
                            <div className="slo-value">{slos?.errorRate?.current}%</div>
                            <div className="slo-target">Target: ≤ {slos?.errorRate?.target}% ({slos?.errorRate?.period})</div>
                            <div className="slo-progress-bar">
                                <div
                                    className="slo-progress-fill healthy"
                                    style={{ width: "95%" }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* ERROR BUDGET VISUALIZATION */}
                    <section className="dashboard-section">
                        <div className="ops-card">
                            <div className="card-header">
                                <h3>30-Day Error Budget & Burn Rate</h3>
                                <span className={`status-pill ${errorBudget?.risk === "LOW" ? "healthy" : "warning"}`}>
                                    Risk Level: {errorBudget?.risk || "LOW"}
                                </span>
                            </div>

                            <div className="budget-details">
                                <div className="budget-number">
                                    <span className="big-percent">{errorBudget?.remainingPercent ?? 82}%</span>
                                    <span className="percent-label">Error Budget Remaining</span>
                                </div>

                                <div className="budget-bar-container">
                                    <div className="budget-bar">
                                        <div
                                            className="budget-fill"
                                            style={{ width: `${errorBudget?.remainingPercent ?? 82}%` }}
                                        />
                                    </div>
                                    <div className="budget-legend">
                                        <span>Used: {errorBudget?.usedPercent ?? 18}%</span>
                                        <span>Remaining: {errorBudget?.remainingPercent ?? 82}%</span>
                                    </div>
                                </div>

                                <div className="burn-rate-box">
                                    <span className="burn-title">Current Burn Rate</span>
                                    <span className="burn-value">{errorBudget?.burnRate ?? "1.2x"}</span>
                                    <span className="burn-desc">
                                        At the current burn rate, your error budget will last for the remaining 28 days of the cycle.
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* SLO HISTORY */}
                    {reliability?.history && (
                        <section className="dashboard-section">
                            <div className="ops-card">
                                <h3>Historical SLO Trend</h3>
                                <div className="table-responsive">
                                    <table className="ops-table">
                                        <thead>
                                            <tr>
                                                <th>Period</th>
                                                <th>Availability</th>
                                                <th>P95 Latency</th>
                                                <th>Error Rate</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reliability.history.map((h, i) => (
                                                <tr key={i}>
                                                    <td className="font-semibold">{h.date}</td>
                                                    <td>{h.availability}%</td>
                                                    <td>{h.latency} ms</td>
                                                    <td>{h.errorRate}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
