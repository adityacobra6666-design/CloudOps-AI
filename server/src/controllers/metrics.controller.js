const mongoose = require("mongoose");
const axios = require("axios");
const { queryPrometheus } = require("../services/remediation/verification");
const { VERIFICATION_CONFIG } = require("../config/remediation.config");

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || VERIFICATION_CONFIG.prometheusUrl || "http://prometheus:9090";
const GRAFANA_URL = process.env.GRAFANA_URL || "http://grafana:3000";
const ALERTMANAGER_URL = process.env.ALERTMANAGER_URL || "http://alertmanager:9093";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";

// =========================================
// GET OVERVIEW METRICS
// =========================================
exports.getOverviewMetrics = async (req, res) => {
    try {
        // Query Prometheus for real metrics if available
        const cpuProm = await queryPrometheus(`100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`);
        const memProm = await queryPrometheus(`(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`);
        const reqRateProm = await queryPrometheus(`sum(rate(cloudops_http_requests_total[1m]))`);
        const errRateProm = await queryPrometheus(`(sum(rate(cloudops_http_requests_total{status_code=~"5.."}[1m])) / sum(rate(cloudops_http_requests_total[1m]))) * 100`);
        const latencyProm = await queryPrometheus(`histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) * 1000`);

        // Node process fallbacks if Prometheus metrics are not yet scraped
        const memoryUsage = process.memoryUsage();
        const memPercentProcess = Math.min(100, Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100));

        const cpuUsageVal = cpuProm !== null ? Math.round(cpuProm) : 18;
        const memoryVal = memProm !== null ? Math.round(memProm) : memPercentProcess;
        const requestRateVal = reqRateProm !== null ? parseFloat(reqRateProm.toFixed(2)) : 12;
        const errorRateVal = errRateProm !== null ? parseFloat(errRateProm.toFixed(2)) : 0;
        const latencyVal = latencyProm !== null ? Math.round(latencyProm) : 45;

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            metrics: {
                cpu: {
                    value: cpuUsageVal,
                    unit: "%",
                    status: cpuUsageVal > 85 ? "Critical" : cpuUsageVal > 70 ? "Warning" : "Healthy",
                    trend: "stable"
                },
                memory: {
                    value: memoryVal,
                    unit: "%",
                    status: memoryVal > 90 ? "Critical" : memoryVal > 75 ? "Warning" : "Healthy",
                    trend: "stable"
                },
                requestRate: {
                    value: requestRateVal,
                    unit: "req/s",
                    status: "Healthy",
                    trend: "up"
                },
                errorRate: {
                    value: errorRateVal,
                    unit: "%",
                    status: errorRateVal > 5 ? "Critical" : errorRateVal > 1 ? "Warning" : "Healthy",
                    trend: "down"
                },
                p95Latency: {
                    value: latencyVal,
                    unit: "ms",
                    status: latencyVal > 500 ? "Critical" : latencyVal > 200 ? "Warning" : "Healthy",
                    trend: "stable"
                },
                networkThroughput: {
                    value: 2.4,
                    unit: "MB/s",
                    status: "Healthy",
                    trend: "stable"
                }
            }
        });
    } catch (error) {
        console.error("Error fetching overview metrics:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch overview metrics"
        });
    }
};

// =========================================
// GET SERVICE HEALTH
// =========================================
exports.getServicesHealth = async (req, res) => {
    const services = [
        { name: "Backend", status: "Healthy" },
        { name: "MongoDB", status: mongoose.connection.readyState === 1 ? "Healthy" : "Critical" },
        { name: "Prometheus", status: "Degraded", url: PROMETHEUS_URL },
        { name: "Grafana", status: "Degraded", url: GRAFANA_URL },
        { name: "Alertmanager", status: "Degraded", url: ALERTMANAGER_URL },
        { name: "Ollama", status: "Degraded", url: OLLAMA_URL }
    ];

    // Parallel ping checks for external services
    await Promise.allSettled([
        axios.get(`${PROMETHEUS_URL}/-/healthy`, { timeout: 1500 })
            .then(() => { services.find(s => s.name === "Prometheus").status = "Healthy"; })
            .catch(() => {}),

        axios.get(`${GRAFANA_URL}/api/health`, { timeout: 1500 })
            .then(() => { services.find(s => s.name === "Grafana").status = "Healthy"; })
            .catch(() => {}),

        axios.get(`${ALERTMANAGER_URL}/-/healthy`, { timeout: 1500 })
            .then(() => { services.find(s => s.name === "Alertmanager").status = "Healthy"; })
            .catch(() => {}),

        axios.get(`${OLLAMA_URL}/api/version`, { timeout: 1500 })
            .then(() => { services.find(s => s.name === "Ollama").status = "Healthy"; })
            .catch(() => {})
    ]);

    const healthyCount = services.filter(s => s.status === "Healthy").length;
    const globalStatus = healthyCount === services.length ? "HEALTHY" : healthyCount >= 3 ? "WARNING" : "CRITICAL";

    res.json({
        success: true,
        globalStatus,
        services,
        timestamp: new Date().toISOString()
    });
};

// =========================================
// GET SYSTEM HEALTH SUMMARY
// =========================================
exports.getSystemHealth = async (req, res) => {
    const isMongoHealthy = mongoose.connection.readyState === 1;
    let isPrometheusHealthy = false;

    try {
        const resp = await axios.get(`${PROMETHEUS_URL}/-/healthy`, { timeout: 1500 });
        isPrometheusHealthy = resp.status === 200;
    } catch (err) {}

    const status = isMongoHealthy && isPrometheusHealthy ? "HEALTHY" : isMongoHealthy ? "WARNING" : "CRITICAL";

    res.json({
        success: true,
        status,
        components: {
            database: isMongoHealthy ? "HEALTHY" : "CRITICAL",
            monitoring: isPrometheusHealthy ? "HEALTHY" : "DEGRADED",
            apiServer: "HEALTHY"
        },
        timestamp: new Date().toISOString()
    });
};
