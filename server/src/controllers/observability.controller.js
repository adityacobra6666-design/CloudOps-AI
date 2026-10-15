const mongoose = require("mongoose");
const axios = require("axios");
const {
    queryInstant,
    queryRange,
    checkPrometheusHealth,
    checkGrafanaCloudHealth,
    checkLocalPrometheusHealth,
    getPrometheusConfig,
    PROMETHEUS_URL
} = require("../services/prometheus.service");
const { kubernetesService } = require("../services/kubernetes/kubernetes.service");
const geminiService = require("../services/ai/gemini.service");
const incidentController = require("./incidentController");
const Incident = require("../models/Incident");

const GRAFANA_URL = process.env.GRAFANA_URL || "http://grafana:3000";
const ALERTMANAGER_URL = process.env.ALERTMANAGER_URL || "http://alertmanager:9093";

/**
 * Range parameter helper
 * Validates and maps user-requested time ranges to duration and sampling step
 */
function parseRangeParams(rangeStr) {
    const validRanges = {
        "15m": { duration: 900, step: 15 },
        "30m": { duration: 1800, step: 30 },
        "1h": { duration: 3600, step: 60 },
        "6h": { duration: 21600, step: 360 }
    };

    const selected = validRanges[rangeStr] || validRanges["30m"];
    const now = Math.floor(Date.now() / 1000);
    const start = now - selected.duration;

    return {
        rangeKey: validRanges[rangeStr] ? rangeStr : "30m",
        start,
        end: now,
        step: selected.step
    };
}

const InfrastructureConnection = require("../models/infrastructureConnection.model");
const { computeFreshStatus, isTelemetryFresh, resolveConnection } = require("./infrastructure.controller");

/**
 * Combined Network Rx + Tx range series generator
 */
