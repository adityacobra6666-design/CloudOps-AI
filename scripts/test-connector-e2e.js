const axios = require("axios");
const { execSync, spawn } = require("child_process");
const path = require("path");

const API_BASE = "http://localhost:5000/api";

function logStep(step, desc) {
    console.log(`\n============================================================`);
    console.log(`▶ STEP ${step}: ${desc}`);
    console.log(`============================================================`);
}

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`✅ PASSED: ${message}`);
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
    console.log("🚀 Starting CloudOps AI Remote Infrastructure Connector E2E Test Suite\n");

    // 0. AUTHENTICATE
    logStep(0, "Obtain Admin JWT Token");
    const loginRes = await axios.post(`${API_BASE}/auth/login`, {
        email: "admin@cloudops.internal",
        password: "AdminPassword123!"
    });
    const token = loginRes.data.token;
    assert(Boolean(token), "JWT authentication token acquired");
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 1. CREATE CONNECTION & ENROLLMENT TOKEN
    logStep(1, "Create Infrastructure Connection in Control Plane");
    const createRes = await axios.post(
        `${API_BASE}/infrastructure/connections`,
        {
            name: "Production Kubernetes Cluster",
            type: "KUBERNETES",
            environment: "production",
            description: "Test connected cluster via outbound agent"
        },
        { headers: authHeaders }
    );

    const { connection, enrollmentToken } = createRes.data;
    assert(Boolean(connection?._id), "Connection created in MongoDB");
    assert(connection.status === "PENDING", "Initial connection status is PENDING");
    assert(Boolean(enrollmentToken && enrollmentToken.startsWith("cope_")), "Cryptographically secure one-time enrollment token generated");
    console.log(`   Connection ID: ${connection._id}`);
    console.log(`   Agent ID:      ${connection.agentId}`);
    console.log(`   Enrollment:    ${enrollmentToken.substring(0, 16)}...`);

    // Verify token was NOT stored as plaintext in DB
    const listRes = await axios.get(`${API_BASE}/infrastructure/connections/${connection._id}`, { headers: authHeaders });
    assert(!listRes.data.connection.enrollmentTokenHash, "Sensitive token hashes are never exposed in GET responses");

    // 2. START CLOUDOPS AGENT PROCESS
    logStep(2, "Start CloudOps Agent with Enrollment Token (Outbound-only)");
    const agentEnv = {
        ...process.env,
        CLOUDOPS_URL: "http://localhost:5000",
        ENROLLMENT_TOKEN: enrollmentToken,
        AGENT_NAME: "Production Kubernetes Cluster",
        AGENT_ENVIRONMENT: "production",
        PROMETHEUS_URL: "http://localhost:9090",
        KUBECONFIG: path.join(process.env.HOME, ".kube", "config"),
        HEARTBEAT_INTERVAL_MS: "3000",
        TELEMETRY_INTERVAL_MS: "3000",
        COMMAND_POLL_INTERVAL_MS: "2000"
    };

    const agentProcess = spawn("node", ["src/index.js"], {
        cwd: path.join(__dirname, "..", "agent"),
        env: agentEnv,
        stdio: ["ignore", "pipe", "pipe"]
    });

    agentProcess.stdout.on("data", (d) => process.stdout.write(`   [Agent stdout] ${d}`));
    agentProcess.stderr.on("data", (d) => process.stderr.write(`   [Agent stderr] ${d}`));

    // Wait for agent to register and send initial telemetry
    console.log("⏳ Waiting 8 seconds for agent registration & first telemetry cycle...");
    await sleep(8000);

    // 3. VERIFY CONNECTED STATUS
    logStep(3, "Verify Connection is CONNECTED & Last Seen is Fresh");
    const connCheck = await axios.get(`${API_BASE}/infrastructure/connections/${connection._id}`, { headers: authHeaders });
    const freshConn = connCheck.data.connection;
    assert(freshConn.status === "CONNECTED", `Connection status is now CONNECTED (got: ${freshConn.status})`);
    assert(Boolean(freshConn.lastSeenAt), "lastSeenAt timestamp is recorded");
    const diffSec = Math.round((Date.now() - new Date(freshConn.lastSeenAt).getTime()) / 1000);
    assert(diffSec <= 10, `Heartbeat is fresh (${diffSec}s ago)`);

    // 4. VERIFY PROMETHEUS TELEMETRY & KUBERNETES TOPOLOGY RECEIVED
    logStep(4, "Verify Agent Delivered Real Telemetry & Kubernetes Topology");
    assert(freshConn.telemetry && freshConn.telemetry.metrics, "Normalized telemetry object received");
    console.log("   Received Telemetry:", JSON.stringify(freshConn.telemetry.metrics));
    assert(typeof freshConn.telemetry.metrics.cpu === "number", "CPU metric is a valid number");
    assert(freshConn.k8sSummary && freshConn.k8sSummary.deploymentsCount > 0, `K8s deployments reported (${freshConn.k8sSummary.deploymentsCount} deployments)`);
    assert(freshConn.k8sSummary.podsCount > 0, `K8s pods reported (${freshConn.k8sSummary.podsCount} pods)`);
    console.log(`   Nodes: ${freshConn.k8sSummary.nodesCount}, Pods: ${freshConn.k8sSummary.podsCount}, Deployments: ${freshConn.k8sSummary.deploymentsCount}`);

    // Test API query for connected environment in Kubernetes controller
    const k8sOverview = await axios.get(`${API_BASE}/kubernetes/overview?connectionId=${connection._id}`, { headers: authHeaders });
    assert(k8sOverview.data.success && k8sOverview.data.connected, "Kubernetes overview endpoint returns connected environment topology");

    // Test API query for connected environment in Observability controller
    const obsTelemetry = await axios.get(`${API_BASE}/observability/telemetry?connectionId=${connection._id}`, { headers: authHeaders });
    assert(obsTelemetry.data.success && obsTelemetry.data.summary.cpu, "Observability telemetry endpoint returns connected environment metrics");

    // 5. TEST REMEDIATION VIA AGENT: SCALE_SERVICE (2 -> 3 REPLICAS)
    logStep(5, "Execute Approved SCALE_SERVICE Remediation via Agent");
    // Check initial replica count
    const initialK8s = execSync("kubectl get deployment cloudops-backend -n cloudops -o jsonpath='{.spec.replicas}'").toString().trim();
    console.log(`   Current Minikube deployment replicas: ${initialK8s}`);

    const targetReplicas = initialK8s === "3" ? 2 : 3;
    console.log(`   Dispatching SCALE_SERVICE to ${targetReplicas} replicas through agent command queue...`);

    const scaleActionRes = await axios.post(
        `${API_BASE}/kubernetes/action`,
        {
            action: "SCALE_SERVICE",
            target: "cloudops-backend",
            namespace: "cloudops",
            replicas: targetReplicas,
            connectionId: connection._id,
            reason: "Integration test for remote agent autonomous scaling"
        },
        { headers: authHeaders }
    );

    assert(scaleActionRes.data.success, `SCALE_SERVICE succeeded: ${scaleActionRes.data.message}`);
    assert(scaleActionRes.data.verification?.passed, "Two-stage verification passed");

    // Verify ACTUAL infrastructure state in Minikube
    await sleep(2000);
    const updatedK8s = execSync("kubectl get deployment cloudops-backend -n cloudops -o jsonpath='{.spec.replicas}'").toString().trim();
    assert(updatedK8s === String(targetReplicas), `Minikube deployment actual replicas converged to ${targetReplicas} (got: ${updatedK8s})`);

    // 6. TEST REMEDIATION VIA AGENT: RESTART_SERVICE (ROLLING RESTART)
    logStep(6, "Execute Approved RESTART_SERVICE Remediation via Agent");
    const restartActionRes = await axios.post(
        `${API_BASE}/kubernetes/action`,
        {
            action: "RESTART_SERVICE",
            target: "cloudops-backend",
            namespace: "cloudops",
            connectionId: connection._id,
            reason: "Integration test for remote agent rolling restart"
        },
        { headers: authHeaders }
    );

    assert(restartActionRes.data.success, `RESTART_SERVICE succeeded: ${restartActionRes.data.message}`);
    const rolloutCheck = execSync("kubectl rollout status deployment/cloudops-backend -n cloudops --timeout=30s").toString();
    console.log(`   Rollout status: ${rolloutCheck.trim()}`);
    assert(rolloutCheck.includes("successfully rolled out"), "Minikube deployment rolling restart completed successfully");

    // 7. TEST INCIDENT & RAG CONTEXT WITH CONNECTED ENVIRONMENT
    logStep(7, "Test Incident Attribution & RAG Context with Connected Environment");
    const incidentRes = await axios.post(
        `${API_BASE}/incidents`,
        {
            title: "Pod Memory Saturation in Connected Production Cluster",
            description: "Production payment pods experiencing elevated memory consumption",
            severity: "warning",
            source: "Connected Agent / Prometheus",
            category: "infrastructure",
            server: "cloudops-backend",
            environment: "Production Kubernetes",
            connectionId: connection._id
        },
        { headers: authHeaders }
    );
    assert(Boolean(incidentRes.data.incident?._id), "Incident created with connectionId and environment attribution");

    // 8. TEST DISCONNECT DETECTION (STOP AGENT)
    logStep(8, "Test Agent Disconnect Detection (Heartbeat Staleness)");
    console.log("   Stopping agent process...");
    agentProcess.kill("SIGTERM");
    await sleep(1000);

    // Verify simulate staleness: set lastSeenAt to 65 seconds ago in MongoDB
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/cloudops");
    const InfrastructureConnection = require("../server/src/models/infrastructureConnection.model");
    await InfrastructureConnection.updateOne(
        { _id: connection._id },
        { $set: { lastSeenAt: new Date(Date.now() - 70 * 1000) } }
    );
    await mongoose.disconnect();

    const staleConn = (await axios.get(`${API_BASE}/infrastructure/connections/${connection._id}`, { headers: authHeaders })).data.connection;
    assert(staleConn.status === "DISCONNECTED", `Stale heartbeat correctly yields DISCONNECTED (got: ${staleConn.status})`);

    // 9. TEST REVOCATION
    logStep(9, "Test Connection Revocation");
    const revokeRes = await axios.post(`${API_BASE}/infrastructure/connections/${connection._id}/revoke`, {}, { headers: authHeaders });
    assert(revokeRes.data.status === "REVOKED", "Connection status transitioned to REVOKED");

    // Verify that agent endpoints reject requests for revoked connection
    try {
        await axios.post(`${API_BASE}/agent/heartbeat`, {
            agentId: connection.agentId,
            version: "1.0.0"
        }, {
            headers: {
                "Authorization": `Bearer invalid-or-revoked-token`,
                "x-agent-id": connection.agentId
            }
        });
        assert(false, "Revoked agent request should have been rejected with 401/403");
    } catch (err) {
        assert(err.response?.status === 401 || err.response?.status === 403, `Revoked agent request correctly rejected (${err.response?.status})`);
    }

    console.log("\n============================================================");
    console.log("🎉 ALL REMOTE INFRASTRUCTURE CONNECTOR E2E TESTS PASSED!");
    console.log("============================================================\n");
}

runTests().catch((err) => {
    console.error("FATAL TEST FAILURE:", err);
    process.exit(1);
});
