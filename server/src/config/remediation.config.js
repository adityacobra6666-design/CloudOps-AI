// =========================================
// REMEDIATION CONFIGURATION
// =========================================

// Allowed remediation actions (whitelist)
const ALLOWED_ACTIONS = [
    "RESTART_SERVICE",
    "SCALE_SERVICE"
];


// Allowed remediation targets (whitelist)
// Maps logical target names → Docker container / K8s deployment names
const ALLOWED_TARGETS = {
    "cloudops-server": {
        container: "cloudops-server",
        deployment: "cloudops-backend",
        displayName: "CloudOps Backend",
        healthEndpoint: "http://server:5000/",
        prometheusJob: "cloudops-server"
    },
    "backend": {
        container: "cloudops-server",
        deployment: "cloudops-backend",
        displayName: "Backend Deployment",
        healthEndpoint: "http://server:5000/",
        prometheusJob: "cloudops-server"
    },
    "cloudops-backend": {
        container: "cloudops-server",
        deployment: "cloudops-backend",
        displayName: "CloudOps Backend Deployment",
        healthEndpoint: "http://server:5000/",
        prometheusJob: "cloudops-server"
    }
};

// Kubernetes integration configuration
const KUBERNETES_CONFIG = {
    enabled: process.env.KUBERNETES_ENABLED !== "false",
    defaultNamespace: process.env.KUBERNETES_NAMESPACE || "cloudops",
    minReplicas: 1,
    maxReplicas: 10,
    allowedNamespaces: ["cloudops", "default"],
    allowedDeployments: ["backend", "cloudops-backend", "cloudops-server"]
};


// Remediation statuses
const REMEDIATION_STATUS = {
    PENDING: "PENDING",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    EXECUTING: "EXECUTING",
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
    UNVERIFIED: "UNVERIFIED"
};


// Verification configuration
const VERIFICATION_CONFIG = {
    // Seconds to wait after execution before verifying
    waitSeconds: 15,

    // Maximum seconds to wait for verification
    timeoutSeconds: 30,

    // Prometheus base URL
    prometheusUrl:
        process.env.PROMETHEUS_URL ||
        "http://localhost:9090"
};


// Prometheus metric queries for verification
const METRIC_QUERIES = {
    cpu: {
        query: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))',
        threshold: 80,
        unit: "%",
        label: "CPU"
    },

    service_up: {
        query: 'up{job="cloudops-server"}',
        threshold: 1,
        unit: "",
        label: "Service Status"
    },

    http_error_rate: {
        query: '(sum(rate(cloudops_http_requests_total{status_code=~"5.."}[2m])) / clamp_min(sum(rate(cloudops_http_requests_total[2m])),0.001)) * 100',
        threshold: 5,
        unit: "%",
        label: "HTTP Error Rate"
    }
};


// Policy rules: map alert conditions to allowed actions
const POLICY_RULES = [
    {
        name: "cpu_saturation",
        match: {
            keywords: [
                "cpu", "cpu saturation",
                "high cpu", "cpu usage",
                "cpu utilization"
            ],
            severities: ["critical", "warning"]
        },
        allowedActions: ["SCALE_SERVICE", "RESTART_SERVICE"],
        verifyMetric: "cpu"
    },

    {
        name: "service_down",
        match: {
            keywords: [
                "down", "unreachable",
                "unresponsive", "not reachable",
                "backend down", "service down",
                "health check"
            ],
            severities: ["critical"]
        },
        allowedActions: ["RESTART_SERVICE"],
        verifyMetric: "service_up"
    },

    {
        name: "high_error_rate",
        match: {
            keywords: [
                "error rate", "5xx",
                "http error", "500",
                "server error"
            ],
            severities: ["critical", "warning"]
        },
        allowedActions: ["RESTART_SERVICE"],
        verifyMetric: "http_error_rate"
    },

    {
        name: "high_memory",
        match: {
            keywords: [
                "memory", "oom",
                "out of memory",
                "memory usage",
                "memory high"
            ],
            severities: ["critical", "warning"]
        },
        allowedActions: ["RESTART_SERVICE", "SCALE_SERVICE"],
        verifyMetric: "cpu"
    }
];


module.exports = {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS,
    KUBERNETES_CONFIG,
    REMEDIATION_STATUS,
    VERIFICATION_CONFIG,
    METRIC_QUERIES,
    POLICY_RULES
};

