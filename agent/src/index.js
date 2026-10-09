require("dotenv").config();
const config = require("./config");
const ApiClient = require("./services/apiClient");
const PrometheusCollector = require("./collectors/prometheus");
const KubernetesCollector = require("./collectors/kubernetes");
const RemediationExecutor = require("./executor/remediation");

console.log("====================================================");
console.log("🚀 CLOUDOPS AI — REMOTE INFRASTRUCTURE AGENT");
console.log(`   Version:      ${config.version}`);
console.log(`   Control Plane: ${config.cloudopsUrl}`);
console.log(`   Environment:  ${config.agentEnvironment}`);
console.log(`   Prometheus:   ${config.prometheusUrl}`);
console.log("====================================================");

async function startAgent() {
    const apiClient = new ApiClient(config);
    const promCollector = new PrometheusCollector(config.prometheusUrl);
    const k8sCollector = new KubernetesCollector(config.kubeconfigPath);
    const remediationExecutor = new RemediationExecutor(k8sCollector, config);

    // 1. Authenticate / Enroll
    let registered = Boolean(config.agentId && config.agentToken);

    if (!registered) {
        if (!config.enrollmentToken) {
            console.error("❌ [AGENT] Missing credentials! Either provide ENROLLMENT_TOKEN for new enrollment, or AGENT_ID and AGENT_TOKEN.");
            console.error("   Example: ENROLLMENT_TOKEN=cope_abc... npm start");
            process.exit(1);
        }

        try {
            console.log("⏳ [AGENT] Registering with enrollment token...");
            const regData = await apiClient.register(config.enrollmentToken, {
                k8sConnected: k8sCollector.isInitialized,
                prometheusConnected: true
            });
            registered = true;
            console.log(`✅ [AGENT] Enrolled as "${regData.agentId}"`);
        } catch (enrollErr) {
            console.error(`❌ [AGENT] Registration failed: ${enrollErr.message}`);
            console.error("   Please verify your CLOUDOPS_URL and ENROLLMENT_TOKEN and try again.");
            process.exit(1);
        }
    } else {
        console.log(`🔑 [AGENT] Using existing credentials for Agent ID: ${config.agentId}`);
    }

    // 2. Initial Heartbeat & Telemetry
    console.log("📡 [AGENT] Establishing outbound heartbeat and telemetry...");
    await apiClient.sendHeartbeat({
        k8sConnected: k8sCollector.isInitialized,
        agentName: config.agentName
    });

    // 3. Periodic Loops
    let isShuttingDown = false;

    // Heartbeat Loop (~20s)
    const heartbeatTimer = setInterval(async () => {
        if (isShuttingDown || apiClient.isRevoked) return;
        try {
            await apiClient.sendHeartbeat({
                k8sConnected: k8sCollector.isInitialized,
                uptime: process.uptime()
            });
        } catch (err) {
            console.warn(`[AGENT] Heartbeat tick notice: ${err.message}`);
        }
    }, config.heartbeatIntervalMs);

    // Telemetry Collection & Submission Loop (~10s)
    const telemetryTimer = setInterval(async () => {
        if (isShuttingDown || apiClient.isRevoked) return;
        try {
            const metrics = await promCollector.collectMetrics();
            const k8sData = await k8sCollector.collectClusterData(config.allowedNamespaces);

            await apiClient.sendTelemetry({
                metrics,
                k8s: k8sData
            });
        } catch (err) {
            console.warn(`[AGENT] Telemetry tick notice: ${err.message}`);
        }
    }, config.telemetryIntervalMs);

    // Command Polling Loop (~5s)
    let isPolling = false;
    const commandTimer = setInterval(async () => {
        if (isShuttingDown || apiClient.isRevoked || isPolling) return;
        isPolling = true;

        try {
            const command = await apiClient.pollCommands();
            if (command) {
                console.log(`📥 [AGENT] Received command: ${command.action} (${command.commandId})`);
                const result = await remediationExecutor.executeCommand(command);
                console.log(`📤 [AGENT] Submitting command result: status=${result.status}`);
                await apiClient.submitCommandResult(result);
            }
        } catch (err) {
            console.warn(`[AGENT] Command poll notice: ${err.message}`);
        } finally {
            isPolling = false;
        }
    }, config.commandPollIntervalMs);

    // Send initial telemetry immediately
    try {
        const initialMetrics = await promCollector.collectMetrics();
        const initialK8s = await k8sCollector.collectClusterData(config.allowedNamespaces);
        await apiClient.sendTelemetry({
            metrics: initialMetrics,
            k8s: initialK8s
        });
        console.log("✅ [AGENT] Initial telemetry delivered successfully.");
    } catch (e) {
        console.warn(`⚠️ [AGENT] Initial telemetry push notice: ${e.message}`);
    }

    console.log("🟢 [AGENT] CloudOps Agent running actively. Outbound-only HTTPS connection active.");

    // Graceful Shutdown
    const shutdown = async (signal) => {
        console.log(`\n🛑 [AGENT] ${signal} received. Shutting down gracefully...`);
        isShuttingDown = true;
        clearInterval(heartbeatTimer);
        clearInterval(telemetryTimer);
        clearInterval(commandTimer);
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

startAgent().catch((err) => {
    console.error("FATAL AGENT ERROR:", err.message);
    process.exit(1);
});
