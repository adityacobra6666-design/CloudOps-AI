require("dotenv").config();
const path = require("path");
const os = require("os");

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
    kubeconfigPath: process.env.KUBECONFIG || path.join(os.homedir(), ".kube", "config"),
    
    // Polling & Heartbeat Intervals (ms)
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "20000", 10),
    telemetryIntervalMs: parseInt(process.env.TELEMETRY_INTERVAL_MS || "10000", 10),
    commandPollIntervalMs: parseInt(process.env.COMMAND_POLL_INTERVAL_MS || "5000", 10),

    // Defense-in-depth safety constraints
    allowedActions: ["RESTART_SERVICE", "SCALE_SERVICE"],
    allowedTargetTypes: ["deployment"],
    allowedNamespaces: (process.env.ALLOWED_NAMESPACES || "cloudops,default,production,staging")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean),
    minReplicas: parseInt(process.env.MIN_REPLICAS || "1", 10),
    maxReplicas: parseInt(process.env.MAX_REPLICAS || "10", 10)
};