function mergeNetworkSeries(rxSeries, txSeries) {
    const map = new Map();

    if (Array.isArray(rxSeries)) {
        for (const item of rxSeries) {
            map.set(item.timestamp, {
                timestamp: item.timestamp,
                time: item.time,
                fullTime: item.fullTime,
                rx: item.value,
                tx: 0
            });
        }
    }

    if (Array.isArray(txSeries)) {
        for (const item of txSeries) {
            if (map.has(item.timestamp)) {
                map.get(item.timestamp).tx = item.value;
            } else {
                map.set(item.timestamp, {
                    timestamp: item.timestamp,
                    time: item.time,
                    fullTime: item.fullTime,
                    rx: 0,
                    tx: item.value
                });
            }
        }
    }

    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * GET /api/observability/telemetry
 */
exports.getTelemetry = async (req, res) => {
    try {
        const { connectionId } = req.query || {};

        // Resolve connection: explicit ID, or "local" / omitted resolving to connected agent
        const conn = await resolveConnection(connectionId);
        if (conn) {
                const freshStatus = computeFreshStatus(conn);
                const recordedAt = conn.telemetry?.recordedAt;
                const telemetryFresh = isTelemetryFresh(recordedAt);
                const metrics = conn.telemetry?.metrics;
                const promConnected = metrics && metrics.prometheusConnected !== false;

                const isAvailable = freshStatus === "CONNECTED" && telemetryFresh && Boolean(metrics) && promConnected;

                let providerLabel = `Agent: ${conn.name}`;
                if (freshStatus === "DISCONNECTED") {
                    providerLabel = `Agent: ${conn.name} (Disconnected)`;
                } else if (!telemetryFresh) {
                    providerLabel = `Agent: ${conn.name} (Telemetry Stale)`;
                } else if (!promConnected) {
                    providerLabel = `Agent: ${conn.name} (Prometheus Unavailable)`;
                } else {
                    providerLabel = `Agent: ${conn.name} (Connected and data fresh)`;
                }

                const safeNum = (v, fallback = 0) => {
                    const n = parseFloat(v);
                    return isNaN(n) ? fallback : n;
                };

                const cpuVal = safeNum(metrics?.cpu);
                const memVal = safeNum(metrics?.memory);
                const reqRateVal = safeNum(metrics?.requestRate);
                const errRateVal = safeNum(metrics?.errorRate);
                const p95Val = safeNum(metrics?.p95Latency);
                const netRxVal = safeNum(metrics?.networkRx);
                const netTxVal = safeNum(metrics?.networkTx);
                const totalNetVal = netRxVal + netTxVal;

                const now = Math.floor(Date.now() / 1000);
                const sampleTimes = [now - 120, now - 90, now - 60, now - 30, now];
                const makeSeries = (val) => sampleTimes.map(ts => ({
                    timestamp: ts,
                    time: new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    fullTime: new Date(ts * 1000).toISOString(),
                    value: isAvailable ? parseFloat(val.toFixed(2)) : 0
                }));

                let geminiStatus = "Not configured";
                let geminiDetails = "Missing GEMINI_API_KEY";
                try {
                    const gh = await geminiService.checkGeminiHealth();
                    if (gh.configured) {
                        geminiStatus = gh.healthy ? (gh.isMock ? "Connected (Mock)" : "Connected") : "Unavailable";
                        geminiDetails = gh.details || gh.model;
                    }
                } catch (_) {}

                const alertSecret = process.env.ALERTMANAGER_WEBHOOK_SECRET || process.env.ALERT_WEBHOOK_SECRET;
                const isGrafanaCloudAlerting = process.env.ALERTING_PROVIDER === "grafana_cloud" || 
                    (Boolean(process.env.GRAFANA_CLOUD_PROMETHEUS_URL) && process.env.ALERTING_PROVIDER !== "alertmanager");
                let hasAlert = false;
                try {
                    hasAlert = Boolean(incidentController.getLastAlertWebhookTime ? incidentController.getLastAlertWebhookTime() : null);
                    if (!hasAlert) {
                        const count = await Incident.countDocuments({
                            source: { $in: ["Prometheus Alertmanager", "Grafana", "Grafana Cloud"] }
                        });
                        hasAlert = count > 0;
                    }
                } catch (_) {}

                const alertStatus = !alertSecret ? "Not configured" : (hasAlert ? "Connected" : "Degraded");
                const alertDetails = !alertSecret ? "Webhook secret not configured" : (hasAlert ? "Webhook receiving alerts" : "Webhook configured; awaiting first alert delivery");

                const services = [
                    { name: "Backend API", status: "Connected", details: "Node.js Express API" },
                    { name: "MongoDB", status: mongoose.connection.readyState === 1 ? "Connected" : "Unavailable", details: mongoose.connection.readyState === 1 ? "Database connected" : "Database disconnected" },
                    { name: "CloudOps Agent", status: freshStatus === "CONNECTED" ? "Connected" : (freshStatus === "DEGRADED" ? "Degraded" : "Unavailable"), details: `Agent ${conn.name}` },
                    { name: "Agent Prometheus", status: (freshStatus === "CONNECTED" && promConnected) ? "Connected" : "Unavailable", details: promConnected ? "Scraping local targets" : (conn.telemetry?.metrics?.prometheusError || "Unreachable") },
                    { name: "Kubernetes Cluster", status: (conn.k8sSummary?.nodesCount || 0) > 0 ? "Connected" : "Degraded", details: `${conn.k8sSummary?.nodesCount || 0} nodes` },
                    { name: "Gemini API", status: geminiStatus, details: geminiDetails },
                    { name: isGrafanaCloudAlerting ? "Grafana Cloud Managed Alerting" : "Alertmanager", status: alertStatus, details: alertDetails }
                ];

                return res.json({
                    success: true,
                    environment: conn.environment,
                    connectionName: conn.name,
                    status: freshStatus,
                    freshStatus,
                    telemetryFresh,
                    dataStatus: isAvailable ? "CONNECTED" : (freshStatus === "DISCONNECTED" ? "DISCONNECTED" : (!telemetryFresh ? "STALE" : "PROMETHEUS_UNAVAILABLE")),
                    provider: "connected_agent",
                    providerLabel,
                    range: req.query.range || "30m",
                    timestamp: recordedAt || new Date().toISOString(),
                    summary: {
                        cpu: {
                            value: isAvailable ? parseFloat(cpuVal.toFixed(1)) : 0,
                            unit: "%",
                            status: !isAvailable ? (freshStatus === "DISCONNECTED" ? "Unavailable" : "Warning") : (cpuVal > 85 ? "Critical" : cpuVal > 70 ? "Warning" : "Healthy"),
                            available: isAvailable,
                            label: "Agent CPU"
                        },
                        memory: {
                            value: isAvailable ? parseFloat(memVal.toFixed(1)) : 0,
                            unit: "%",
                            status: !isAvailable ? (freshStatus === "DISCONNECTED" ? "Unavailable" : "Warning") : (memVal > 90 ? "Critical" : memVal > 75 ? "Warning" : "Healthy"),
                            available: isAvailable,
                            label: "Agent Memory"
                        },
                        requestRate: {
                            value: isAvailable ? parseFloat(reqRateVal.toFixed(2)) : 0,
                            unit: "req/s",
                            status: isAvailable ? "Healthy" : "Unavailable",
                            available: isAvailable
                        },
                        errorRate: {
                            value: isAvailable ? parseFloat(errRateVal.toFixed(2)) : 0,
                            unit: "%",
                            status: !isAvailable ? "Unavailable" : (errRateVal > 5 ? "Critical" : errRateVal > 1 ? "Warning" : "Healthy"),
                            available: isAvailable
                        },
                        p95Latency: {
                            value: isAvailable ? Math.round(p95Val) : 0,
                            unit: "ms",
                            status: !isAvailable ? "Unavailable" : (p95Val > 500 ? "Critical" : p95Val > 200 ? "Warning" : "Healthy"),
                            available: isAvailable
                        },
                        network: {
                            value: isAvailable ? (totalNetVal > 1024 ? parseFloat((totalNetVal / 1024).toFixed(2)) : parseFloat(totalNetVal.toFixed(1))) : 0,
                            unit: totalNetVal > 1024 ? "MB/s" : "KB/s",
                            rx: isAvailable ? parseFloat(netRxVal.toFixed(1)) : 0,
                            tx: isAvailable ? parseFloat(netTxVal.toFixed(1)) : 0,
                            status: isAvailable ? "Healthy" : "Unavailable",
                            available: isAvailable
                        }
                    },
                    metrics: {
                        cpu: makeSeries(cpuVal),
                        memory: makeSeries(memVal),
                        requestRate: makeSeries(reqRateVal),
                        errorRate: makeSeries(errRateVal),
                        p95Latency: makeSeries(p95Val),
                        network: sampleTimes.map(ts => ({
                            timestamp: ts,
                            time: new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                            fullTime: new Date(ts * 1000).toISOString(),
                            rx: isAvailable ? parseFloat(netRxVal.toFixed(1)) : 0,
                            tx: isAvailable ? parseFloat(netTxVal.toFixed(1)) : 0
                        }))
                    },
                    services
                });
            }

        const { rangeKey, start, end, step } = parseRangeParams(req.query.range);
        const config = getPrometheusConfig();

        // 1. Metric Queries Definition
        // Host queries
        const qHostCpuInstant = `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`;
        const qHostCpuRange = `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`;
        const qProcessCpuInstant = `sum(rate(process_cpu_seconds_total[1m])) * 100`;
        const qProcessCpuRange = `sum(rate(process_cpu_seconds_total[1m])) * 100`;

        const qHostMemInstant = `100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`;
        const qHostMemRange = `100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`;
        const qProcessMemInstant = `100 * (nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes)`;
        const qProcessMemRange = `100 * (nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes)`;

        // Application HTTP queries (rates in req/s, error rate %, latency in ms)
        const qReqRateInstant = `sum(rate(cloudops_http_requests_total[1m]))`;
        const qReqRateRange = `sum(rate(cloudops_http_requests_total[2m]))`;

        // If requests exist, compute 5xx percentage (0% if no 5xx); if no requests exist at all, expression yields no data
        const qErrRateInstant = `((sum(rate(cloudops_http_requests_total{status_code=~"5.."}[1m])) or (0 * sum(rate(cloudops_http_requests_total[1m])))) / sum(rate(cloudops_http_requests_total[1m]))) * 100`;
        const qErrRateRange = `((sum(rate(cloudops_http_requests_total{status_code=~"5.."}[2m])) or (0 * sum(rate(cloudops_http_requests_total[2m])))) / sum(rate(cloudops_http_requests_total[2m]))) * 100`;

        const qP95LatencyInstant = `histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) * 1000`;
        const qP95LatencyRange = `histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) * 1000`;

        // Container network queries (KB/s)
        const qNetRxInstant = `sum(rate(container_network_receive_bytes_total{name=~".+"}[1m])) / 1024`;
        const qNetTxInstant = `sum(rate(container_network_transmit_bytes_total{name=~".+"}[1m])) / 1024`;
        const qNetRxRange = `sum(rate(container_network_receive_bytes_total{name=~".+"}[1m])) / 1024`;
        const qNetTxRange = `sum(rate(container_network_transmit_bytes_total{name=~".+"}[1m])) / 1024`;

        // 2. Execute Prometheus queries in parallel with fault tolerance
        let queryResults = {};
        let providerError = config.isValid ? null : config.configError;

        if (config.isValid) {
            const queryKeys = [
                "hostCpuInstant", "procCpuInstant",
                "hostMemInstant", "procMemInstant",
                "reqRateInstant", "errRateInstant", "p95Instant",
                "netRxInstant", "netTxInstant",
                "hostCpuRange", "procCpuRange",
                "hostMemRange", "procMemRange",
                "reqRateRange", "errRateRange", "p95Range",
                "netRxRange", "netTxRange"
            ];

            const promises = [
                queryInstant(qHostCpuInstant),
                queryInstant(qProcessCpuInstant),
                queryInstant(qHostMemInstant),
                queryInstant(qProcessMemInstant),
                queryInstant(qReqRateInstant),
                queryInstant(qErrRateInstant),
                queryInstant(qP95LatencyInstant),
                queryInstant(qNetRxInstant),
                queryInstant(qNetTxInstant),
                queryRange(qHostCpuRange, start, end, step),
                queryRange(qProcessCpuRange, start, end, step),
                queryRange(qHostMemRange, start, end, step),
                queryRange(qProcessMemRange, start, end, step),
                queryRange(qReqRateRange, start, end, step),
                queryRange(qErrRateRange, start, end, step),
                queryRange(qP95LatencyRange, start, end, step),
                queryRange(qNetRxRange, start, end, step),
                queryRange(qNetTxRange, start, end, step)
            ];

            const settled = await Promise.allSettled(promises);
            settled.forEach((res, idx) => {
                const key = queryKeys[idx];
                if (res.status === "fulfilled") {
                    queryResults[key] = res.value;
                } else {
                    queryResults[key] = key.endsWith("Range") ? [] : null;
                    if (!providerError) {
                        providerError = res.reason?.message || "Prometheus query failed";
                    }
                }
            });
        }

        // 3. Process CPU metric (Host > Process fallback > Unavailable)
        let cpuValue = null;
        let cpuLabel = "CPU Usage";
        let cpuSeries = [];
        if (queryResults.hostCpuInstant !== null && queryResults.hostCpuInstant !== undefined) {
            cpuValue = queryResults.hostCpuInstant;
            cpuLabel = "Host CPU";
            cpuSeries = queryResults.hostCpuRange || [];
        } else if (queryResults.procCpuInstant !== null && queryResults.procCpuInstant !== undefined) {
            cpuValue = queryResults.procCpuInstant;
            cpuLabel = "Process CPU";
            cpuSeries = queryResults.procCpuRange || [];
        }

        // 4. Process Memory metric (Host > Process Heap fallback > Unavailable)
        let memValue = null;
        let memLabel = "Memory Usage";
        let memSeries = [];
        if (queryResults.hostMemInstant !== null && queryResults.hostMemInstant !== undefined) {
            memValue = queryResults.hostMemInstant;
            memLabel = "Host Memory";
            memSeries = queryResults.hostMemRange || [];
        } else if (queryResults.procMemInstant !== null && queryResults.procMemInstant !== undefined) {
            memValue = queryResults.procMemInstant;
            memLabel = "Process Heap";
            memSeries = queryResults.procMemRange || [];
        }

        // 5. Process Request Rate
        const reqRateValue = queryResults.reqRateInstant !== null && queryResults.reqRateInstant !== undefined ? queryResults.reqRateInstant : null;
        const reqRateSeries = queryResults.reqRateRange || [];

        // 6. Process Error Rate
        const errRateValue = queryResults.errRateInstant !== null && queryResults.errRateInstant !== undefined ? queryResults.errRateInstant : null;
        const errRateSeries = queryResults.errRateRange || [];

        // 7. Process P95 Latency
        const p95Value = queryResults.p95Instant !== null && queryResults.p95Instant !== undefined && !isNaN(queryResults.p95Instant) ? queryResults.p95Instant : null;
        const p95Series = queryResults.p95Range || [];

        // 8. Process Container Network
        const netRxValue = queryResults.netRxInstant !== null && queryResults.netRxInstant !== undefined ? queryResults.netRxInstant : null;
        const netTxValue = queryResults.netTxInstant !== null && queryResults.netTxInstant !== undefined ? queryResults.netTxInstant : null;
        const netRxSeries = queryResults.netRxRange || [];
        const netTxSeries = queryResults.netTxRange || [];
        const netMerged = mergeNetworkSeries(netRxSeries, netTxSeries);

        let totalNetVal = null;
        if (netRxValue !== null || netTxValue !== null) {
            totalNetVal = (netRxValue || 0) + (netTxValue || 0);
        }

        // Helper to format numeric values safely
        const round = (val, dec = 1) => (val !== null && isFinite(val) ? parseFloat(val.toFixed(dec)) : null);

        // Detect Grafana Cloud connected but missing data ingestion
        if (config.isCloud && !providerError && cpuValue === null && memValue === null && reqRateValue === null) {
            providerError = "Grafana Cloud Prometheus is connected, but has received no metric data for the selected range. Verify that Prometheus remote_write or Grafana Alloy is configured to export metrics to Grafana Cloud, or select the Connected Agent environment.";
        }

        // 9. Service Health checks
        const isRenderOrProd = Boolean(process.env.RENDER || process.env.NODE_ENV === "production");
        const cloudPromHealth = await checkGrafanaCloudHealth();
        const localPromHealth = await checkLocalPrometheusHealth(isRenderOrProd);

        let geminiHealth = { configured: false, healthy: false, details: "Missing GEMINI_API_KEY" };
        try {
            geminiHealth = await geminiService.checkGeminiHealth();
        } catch (_) {}

        const isCloudConfigured = Boolean(process.env.GRAFANA_CLOUD_PROMETHEUS_URL);
        const isGrafanaCloudAlerting = process.env.ALERTING_PROVIDER === "grafana_cloud" || 
            (isCloudConfigured && process.env.ALERTING_PROVIDER !== "alertmanager");

        const alertSecret = process.env.ALERTMANAGER_WEBHOOK_SECRET || process.env.ALERT_WEBHOOK_SECRET;
        let hasDirectAlert = false;
        try {
            hasDirectAlert = Boolean(incidentController.getLastAlertWebhookTime ? incidentController.getLastAlertWebhookTime() : null);
            if (!hasDirectAlert) {
                const count = await Incident.countDocuments({
                    source: { $in: ["Prometheus Alertmanager", "Grafana", "Grafana Cloud"] }
                });
                hasDirectAlert = count > 0;
            }
        } catch (_) {}

        let alertStatus = "Not configured";
        let alertDetails = "Webhook secret not configured";
        if (alertSecret) {
            alertStatus = hasDirectAlert ? "Connected" : "Degraded";
            alertDetails = hasDirectAlert ? "Webhook receiving alerts" : "Webhook configured; awaiting first alert delivery";
        }

        const services = [
            { name: "Backend API", status: "Connected", details: "Node.js Express API" },
            { name: "MongoDB", status: mongoose.connection.readyState === 1 ? "Connected" : "Unavailable", details: mongoose.connection.readyState === 1 ? "Database connected" : "Database disconnected" },
            {
                name: "Grafana Cloud Metrics",
                status: cloudPromHealth.configured ? (cloudPromHealth.healthy ? (totalNetVal === null && cpuValue === null ? "Degraded" : "Connected") : "Unavailable") : "Not configured",
                details: cloudPromHealth.details
            },
            {
                name: "Local Prometheus",
                status: localPromHealth.configured ? (localPromHealth.healthy ? "Connected" : "Unavailable") : "Not configured",
                details: localPromHealth.details
            },
            {
                name: isGrafanaCloudAlerting ? "Grafana Cloud Managed Alerting" : "Alertmanager",
                status: alertStatus,
                details: alertDetails
            },
            {
                name: "Gemini API",
                status: geminiHealth.configured ? (geminiHealth.healthy ? (geminiHealth.isMock ? "Connected (Mock)" : "Connected") : "Unavailable") : "Not configured",
                details: geminiHealth.details || (geminiHealth.configured ? geminiHealth.model : "Missing GEMINI_API_KEY")
            },
            { name: "Kubernetes Cluster", status: "Unavailable", details: "Checking cluster..." }
        ];

        // Ping optional services without throwing or failing main telemetry
        const optionalPings = [
            kubernetesService.getClusterStatus()
                .then((k8sStatus) => {
                    const svc = services.find(s => s.name === "Kubernetes Cluster");
                    if (svc) {
                        svc.status = k8sStatus.connected ? "Connected" : (isRenderOrProd ? "Not configured" : "Degraded");
                        svc.details = k8sStatus.context ? `Context: ${k8sStatus.context}` : (k8sStatus.connected ? "Connected" : "No cluster connected");
                    }
                })
                .catch(() => {
                    const svc = services.find(s => s.name === "Kubernetes Cluster");
                    if (svc) {
                        svc.status = isRenderOrProd ? "Not configured" : "Degraded";
                        svc.details = isRenderOrProd ? "Not configured on cloud host" : "Unreachable";
                    }
                })
        ];

        if (!isGrafanaCloudAlerting && (!isRenderOrProd || !/localhost|127\.0\.0\.1|alertmanager:9093/.test(ALERTMANAGER_URL))) {
            optionalPings.push(
                axios.get(`${ALERTMANAGER_URL}/-/healthy`, { timeout: 1500 })
                    .then(() => {
                        const svc = services.find(s => s.name === "Alertmanager");
                        if (svc) {
                            svc.status = "Connected";
                            svc.details = "Alertmanager reachable";
                        }
                    })
                    .catch(() => {})
            );
        }

        await Promise.allSettled(optionalPings);

        return res.json({
            success: true,
            provider: config.provider,
            providerLabel: config.isCloud ? "Grafana Cloud Prometheus" : "Local Prometheus",
            providerError,
            range: rangeKey,
            step,
            timestamp: new Date().toISOString(),
            summary: {
                cpu: {
                    value: round(cpuValue, 1),
                    unit: "%",
                    status: cpuValue !== null ? (cpuValue > 85 ? "Critical" : cpuValue > 70 ? "Warning" : "Healthy") : "Unavailable",
                    available: cpuValue !== null,
                    label: cpuLabel
                },
                memory: {
                    value: round(memValue, 1),
                    unit: "%",
                    status: memValue !== null ? (memValue > 90 ? "Critical" : memValue > 75 ? "Warning" : "Healthy") : "Unavailable",
                    available: memValue !== null,
                    label: memLabel
                },
                requestRate: {
                    value: round(reqRateValue, 2),
                    unit: "req/s",
                    status: reqRateValue !== null ? "Healthy" : "Unavailable",
                    available: reqRateValue !== null
                },
                errorRate: {
                    value: round(errRateValue, 2),
                    unit: "%",
                    status: errRateValue !== null ? (errRateValue > 5 ? "Critical" : errRateValue > 1 ? "Warning" : "Healthy") : "Unavailable",
                    available: errRateValue !== null
                },
                p95Latency: {
                    value: p95Value !== null ? Math.round(p95Value) : null,
                    unit: "ms",
                    status: p95Value !== null ? (p95Value > 500 ? "Critical" : p95Value > 200 ? "Warning" : "Healthy") : "Unavailable",
                    available: p95Value !== null
                },
                network: {
                    value: totalNetVal !== null ? (totalNetVal > 1024 ? round(totalNetVal / 1024, 2) : round(totalNetVal, 1)) : null,
                    unit: totalNetVal !== null && totalNetVal > 1024 ? "MB/s" : "KB/s",
                    rx: round(netRxValue, 1),
                    tx: round(netTxValue, 1),
                    status: totalNetVal !== null ? "Healthy" : "Unavailable",
                    available: totalNetVal !== null
                }
            },
            metrics: {
                cpu: cpuSeries,
                memory: memSeries,
                requestRate: reqRateSeries,
                errorRate: errRateSeries,
                p95Latency: p95Series,
                network: netMerged
            },
            services
        });
    } catch (error) {
        console.error("Observability Controller Error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch observability telemetry"
        });
    }
};
