require("dotenv").config();
const path = require("path");
const os = require("os");

function resolveKubeconfigPath(p) {
    if (!p) return path.join(os.homedir(), ".kube", "config");
    if (p.startsWith("~/") || p === "~") {
        return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
}

module.exports = {
    // CloudOps Control Plane URL
    cloudopsUrl: (process.env.CLOUDOPS_URL || "http://localhost:5000").replace(/\/+$/, ""),

    // Authentication tokens
    enrollmentToken: process.env.ENROLLMENT_TOKEN || null,
    agentToken: process.env.AGENT_TOKEN || null,
    agentId: process.env.AGENT_ID || null,

    // Metadata
    agentName: process.env.AGENT_NAME || "customer-cluster",
    agentEnvironment: process.env.AGENT_ENVIRONMENT || "production",
    version: "1.0.0",

    // Local Customer Infrastructure Services
    prometheusUrl: (process.env.PROMETHEUS_URL || "http://localhost:9090").replace(/\/+$/, ""),
    kubeconfigPath: resolveKubeconfigPath(process.env.KUBECONFIG),
    
    // Polling & Heartbeat Intervals (ms)
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "20000", 10),
    telemetryIntervalMs: parseInt(process.env.TELEMETRY_INTERVAL_MS || "10000", 10),
    commandPollIntervalMs: parseInt(process.env.COMMAND_POLL_INTERVAL_MS || "5000", 10),

    // Defense-in-depth safety constraints
    allowedActions: ["RESTART_SERVICE", "SCALE_SERVICE", "QUERY_CLUSTER"],
    allowedTargetTypes: ["deployment"],
    allowedNamespaces: (process.env.ALLOWED_NAMESPACES || "cloudops,default,production,staging")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean),
    allowedDeployments: (process.env.ALLOWED_DEPLOYMENTS || "backend,cloudops-backend,cloudops-server,cloudops-mongodb,cloudops-test,test-deployment")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean),
    statefulDeployments: (process.env.STATEFUL_DEPLOYMENTS || "cloudops-mongodb")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean),
    minReplicas: parseInt(process.env.MIN_REPLICAS || "1", 10),
    maxReplicas: parseInt(process.env.MAX_REPLICAS || "10", 10)
};
