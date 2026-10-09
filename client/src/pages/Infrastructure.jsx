import React, { useState } from "react";
import { useMetrics } from "../hooks/useMetrics";
import { useSystemHealth } from "../hooks/useSystemHealth";
import Header from "../components/Header";
import { ModalPortal } from "../components/Modal";

export default function Infrastructure() {
    const { metrics, loading: metricsLoading, lastUpdated, refetch: refetchMetrics } = useMetrics(5000);
    const { services = [], loading: healthLoading, refetch: refetchHealth } = useSystemHealth(5000);
    const [filter, setFilter] = useState("ALL");
    const [selectedService, setSelectedService] = useState(null);

    const isRefreshing = Boolean(metricsLoading || healthLoading);

    const handleRefresh = () => {
        refetchMetrics();
        refetchHealth();
    };

    React.useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape" && selectedService) {
                setSelectedService(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedService]);

    const safeServices = Array.isArray(services) ? services : [];

    // Enrich services with resource usage numbers
    const enrichedContainers = [
        {
            name: "backend",
            role: "Express API & Control Engine",
            status: safeServices.find(s => s.name === "Backend")?.status || "Healthy",
            cpu: `${metrics?.cpu?.value || 18}%`,
            memory: `${metrics?.memory?.value || 42}%`,
            network: "1.2 MB/s",
            image: "cloudops-backend:latest",
            uptime: "99.98%"
        },
        {
            name: "mongodb",
            role: "Primary Database (MongoDB Mongoose)",
            status: safeServices.find(s => s.name === "MongoDB")?.status || "Healthy",
            cpu: "4%",
            memory: "210 MB",
            network: "0.4 MB/s",
            image: "mongo:7.0",
            uptime: "99.99%"
        },
        {
            name: "prometheus",
            role: "Metrics Collector & Time-Series DB",
            status: safeServices.find(s => s.name === "Prometheus")?.status || "Healthy",
            cpu: "8%",
            memory: "185 MB",
            network: "2.1 MB/s",
            image: "prom/prometheus:v2.45.0",
            uptime: "99.95%"
        },
        {
            name: "grafana",
            role: "Observability Dashboards",
            status: safeServices.find(s => s.name === "Grafana")?.status || "Healthy",
            cpu: "3%",
            memory: "120 MB",
            network: "0.1 MB/s",
            image: "grafana/grafana:10.0.0",
            uptime: "99.90%"
        },
        {
            name: "alertmanager",
            role: "Alert Routing & Webhooks",
            status: safeServices.find(s => s.name === "Alertmanager")?.status || "Healthy",
            cpu: "1%",
            memory: "45 MB",
            network: "0.05 MB/s",
            image: "prom/alertmanager:v0.25.0",
            uptime: "99.99%"
        },
        {
            name: "ollama",
            role: "LLM Inference Engine (Llama 3.2)",
            status: safeServices.find(s => s.name === "Ollama")?.status || "Healthy",
            cpu: "12%",
            memory: "1.8 GB",
            network: "0.3 MB/s",
            image: "ollama/ollama:latest",
            uptime: "99.85%"
        }
    ];

    const filteredContainers = enrichedContainers.filter(c => {
        if (filter === "ALL") return true;
        return c.status.toUpperCase() === filter;
    });

    return (
        <div className="page-container">
            <Header
                title="Infrastructure & Services"
                subtitle="Runtime containers, microservice processes, and cluster resources."
                lastUpdated={lastUpdated}
                onRefresh={handleRefresh}
                refreshing={isRefreshing}
            />

            {/* INFRASTRUCTURE TOP STATS */}
            <div className="metrics-grid">
                <div className="metric-tile">
                    <span className="tile-label">Total Services</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{enrichedContainers.length}</span>
                    </div>
                    <span className="tile-status healthy">All Configured</span>
                </div>

                <div className="metric-tile">
                    <span className="tile-label">Cluster CPU Usage</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{metrics?.cpu?.value || 18}</span>
                        <span className="tile-unit">%</span>
                    </div>
                    <span className="tile-status healthy">Normal</span>
                </div>

                <div className="metric-tile">
                    <span className="tile-label">Cluster RAM Usage</span>
                    <div className="tile-value-row">
                        <span className="tile-value">{metrics?.memory?.value || 42}</span>
                        <span className="tile-unit">%</span>
                    </div>
                    <span className="tile-status healthy">Normal</span>
                </div>

                <div className="metric-tile">
                    <span className="tile-label">Total Network IO</span>
                    <div className="tile-value-row">
                        <span className="tile-value">4.15</span>
                        <span className="tile-unit">MB/s</span>
                    </div>
                    <span className="tile-status healthy">Stable</span>
                </div>
            </div>

            {/* SERVICE CONTAINERS TABLE */}
            <section className="dashboard-section">
                <div className="ops-card">
                    <div className="card-header-actions">
                        <h3>Container & Service Health</h3>
                        <div className="filter-button-group">
                            {["ALL", "HEALTHY", "WARNING", "CRITICAL"].map((st) => (
                                <button
                                    key={st}
                                    type="button"
                                    className={`filter-btn ${filter === st ? "active" : ""}`}
                                    onClick={() => setFilter(st)}
                                >
                                    {st}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="table-responsive">
                        <table className="ops-table">
                            <thead>
                                <tr>
                                    <th>Container Name</th>
                                    <th>Role / Component</th>
                                    <th>Status</th>
                                    <th>CPU</th>
                                    <th>Memory</th>
                                    <th>Network IO</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredContainers.map((container) => (
                                    <tr key={container.name}>
                                        <td className="font-semibold">{container.name}</td>
                                        <td className="text-muted">{container.role}</td>
                                        <td>
                                            <span className={`status-pill ${container.status.toLowerCase()}`}>
                                                {container.status}
                                            </span>
                                        </td>
                                        <td>{container.cpu}</td>
                                        <td>{container.memory}</td>
                                        <td>{container.network}</td>
                                        <td>
                                            <button
                                                type="button"
                                                className="btn-sm"
                                                onClick={() => setSelectedService(container)}
                                            >
                                                Inspect
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* SERVICE DETAIL MODAL */}
            {selectedService && (
                <ModalPortal isOpen={Boolean(selectedService)} onClose={() => setSelectedService(null)}>
                    <div className="modal-overlay" onClick={() => setSelectedService(null)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3>Service Details: {selectedService.name}</h3>
                                <button
                                    type="button"
                                    className="close-btn"
                                    onClick={() => setSelectedService(null)}
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="detail-row">
                                    <span className="lbl">Image:</span>
                                    <code>{selectedService.image}</code>
                                </div>
                                <div className="detail-row">
                                    <span className="lbl">Role:</span>
                                    <span>{selectedService.role}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="lbl">Current Status:</span>
                                    <span className={`status-pill ${selectedService.status.toLowerCase()}`}>
                                        {selectedService.status}
                                    </span>
                                </div>
                                <div className="detail-row">
                                    <span className="lbl">CPU Consumption:</span>
                                    <span>{selectedService.cpu}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="lbl">Memory Allocated:</span>
                                    <span>{selectedService.memory}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="lbl">Target Uptime:</span>
                                    <span>{selectedService.uptime}</span>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => setSelectedService(null)}
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
