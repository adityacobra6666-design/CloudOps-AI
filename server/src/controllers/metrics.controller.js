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

const {
    checkPrometheusHealth,
    checkGrafanaCloudHealth,
    checkLocalPrometheusHealth,
    getPrometheusConfig
} = require("../services/prometheus.service");
const aiProvider = require("../services/ai");
const incidentController = require("./incidentController");
const Incident = require("../models/Incident");
const InfrastructureConnection = require("../models/infrastructureConnection.model");

// =========================================
// GET SERVICE HEALTH
// =========================================
exports.getServicesHealth = async (req, res) => {
    const isRenderOrProd = Boolean(process.env.RENDER || process.env.NODE_ENV === "production");

    // 1. Backend API (Self)
    const backendSvc = {
        name: "Backend",
        status: "Healthy",
        details: "Express API online"
    };

    // 2. MongoDB Database
    const isMongoHealthy = mongoose.connection.readyState === 1;
    const mongoSvc = {
        name: "MongoDB",
        status: isMongoHealthy ? "Healthy" : "Critical",
        details: isMongoHealthy ? "Database connected" : "Database disconnected"
    };

    // 3. AI Model (Provider-neutral: OpenRouter or Gemini, never exposes API keys)
    let aiStatus = "Not Configured";
    let aiDetails = "AI provider is not configured";
    let activeProvider = aiProvider.getProviderDisplayLabel();
    let activeModel = "";

    try {
        const ah = await aiProvider.checkAIHealth();
        aiStatus = ah.status; // "Connected" | "Rate Limited" | "Unavailable" | "Not Configured"
        aiDetails = ah.details;
        activeProvider = ah.providerLabel || ah.provider || activeProvider;
        activeModel = ah.model || "";
    } catch (err) {
        aiStatus = "Unavailable";
        aiDetails = err.message ? err.message.substring(0, 100) : "Failed to query AI provider";
    }

    const aiSvc = {
        name: "AI Model",
        provider: activeProvider,
        providerLabel: activeProvider,
        status: aiStatus,
        details: aiDetails,
        model: activeModel
    };

    // 4. Grafana Cloud Metrics (Checked separately from local Prometheus)
    let cloudPromStatus = "Not Configured";
    let cloudPromDetails = "Grafana Cloud credentials not configured";
    try {
        const cloudHealth = await checkGrafanaCloudHealth();
        if (cloudHealth.configured) {
            cloudPromStatus = cloudHealth.healthy ? "Healthy" : "Unavailable";
            cloudPromDetails = cloudHealth.details;
        }
    } catch (err) {
        cloudPromStatus = "Unavailable";
        cloudPromDetails = err.message ? err.message.substring(0, 100) : "Grafana Cloud check failed";
    }
    const grafanaCloudMetricsSvc = {
        name: "Grafana Cloud Metrics",
        status: cloudPromStatus,
        details: cloudPromDetails
    };

    // 5. Local Prometheus (Preserved for local development environments)
    let localPromSvc = null;
    let localPromStatus = "Not Configured";
    if (!isRenderOrProd) {
        let localPromDetails = "Local Prometheus not configured";
        try {
            const localHealth = await checkLocalPrometheusHealth(false);
            if (localHealth.configured) {
                localPromStatus = localHealth.healthy ? "Healthy" : "Unavailable";
                localPromDetails = localHealth.details;
            } else {
                localPromStatus = "Not Configured";
                localPromDetails = localHealth.details;
            }
        } catch (err) {
            localPromStatus = "Unavailable";
            localPromDetails = err.message ? err.message.substring(0, 100) : "Local Prometheus check failed";
        }
        localPromSvc = {
            name: "Local Prometheus",
            status: localPromStatus,
            details: localPromDetails
        };
    }

    // 6. Alerting Architecture: Grafana Cloud Managed Alerting vs Standalone Alertmanager
    const isCloudConfigured = Boolean(process.env.GRAFANA_CLOUD_PROMETHEUS_URL);
    const isGrafanaCloudAlerting = process.env.ALERTING_PROVIDER === "grafana_cloud" ||
        (isCloudConfigured && process.env.ALERTING_PROVIDER !== "alertmanager");

    const webhookSecret = process.env.ALERTMANAGER_WEBHOOK_SECRET || process.env.ALERT_WEBHOOK_SECRET;

    let alertingService = null;
    if (isGrafanaCloudAlerting) {
        const serviceName = "Grafana Cloud Managed Alerting";
        if (!webhookSecret) {
            alertingService = {
                name: serviceName,
                status: "Not Configured",
                details: "Webhook secret not configured"
            };
        } else {
            // Do not mark healthy merely because env var exists. Check actual alert traffic.
            let hasAlert = Boolean(incidentController.getLastAlertWebhookTime ? incidentController.getLastAlertWebhookTime() : null);
            if (!hasAlert) {
                try {
                    const count = await Incident.countDocuments({
                        source: { $in: ["Prometheus Alertmanager", "Grafana", "Grafana Cloud"] }
                    });
                    hasAlert = count > 0;
                } catch (_) {}
            }

            alertingService = {
                name: serviceName,
                status: hasAlert ? "Healthy" : "Degraded",
                details: hasAlert ? "Webhook connected and receiving alerts" : "Webhook listener active; awaiting first alert delivery"
            };
        }
    } else {
        const serviceName = "Alertmanager";
        const alertmanagerUrl = process.env.ALERTMANAGER_URL || "http://alertmanager:9093";
        const isLocalhost = /localhost|127\.0\.0\.1|alertmanager:9093/.test(alertmanagerUrl);

        if (isRenderOrProd && isLocalhost) {
            alertingService = {
                name: serviceName,
                status: "Not Configured",
                details: "Localhost service — not reachable on cloud host"
            };
        } else {
            let amHealthy = false;
            try {
                const res = await axios.get(`${alertmanagerUrl}/-/healthy`, { timeout: 1500 });
                amHealthy = res.status >= 200 && res.status < 300;
            } catch (_) {}

            alertingService = {
                name: serviceName,
                status: amHealthy ? "Healthy" : (isLocalhost ? "Not Configured" : "Unavailable"),
                details: amHealthy ? "Reachable" : `Unreachable at ${alertmanagerUrl}`
            };
        }
    }

    // 7. Local Grafana Dashboard (Preserved for local development environments)
    let grafanaSvc = null;
    if (!isRenderOrProd) {
        const grafanaUrl = process.env.GRAFANA_URL || "http://grafana:3000";
        const isLocalhostGrafana = /localhost|127\.0\.0\.1|grafana:3000/.test(grafanaUrl);
        let grafanaStatus = "Not Configured";
        let grafanaDetails = "Localhost dashboard — not reachable on cloud host";

        try {
            const res = await axios.get(`${grafanaUrl}/api/health`, { timeout: 1500 });
            const ok = res.status >= 200 && res.status < 300;
            grafanaStatus = ok ? "Healthy" : "Unavailable";
            grafanaDetails = ok ? "Dashboard online" : "Unhealthy response";
        } catch (_) {
            grafanaStatus = isLocalhostGrafana ? "Not Configured" : "Unavailable";
            grafanaDetails = `Unreachable at ${grafanaUrl}`;
        }
        grafanaSvc = {
            name: "Grafana",
            status: grafanaStatus,
            details: grafanaDetails
        };
    }

    // Core production services list: Backend, MongoDB, AI Model, Grafana Cloud Metrics, Alerting
    const services = [
        backendSvc,
        mongoSvc,
        aiSvc,
        grafanaCloudMetricsSvc,
        alertingService
    ];

    // Local-only indicators are included only for local development environments
    if (!isRenderOrProd) {
        if (localPromSvc) services.push(localPromSvc);
        if (grafanaSvc) services.push(grafanaSvc);
    }

    // Global status evaluation
    const anyCritical = services.some(s => s.status === "Critical");
    const anyUnavailable = services.some(s => s.status === "Unavailable");
    const anyDegraded = services.some(s => s.status === "Degraded" || s.status === "Rate Limited");
    const isAiHealthy = aiSvc.status === "Connected" || aiSvc.status === "Healthy";
    const primaryHealthy = isMongoHealthy &&
        (cloudPromStatus === "Healthy" || (!isRenderOrProd && localPromStatus === "Healthy")) &&
        isAiHealthy;

    let globalStatus = "HEALTHY";
    if (!isMongoHealthy || anyCritical) {
        globalStatus = "CRITICAL";
    } else if (anyUnavailable || anyDegraded || !primaryHealthy) {
        globalStatus = "WARNING";
    }

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
        const promHealth = await checkPrometheusHealth();
        isPrometheusHealthy = promHealth.healthy;
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
