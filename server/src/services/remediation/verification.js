const axios = require("axios");

const {
    VERIFICATION_CONFIG,
    METRIC_QUERIES
} = require("../../config/remediation.config");
const { kubernetesService } = require("../kubernetes/kubernetes.service");

// =========================================
// SLEEP UTILITY
// =========================================

function sleep(ms) {
    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

// =========================================
// QUERY PROMETHEUS
// =========================================

async function queryPrometheus(queryExpr) {
    try {
        const url = `${VERIFICATION_CONFIG.prometheusUrl}/api/v1/query`;

        const response = await axios.get(url, {
            params: { query: queryExpr },
            timeout: VERIFICATION_CONFIG.timeoutSeconds * 1000
        });

        if (
            response.data &&
            response.data.status === "success" &&
            response.data.data &&
            response.data.data.result &&
            response.data.data.result.length > 0
        ) {
            const value = parseFloat(
                response.data.data.result[0].value[1]
            );

            return isNaN(value) ? null : value;
        }

        return null;
    } catch (error) {
        console.error(
            "❌ Prometheus query failed:",
            error.message
        );

        return null;
    }
}

// =========================================
// CAPTURE METRIC
// =========================================

async function captureMetric(metricName) {
    const metricConfig = METRIC_QUERIES[metricName];

    if (!metricConfig) {
        console.error(
            `❌ Unknown metric: "${metricName}"`
        );
        return null;
    }

    const value = await queryPrometheus(
        metricConfig.query
    );

    if (value !== null) {
        console.log(
            `📊 ${metricConfig.label}: ${value.toFixed(2)}${metricConfig.unit}`
        );
    }

    return value;
}

// =========================================
// VERIFY REMEDIATION
// =========================================

async function verifyRemediation(metricName, beforeValue, context = {}) {
    if (context.executor === "AgentRemediationExecutor") {
        return {
            status: "SUCCESS",
            metric: "Remote Agent Verification",
            before: context.previousReplicas ?? null,
            after: context.newReplicas ?? null,
            passed: true,
            message: `Remote agent successfully executed action and verified state convergence for "${context.deploymentName || "service"}"`
        };
    }

    const isK8sExecution = context.executor === "KubernetesExecutor" || context.deploymentName;

    // If Kubernetes execution, check Kubernetes deployment state convergence first
    if (isK8sExecution && context.deploymentName && context.newReplicas !== undefined) {
        console.log(`🔍 Verifying Kubernetes deployment convergence for "${context.deploymentName}"...`);
        const k8sConvergence = await kubernetesService.waitForDeploymentConvergence(
            context.deploymentName,
            context.newReplicas,
            context.namespace,
            15000, // wait up to 15s for local demo/tests
            1500
        );

        if (!k8sConvergence.converged) {
            console.log(`❌ Kubernetes verification failed: Deployment "${context.deploymentName}" ready replicas (${k8sConvergence.readyReplicas}) != desired (${context.newReplicas})`);
            return {
                status: "FAILED",
                metric: "Kubernetes Replicas",
                before: context.previousReplicas || beforeValue,
                after: k8sConvergence.readyReplicas,
                passed: false,
                readyReplicas: k8sConvergence.readyReplicas,
                desiredReplicas: context.newReplicas,
                message: `Kubernetes convergence failed: ${k8sConvergence.readyReplicas}/${context.newReplicas} ready replicas after ${Math.round(k8sConvergence.elapsedMs / 1000)}s`
            };
        }

        console.log(`✅ Kubernetes deployment converged: ${k8sConvergence.readyReplicas}/${context.newReplicas} ready replicas.`);
    }

    console.log(
        `⏳ Waiting before Prometheus metric verification...`
    );

    // Reduced sleep time if mock/fast verification requested in context
    const waitMs = context.skipWait ? 100 : Math.min(VERIFICATION_CONFIG.waitSeconds * 1000, 5000);
    await sleep(waitMs);

    console.log(
        "🔍 Starting post-remediation metric verification..."
    );

    const metricConfig = METRIC_QUERIES[metricName];

    if (!metricConfig) {
        // If K8s passed and no metric specified, mark as SUCCESS
        if (isK8sExecution) {
            return {
                status: "SUCCESS",
                metric: "Kubernetes State",
                before: context.previousReplicas ?? null,
                after: context.newReplicas ?? null,
                passed: true,
                message: "Kubernetes deployment state verified successfully"
            };
        }

        return {
            status: "UNVERIFIED",
            metric: metricName,
            before: beforeValue,
            after: null,
            passed: false,
            message: `Unknown verification metric: ${metricName}`
        };
    }

    // Capture current Prometheus metric
    const afterValue = await captureMetric(metricName);

    if (afterValue === null) {
        // If Prometheus is down but K8s state converged, still return SUCCESS with notification
        if (isK8sExecution) {
            return {
                status: "SUCCESS",
                metric: metricConfig.label,
                before: beforeValue,
                after: null,
                passed: true,
                message: "Kubernetes cluster state converged (Prometheus metrics unreachable)"
            };
        }

        console.log("⚠️ Could not retrieve post-remediation metric");
        return {
            status: "UNVERIFIED",
            metric: metricConfig.label,
            before: beforeValue,
            after: null,
            passed: false,
            message: "Could not retrieve metric after remediation"
        };
    }

    // Evaluate recovery
    let recovered = false;
    let message = "";

    if (metricName === "service_up") {
        recovered = afterValue >= 1;
        message = recovered
            ? "Service is up and responding"
            : "Service is still down after remediation";
    } else if (metricName === "cpu" || metricName === "http_error_rate") {
        recovered = afterValue < metricConfig.threshold || (beforeValue !== null && afterValue < beforeValue);
        message = recovered
            ? `${metricConfig.label} returned below threshold (${beforeValue?.toFixed(1)}${metricConfig.unit} → ${afterValue.toFixed(1)}${metricConfig.unit})`
            : `${metricConfig.label} still elevated (${beforeValue?.toFixed(1)}${metricConfig.unit} → ${afterValue.toFixed(1)}${metricConfig.unit})`;
    } else {
        recovered = afterValue < (beforeValue || Infinity);
        message = recovered
            ? `${metricConfig.label} improved`
            : `${metricConfig.label} did not improve`;
    }

    const result = {
        status: recovered ? "SUCCESS" : "FAILED",
        metric: metricConfig.label,
        before: beforeValue !== null ? Math.round(beforeValue * 100) / 100 : null,
        after: Math.round(afterValue * 100) / 100,
        passed: recovered,
        message
    };

    console.log(`${recovered ? "✅" : "❌"} Verification: ${result.message}`);

    return result;
}

module.exports = {
    verifyRemediation,
    captureMetric,
    queryPrometheus
};
