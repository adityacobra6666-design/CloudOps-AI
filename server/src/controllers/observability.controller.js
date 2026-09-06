const mongoose = require("mongoose");
const axios = require("axios");
const { queryInstant, queryRange, PROMETHEUS_URL } = require("../services/prometheus.service");
const { kubernetesService } = require("../services/kubernetes/kubernetes.service");

const GRAFANA_URL = process.env.GRAFANA_URL || "http://grafana:3000";
const ALERTMANAGER_URL = process.env.ALERTMANAGER_URL || "http://alertmanager:9093";
const OLLAMA_URL = process.env.OLLAMA_HOST || "http://ollama:11434";

/**
 * Range parameter helper
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

/**
 * Combined Network Rx + Tx range series generator
 */
function mergeNetworkSeries(rxSeries, txSeries) {
    const map = new Map();

    for (const item of rxSeries) {
        map.set(item.timestamp, {
            timestamp: item.timestamp,
            time: item.time,
            fullTime: item.fullTime,
            rx: item.value,
            tx: 0
        });
    }

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

    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * GET /api/observability/telemetry
 */
exports.getTelemetry = async (req, res) => {
    try {
        const { rangeKey, start, end, step } = parseRangeParams(req.query.range);

        // PromQL queries
        const qCpuInstant = `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`;
        const qMemInstant = `100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`;
        const qReqRateInstant = `sum(rate(cloudops_http_requests_total[1m]))`;
        const qErrRateInstant = `(sum(rate(cloudops_http_requests_total{status_code=~"5.."}[1m])) / clamp_min(sum(rate(cloudops_http_requests_total[1m])), 0.001)) * 100`;
        const qP95LatencyInstant = `histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) * 1000`;
        const qNetRxInstant = `sum(rate(container_network_receive_bytes_total{name=~".+"}[1m])) / 1024`;
        const qNetTxInstant = `sum(rate(container_network_transmit_bytes_total{name=~".+"}[1m])) / 1024`;

        const qCpuRange = `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`;
        const qMemRange = `100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`;
        const qReqRateRange = `sum(rate(cloudops_http_requests_total[2m]))`;
        const qErrRateRange = `(sum(rate(cloudops_http_requests_total{status_code=~"5.."}[2m])) / clamp_min(sum(rate(cloudops_http_requests_total[2m])), 0.001)) * 100`;
        const qP95LatencyRange = `histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) * 1000`;
        const qNetRxRange = `sum(rate(container_network_receive_bytes_total{name=~".+"}[1m])) / 1024`;
        const qNetTxRange = `sum(rate(container_network_transmit_bytes_total{name=~".+"}[1m])) / 1024`;

        // Execute queries in parallel
        const [
            cpuVal, memVal, reqRateVal, errRateVal, p95Val, netRxVal, netTxVal,
            cpuSeries, memSeries, reqRateSeries, errRateSeries, p95Series, netRxSeries, netTxSeries
        ] = await Promise.all([
            queryInstant(qCpuInstant),
            queryInstant(qMemInstant),
            queryInstant(qReqRateInstant),
            queryInstant(qErrRateInstant),
            queryInstant(qP95LatencyInstant),
            queryInstant(qNetRxInstant),
            queryInstant(qNetTxInstant),

            queryRange(qCpuRange, start, end, step),
            queryRange(qMemRange, start, end, step),
            queryRange(qReqRateRange, start, end, step),
            queryRange(qErrRateRange, start, end, step),
            queryRange(qP95LatencyRange, start, end, step),
            queryRange(qNetRxRange, start, end, step),
            queryRange(qNetTxRange, start, end, step)
        ]);

        // Service Health checks
        const services = [
            { name: "Backend", status: "Healthy" },
            { name: "MongoDB", status: mongoose.connection.readyState === 1 ? "Healthy" : "Critical" },
            { name: "Prometheus", status: "Unknown" },
            { name: "Alertmanager", status: "Unknown" },
            { name: "Ollama", status: "Unknown" },
            { name: "Kubernetes", status: "Unknown" }
        ];

        await Promise.allSettled([
            axios.get(`${PROMETHEUS_URL}/-/healthy`, { timeout: 1500 })
                .then(() => { services.find(s => s.name === "Prometheus").status = "Healthy"; })
                .catch(() => { services.find(s => s.name === "Prometheus").status = "Critical"; }),

            axios.get(`${ALERTMANAGER_URL}/-/healthy`, { timeout: 1500 })
                .then(() => { services.find(s => s.name === "Alertmanager").status = "Healthy"; })
                .catch(() => { services.find(s => s.name === "Alertmanager").status = "Critical"; }),

            axios.get(`${OLLAMA_URL}/api/version`, { timeout: 1500 })
                .then(() => { services.find(s => s.name === "Ollama").status = "Healthy"; })
                .catch(() => { services.find(s => s.name === "Ollama").status = "Critical"; }),

            kubernetesService.getClusterStatus()
                .then((k8sStatus) => {
                    services.find(s => s.name === "Kubernetes").status = k8sStatus.connected ? "Healthy" : "Degraded";
                })
                .catch(() => { services.find(s => s.name === "Kubernetes").status = "Critical"; })
        ]);

        const totalNetVal = (netRxVal || 0) + (netTxVal || 0);

        res.json({
            success: true,
            range: rangeKey,
            step,
            timestamp: new Date().toISOString(),
            summary: {
                cpu: {
                    value: parseFloat(cpuVal.toFixed(1)),
                    unit: "%",
                    status: cpuVal > 85 ? "Critical" : cpuVal > 70 ? "Warning" : "Healthy"
                },
                memory: {
                    value: parseFloat(memVal.toFixed(1)),
                    unit: "%",
                    status: memVal > 90 ? "Critical" : memVal > 75 ? "Warning" : "Healthy"
                },
                requestRate: {
                    value: parseFloat(reqRateVal.toFixed(2)),
                    unit: "req/s",
                    status: "Healthy"
                },
                errorRate: {
                    value: parseFloat(errRateVal.toFixed(2)),
                    unit: "%",
                    status: errRateVal > 5 ? "Critical" : errRateVal > 1 ? "Warning" : "Healthy"
                },
                p95Latency: {
                    value: Math.round(p95Val),
                    unit: "ms",
                    status: p95Val > 500 ? "Critical" : p95Val > 200 ? "Warning" : "Healthy"
                },
                network: {
                    value: totalNetVal > 1024 ? parseFloat((totalNetVal / 1024).toFixed(2)) : parseFloat(totalNetVal.toFixed(1)),
                    unit: totalNetVal > 1024 ? "MB/s" : "KB/s",
                    rx: parseFloat(netRxVal.toFixed(1)),
                    tx: parseFloat(netTxVal.toFixed(1)),
                    status: "Healthy"
                }
            },
            metrics: {
                cpu: cpuSeries,
                memory: memSeries,
                requestRate: reqRateSeries,
                errorRate: errRateSeries,
                p95Latency: p95Series,
                network: mergeNetworkSeries(netRxSeries, netTxSeries)
            },
            services
        });
    } catch (error) {
        console.error("Observability Controller Error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch observability telemetry"
        });
    }
};
