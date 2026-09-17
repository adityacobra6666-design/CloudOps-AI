import React, { useState, useEffect, useRef } from "react";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend
} from "recharts";
import { getObservabilityTelemetry } from "../services/api";
import { useTheme } from "../context/ThemeContext";
import ThemeToggle from "../components/ThemeToggle";

export default function ObservabilityPage() {
    const { theme } = useTheme();
    const isDark = theme === "dark";

    const [range, setRange] = useState("30m");
    const [telemetry, setTelemetry] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const abortControllerRef = useRef(null);

    const fetchTelemetryData = async (selectedRange, showGlobalLoading = false) => {
        if (showGlobalLoading) setLoading(true);
        setIsRefreshing(true);
        setError(null);

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        try {
            const data = await getObservabilityTelemetry(selectedRange, abortControllerRef.current.signal);
            if (data && data.success) {
                setTelemetry(data);
            } else {
                setError("Invalid telemetry response format");
            }
        } catch (err) {
            if (err.name !== "AbortError") {
                console.error("Telemetry fetch error:", err);
                setError(err.message || "Unable to retrieve telemetry");
            }
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };

    // Initial load & range change listener
    useEffect(() => {
        fetchTelemetryData(range, true);
    }, [range]);

    // Auto-refresh timer every 5 seconds
    useEffect(() => {
        const intervalId = setInterval(() => {
            fetchTelemetryData(range, false);
        }, 5000);

        return () => {
            clearInterval(intervalId);
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [range]);

    const handleRangeChange = (newRange) => {
        if (newRange !== range) {
            setRange(newRange);
        }
    };

    const handleManualRefresh = () => {
        fetchTelemetryData(range, false);
    };

    const renderCustomTooltip = ({ active, payload, label, unit }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: isDark ? "#172033" : "#FFFFFF",
                    color: isDark ? "#F8FAFC" : "#172033",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    boxShadow: isDark ? "0 4px 12px rgba(0,0,0,0.5)" : "0 4px 12px rgba(15,23,42,0.1)",
                    border: isDark ? "1px solid #263449" : "1px solid #DCE6EF",
                    fontSize: "0.85rem"
                }}>
                    <p style={{ margin: "0 0 4px 0", fontWeight: "600", color: isDark ? "#94A3B8" : "#64748B" }}>{label}</p>
                    {payload.map((entry, index) => (
                        <p key={`item-${index}`} style={{ margin: "2px 0", color: entry.color, fontWeight: "600" }}>
                            {entry.name}: {entry.value} {unit || ""}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    const getStatusClass = (status) => {
        switch (status) {
            case "Healthy": return "healthy";
            case "Warning": return "warning";
            case "Critical": return "critical";
            default: return "unknown";
        }
    };

    const getServiceDotColor = (status) => {
        switch (status) {
            case "Healthy": return "#16A34A";
            case "Degraded":
            case "Warning": return "#F59E0B";
            case "Critical": return "#DC2626";
            default: return "#64748B";
        }
    };

    const summary = telemetry?.summary || {};
    const metrics = telemetry?.metrics || {};
    const services = telemetry?.services || [];

    const gridStroke = isDark ? "#263449" : "#E2E8F0";
    const axisStroke = isDark ? "#CBD5E1" : "#64748B";

    return (
        <div className="obs-page-container">
            {/* PAGE HEADER & TOOLBAR */}
            <div className="obs-header-bar">
                <div className="obs-header-titles">
                    <h1 className="obs-page-title">Observability & Live Metrics</h1>
                    <p className="obs-page-subtitle">
                        Real-time infrastructure and application telemetry powered by Prometheus.
                    </p>
                </div>

                <div className="obs-toolbar">
                    {/* TIME RANGE SELECTOR */}
                    <div className="obs-range-group">
                        {["15m", "30m", "1h", "6h"].map((r) => (
                            <button
                                key={r}
                                type="button"
                                className={`obs-range-btn ${range === r ? "active" : ""}`}
                                onClick={() => handleRangeChange(r)}
                            >
                                {r}
                            </button>
                        ))}
                    </div>

                    {/* MANUAL REFRESH BUTTON */}
                    <button
                        type="button"
                        className="obs-refresh-btn"
                        onClick={handleManualRefresh}
                        disabled={isRefreshing}
                    >
                        <span style={{ display: "inline-block", transform: isRefreshing ? "rotate(180deg)" : "none", transition: "transform 0.5s" }}>
                            🔄
                        </span>
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                    </button>

                    <ThemeToggle />
                </div>

            </div>

            {/* GLOBAL LOADING STATE */}
            {loading ? (
                <div className="obs-chart-card" style={{ padding: "3rem", textAlign: "center", color: "#64748B" }}>
                    <div className="spinner" style={{ margin: "0 auto 1rem auto" }}></div>
                    <p style={{ fontSize: "1.1rem", fontWeight: "500" }}>Loading live telemetry...</p>
                </div>
            ) : error ? (
                <div className="obs-chart-card" style={{ padding: "3rem", textAlign: "center", color: "#DC2626", borderLeft: "4px solid #DC2626" }}>
                    <h3>Unable to retrieve telemetry</h3>
                    <p style={{ color: "#64748B", margin: "0.5rem 0 1.5rem 0" }}>{error}</p>
                    <button type="button" className="obs-refresh-btn" style={{ margin: "0 auto" }} onClick={() => fetchTelemetryData(range, true)}>
                        Retry Connection
                    </button>
                </div>
            ) : (
                <>
                    {/* TOP METRIC SUMMARY CARDS GRID */}
                    <div className="obs-metrics-grid">
                        {/* CPU CARD */}
                        <div className="obs-metric-card">
                            <div className="obs-card-top">
                                <span className="obs-metric-name">CPU Usage</span>
                                <span className={`obs-status-badge ${getStatusClass(summary.cpu?.status)}`}>
                                    {summary.cpu?.status || "Healthy"}
                                </span>
                            </div>
                            <div className="obs-metric-value-row">
                                <span className="obs-metric-value">{summary.cpu?.value ?? 0}%</span>
                            </div>
                            <div className="obs-card-bottom">
                                <span className="obs-pulse-dot"></span> Live
                            </div>
                        </div>

                        {/* MEMORY CARD */}
                        <div className="obs-metric-card">
                            <div className="obs-card-top">
                                <span className="obs-metric-name">Memory Usage</span>
                                <span className={`obs-status-badge ${getStatusClass(summary.memory?.status)}`}>
                                    {summary.memory?.status || "Healthy"}
                                </span>
                            </div>
                            <div className="obs-metric-value-row">
                                <span className="obs-metric-value">{summary.memory?.value ?? 0}%</span>
                            </div>
                            <div className="obs-card-bottom">
                                <span className="obs-pulse-dot"></span> Live
                            </div>
                        </div>

                        {/* REQUEST RATE CARD */}
                        <div className="obs-metric-card">
                            <div className="obs-card-top">
                                <span className="obs-metric-name">Request Rate</span>
                                <span className={`obs-status-badge ${getStatusClass(summary.requestRate?.status)}`}>
                                    {summary.requestRate?.status || "Healthy"}
                                </span>
                            </div>
                            <div className="obs-metric-value-row">
                                <span className="obs-metric-value">{summary.requestRate?.value ?? 0} req/s</span>
                            </div>
                            <div className="obs-card-bottom">
                                <span className="obs-pulse-dot"></span> Live
                            </div>
                        </div>

                        {/* ERROR RATE CARD */}
                        <div className="obs-metric-card">
                            <div className="obs-card-top">
                                <span className="obs-metric-name">Error Rate</span>
                                <span className={`obs-status-badge ${getStatusClass(summary.errorRate?.status)}`}>
                                    {summary.errorRate?.status || "Healthy"}
                                </span>
                            </div>
                            <div className="obs-metric-value-row">
                                <span className="obs-metric-value">{summary.errorRate?.value ?? 0}%</span>
                            </div>
                            <div className="obs-card-bottom">
                                <span className="obs-pulse-dot"></span> Live
                            </div>
                        </div>

                        {/* P95 LATENCY CARD */}
                        <div className="obs-metric-card">
                            <div className="obs-card-top">
                                <span className="obs-metric-name">P95 Latency</span>
                                <span className={`obs-status-badge ${getStatusClass(summary.p95Latency?.status)}`}>
                                    {summary.p95Latency?.status || "Healthy"}
                                </span>
                            </div>
                            <div className="obs-metric-value-row">
                                <span className="obs-metric-value">{summary.p95Latency?.value ?? 0} ms</span>
                            </div>
                            <div className="obs-card-bottom">
                                <span className="obs-pulse-dot"></span> Live
                            </div>
                        </div>

                        {/* NETWORK CARD */}
                        <div className="obs-metric-card">
                            <div className="obs-card-top">
                                <span className="obs-metric-name">Network Traffic</span>
                                <span className={`obs-status-badge ${getStatusClass(summary.network?.status)}`}>
                                    {summary.network?.status || "Healthy"}
                                </span>
                            </div>
                            <div className="obs-metric-value-row">
                                <span className="obs-metric-value">{summary.network?.value ?? 0} {summary.network?.unit || "KB/s"}</span>
                            </div>
                            <div className="obs-card-bottom">
                                <span className="obs-pulse-dot"></span> Live
                            </div>
                        </div>
                    </div>

                    {/* 6 TIME-SERIES CHARTS GRID */}
                    <div className="obs-charts-grid">
                        {/* CHART 1: CPU */}
                        <div className="obs-chart-card">
                            <div className="obs-chart-header">
                                <h3 className="obs-chart-title">CPU Usage</h3>
                                <p className="obs-chart-subtitle">Container CPU utilization over time</p>
                            </div>
                            {metrics.cpu && metrics.cpu.length > 0 ? (
                                <div style={{ width: "100%", height: 260 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={metrics.cpu} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                                            <XAxis dataKey="time" stroke={axisStroke} fontSize={12} tickLine={false} />
                                            <YAxis stroke={axisStroke} fontSize={12} unit="%" domain={[0, 100]} tickLine={false} />
                                            <Tooltip content={(props) => renderCustomTooltip({ ...props, unit: "%" })} />
                                            <Line type="monotone" dataKey="value" name="CPU Usage" stroke="#0284C7" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                                    No Prometheus data available for this time range.
                                </div>
                            )}
                        </div>

                        {/* CHART 2: MEMORY */}
                        <div className="obs-chart-card">
                            <div className="obs-chart-header">
                                <h3 className="obs-chart-title">Memory Usage</h3>
                                <p className="obs-chart-subtitle">Container memory utilization over time</p>
                            </div>
                            {metrics.memory && metrics.memory.length > 0 ? (
                                <div style={{ width: "100%", height: 260 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={metrics.memory} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                                            <XAxis dataKey="time" stroke={axisStroke} fontSize={12} tickLine={false} />
                                            <YAxis stroke={axisStroke} fontSize={12} unit="%" domain={[0, 100]} tickLine={false} />
                                            <Tooltip content={(props) => renderCustomTooltip({ ...props, unit: "%" })} />
                                            <Line type="monotone" dataKey="value" name="Memory Usage" stroke="#6366F1" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                                    No Prometheus data available for this time range.
                                </div>
                            )}
                        </div>

                        {/* CHART 3: REQUEST RATE */}
                        <div className="obs-chart-card">
                            <div className="obs-chart-header">
                                <h3 className="obs-chart-title">HTTP Request Rate</h3>
                                <p className="obs-chart-subtitle">Requests per second</p>
                            </div>
                            {metrics.requestRate && metrics.requestRate.length > 0 ? (
                                <div style={{ width: "100%", height: 260 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={metrics.requestRate} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                                            <XAxis dataKey="time" stroke={axisStroke} fontSize={12} tickLine={false} />
                                            <YAxis stroke={axisStroke} fontSize={12} unit=" req/s" tickLine={false} />
                                            <Tooltip content={(props) => renderCustomTooltip({ ...props, unit: "req/s" })} />
                                            <Line type="monotone" dataKey="value" name="Request Rate" stroke="#10B981" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                                    No Prometheus data available for this time range.
                                </div>
                            )}
                        </div>

                        {/* CHART 4: ERROR RATE */}
                        <div className="obs-chart-card">
                            <div className="obs-chart-header">
                                <h3 className="obs-chart-title">HTTP Error Rate</h3>
                                <p className="obs-chart-subtitle">Percentage of failed HTTP requests</p>
                            </div>
                            {metrics.errorRate && metrics.errorRate.length > 0 ? (
                                <div style={{ width: "100%", height: 260 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={metrics.errorRate} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                                            <XAxis dataKey="time" stroke={axisStroke} fontSize={12} tickLine={false} />
                                            <YAxis stroke={axisStroke} fontSize={12} unit="%" tickLine={false} />
                                            <Tooltip content={(props) => renderCustomTooltip({ ...props, unit: "%" })} />
                                            <Line type="monotone" dataKey="value" name="Error Rate" stroke="#EF4444" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                                    No Prometheus data available for this time range.
                                </div>
                            )}
                        </div>

                        {/* CHART 5: P95 LATENCY */}
                        <div className="obs-chart-card">
                            <div className="obs-chart-header">
                                <h3 className="obs-chart-title">P95 Request Latency</h3>
                                <p className="obs-chart-subtitle">95th percentile response latency (ms)</p>
                            </div>
                            {metrics.p95Latency && metrics.p95Latency.length > 0 ? (
                                <div style={{ width: "100%", height: 260 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={metrics.p95Latency} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                                            <XAxis dataKey="time" stroke={axisStroke} fontSize={12} tickLine={false} />
                                            <YAxis stroke={axisStroke} fontSize={12} unit=" ms" tickLine={false} />
                                            <Tooltip content={(props) => renderCustomTooltip({ ...props, unit: "ms" })} />
                                            <Line type="monotone" dataKey="value" name="P95 Latency" stroke="#F59E0B" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                                    No Prometheus data available for this time range.
                                </div>
                            )}
                        </div>

                        {/* CHART 6: NETWORK TRAFFIC */}
                        <div className="obs-chart-card">
                            <div className="obs-chart-header">
                                <h3 className="obs-chart-title">Network Traffic</h3>
                                <p className="obs-chart-subtitle">Container receive and transmit throughput (KB/s)</p>
                            </div>
                            {metrics.network && metrics.network.length > 0 ? (
                                <div style={{ width: "100%", height: 260 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={metrics.network} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                                            <XAxis dataKey="time" stroke={axisStroke} fontSize={12} tickLine={false} />
                                            <YAxis stroke={axisStroke} fontSize={12} unit=" KB/s" tickLine={false} />
                                            <Tooltip content={(props) => renderCustomTooltip({ ...props, unit: "KB/s" })} />
                                            <Legend verticalAlign="top" height={36} />
                                            <Line type="monotone" dataKey="rx" name="Receive (Rx)" stroke="#06B6D4" strokeWidth={2} dot={false} />
                                            <Line type="monotone" dataKey="tx" name="Transmit (Tx)" stroke="#8B5CF6" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                                    No Prometheus data available for this time range.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* COMPACT SERVICE HEALTH SECTION */}
                    <div className="obs-service-card">
                        <div className="obs-chart-header">
                            <h3 className="obs-chart-title">Service Health</h3>
                            <p className="obs-chart-subtitle">Real-time status of operational services</p>
                        </div>
                        <div className="obs-service-grid">
                            {services.map((svc) => (
                                <div key={svc.name} className="obs-service-item">
                                    <span className="obs-service-name">{svc.name}</span>
                                    <div className="obs-service-status-row">
                                        <span
                                            className="obs-service-dot"
                                            style={{ backgroundColor: getServiceDotColor(svc.status) }}
                                        />
                                        <span className="obs-service-status-text" style={{ color: getServiceDotColor(svc.status) }}>
                                            {svc.status}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
