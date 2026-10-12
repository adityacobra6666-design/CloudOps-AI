/**
 * CloudOps AI — Incident Detection Rules & Threshold Configuration
 * Centralized, configurable operational thresholds for automatic incident intelligence
 */

module.exports = {
    // Detector Engine Lifecycle & Policy Configuration
    DETECTOR_CONFIG: {
        enabled: process.env.INCIDENT_DETECTION_ENABLED !== "false",
        intervalSeconds: Math.max(10, parseInt(process.env.INCIDENT_DETECTION_INTERVAL_SECONDS || "30", 10)),
        consecutiveBreachesRequired: Math.max(1, parseInt(process.env.INCIDENT_CONSECUTIVE_BREACHES || "2", 10)),
        evaluationTimeoutMs: 8000
    },

    // Detection Rules Catalog
    RULES: {
        high_cpu: {
            id: "high_cpu",
            title: "High CPU Usage",
            metricKey: "cpu",
            unit: "%",
            category: "infrastructure",
            warningThreshold: 70,
            criticalThreshold: 85,
            recoveryThreshold: 68,
            description: (val, thresh) => `CPU utilization reached ${val}% (threshold: ${thresh}%). Possible thread starvation or runaway process.`
        },
        high_memory: {
            id: "high_memory",
            title: "High Memory Usage",
            metricKey: "memory",
            unit: "%",
            category: "infrastructure",
            warningThreshold: 75,
            criticalThreshold: 90,
            recoveryThreshold: 72,
            description: (val, thresh) => `Memory utilization reached ${val}% (threshold: ${thresh}%). Risk of OOM kill or severe garbage collection stalls.`
        },
        p95_latency: {
            id: "p95_latency",
            title: "Elevated P95 Latency",
            metricKey: "p95Latency",
            unit: "ms",
            category: "performance",
            warningThreshold: 200,
            criticalThreshold: 500,
            recoveryThreshold: 180,
            description: (val, thresh) => `P95 HTTP response latency is ${val}ms (threshold: ${thresh}ms), violating API SLO.`
        },
        http_error_rate: {
            id: "http_error_rate",
            title: "Elevated HTTP Error Rate",
            metricKey: "errorRate",
            unit: "%",
            category: "application",
            warningThreshold: 5,
            criticalThreshold: 10,
            recoveryThreshold: 2,
            description: (val, thresh) => `HTTP 5xx error rate spiked to ${val}% (threshold: ${thresh}%).`
        },
        backend_health: {
            id: "backend_health",
            title: "Backend Core Health Check Failure",
            metricKey: "backendHealth",
            unit: "health",
            category: "availability",
            criticalThreshold: 0, // 0 = unhealthy, 1 = healthy
            recoveryThreshold: 1,
            description: (val, thresh) => `Core database or internal health check is failing. Backend service is degraded.`
        }
    }
};
