const mongoose = require("mongoose");
const Incident = require("../models/Incident");
const { DETECTOR_CONFIG, RULES } = require("../config/incidentDetection.config");
const { queryInstant } = require("./prometheus.service");

// Tracking consecutive breaches per rule to prevent transient single-spike triggers
const breachTracker = new Map();

// Concurrency guard
let isEvaluating = false;
let detectorIntervalId = null;

/**
 * Fetch real current metric values from Prometheus & internal health
 */
async function collectMetrics() {
    const metrics = {
        cpu: null,
        memory: null,
        p95Latency: null,
        errorRate: null,
        backendHealth: mongoose.connection.readyState === 1 ? 1 : 0
    };

    // PromQL queries matching the project's verified schema
    const queries = {
        hostCpu: `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`,
        procCpu: `sum(rate(process_cpu_seconds_total[1m])) * 100`,
        hostMem: `100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`,
        procMem: `100 * (nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes)`,
        p95: `histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) * 1000`,
        errRate: `((sum(rate(cloudops_http_requests_total{status_code=~"5.."}[1m])) or (0 * sum(rate(cloudops_http_requests_total[1m])))) / sum(rate(cloudops_http_requests_total[1m]))) * 100`
    };

    try {
        const [hostCpu, procCpu, hostMem, procMem, p95, errRate] = await Promise.allSettled([
            queryInstant(queries.hostCpu),
            queryInstant(queries.procCpu),
            queryInstant(queries.hostMem),
            queryInstant(queries.procMem),
            queryInstant(queries.p95),
            queryInstant(queries.errRate)
        ]);

        // CPU: Host metric preferred, fallback to process CPU if host is absent
        if (hostCpu.status === "fulfilled" && hostCpu.value !== null && !isNaN(hostCpu.value)) {
            metrics.cpu = parseFloat(hostCpu.value.toFixed(1));
        } else if (procCpu.status === "fulfilled" && procCpu.value !== null && !isNaN(procCpu.value)) {
            metrics.cpu = parseFloat(procCpu.value.toFixed(1));
        }

        // Memory: Host metric preferred, fallback to heap % if host is absent
        if (hostMem.status === "fulfilled" && hostMem.value !== null && !isNaN(hostMem.value)) {
            metrics.memory = parseFloat(hostMem.value.toFixed(1));
        } else if (procMem.status === "fulfilled" && procMem.value !== null && !isNaN(procMem.value)) {
            metrics.memory = parseFloat(procMem.value.toFixed(1));
        }

        // P95 Latency (ms)
        if (p95.status === "fulfilled" && p95.value !== null && !isNaN(p95.value)) {
            metrics.p95Latency = Math.round(p95.value);
        }

        // Error Rate (%)
        if (errRate.status === "fulfilled" && errRate.value !== null && !isNaN(errRate.value)) {
            metrics.errorRate = parseFloat(errRate.value.toFixed(2));
        }
    } catch (err) {
        console.warn("[INCIDENT DETECTOR] Metric collection notice:", err.message);
    }

    return metrics;
}

/**
 * Determine severity for a given rule and metric value
 */
function evaluateSeverity(rule, value) {
    if (value === null || value === undefined || isNaN(value)) {
        return { status: "unevaluable" };
    }

    if (rule.id === "backend_health") {
        if (value === 0) {
            return { status: "breached", severity: "CRITICAL", threshold: rule.criticalThreshold };
        }
        return { status: "normal" };
    }

    if (value >= rule.criticalThreshold) {
        return { status: "breached", severity: "CRITICAL", threshold: rule.criticalThreshold };
    }
    if (value >= rule.warningThreshold) {
        return { status: "breached", severity: "WARNING", threshold: rule.warningThreshold };
    }
    if (value <= rule.recoveryThreshold) {
        return { status: "recovered" };
    }

    return { status: "normal" };
}

/**
 * Attempt optional, non-blocking RCA with local AI if available
 */
async function attachAiRcaIfAvailable(incident) {
    try {
        const { generateAnalysis } = require("./rag/rag.service");
        if (typeof generateAnalysis === "function") {
            const analysis = await Promise.race([
                generateAnalysis(incident, []),
                new Promise((_, reject) => setTimeout(() => reject(new Error("AI RCA timeout")), 4000))
            ]);
            if (analysis) {
                await Incident.updateOne(
                    { _id: incident._id },
                    {
                        $set: {
                            aiAnalysis: analysis,
                            aiRootCause: analysis.rootCause || null,
                            aiRecommendation: analysis.recommendation || null,
                            aiAnalyzedAt: new Date()
                        }
                    }
                );
            }
        }
    } catch (e) {
        // AI is optional / non-blocking; detection remains 100% operational
    }
}

/**
 * Execute a single detection pass across all rules
 * Returns summary of evaluated, created, updated, and resolved incidents
 */
async function evaluateRulesOnce(metricOverrides = null) {
    if (isEvaluating) {
        return { skipped: true, reason: "Detection run already in progress" };
    }

    isEvaluating = true;
    const summary = {
        timestamp: new Date().toISOString(),
        evaluatedRules: 0,
        breachedRules: 0,
        incidentsCreated: 0,
        incidentsUpdated: 0,
        incidentsResolved: 0,
        details: []
    };

    try {
        const metrics = metricOverrides || await collectMetrics();
        const serverName = process.env.SERVER_NAME || "cloudops-server";

        for (const rule of Object.values(RULES)) {
            summary.evaluatedRules++;
            const val = metrics[rule.metricKey];
            const evalResult = evaluateSeverity(rule, val);
            const fingerprint = `auto_${rule.id}_${serverName}`;

            if (evalResult.status === "unevaluable") {
                // Do NOT trigger incidents from missing/invalid metrics
                continue;
            }

            if (evalResult.status === "breached") {
                summary.breachedRules++;
                const count = (breachTracker.get(rule.id) || 0) + 1;
                breachTracker.set(rule.id, count);

                // Require consecutive breaches to filter out single transient anomalies
                if (count >= DETECTOR_CONFIG.consecutiveBreachesRequired) {
                    // Check for existing open incident to deduplicate
                    const existingIncident = await Incident.findOne({
                        alertFingerprint: fingerprint,
                        status: { $in: ["open", "OPEN", "in_progress", "INVESTIGATING"] }
                    });

                    if (existingIncident) {
                        // Deduplicate: update last seen time and observed value without duplicate record
                        existingIncident.lastSeenAt = new Date();
                        existingIncident.observedValue = val;
                        if (evalResult.severity === "CRITICAL" && existingIncident.severity !== "CRITICAL" && existingIncident.severity !== "critical") {
                            existingIncident.severity = "CRITICAL";
                            existingIncident.title = `${rule.title} [CRITICAL]`;
                        }
                        await existingIncident.save();
                        summary.incidentsUpdated++;
                        summary.details.push({ rule: rule.id, action: "updated", incidentId: existingIncident._id });
                    } else {
                        // Create persistent incident
                        const newIncident = await Incident.create({
                            title: `${rule.title} [${evalResult.severity}]`,
                            description: rule.description(val, evalResult.threshold),
                            severity: evalResult.severity.toLocaleLowerCase(),
                            source: "Automatic Detection",
                            category: rule.category,
                            status: "OPEN",
                            server: serverName,
                            alertFingerprint: fingerprint,
                            alertName: rule.id,
                            triggerRule: rule.id,
                            metricName: rule.metricKey,
                            observedValue: val,
                            thresholdValue: evalResult.threshold,
                            unit: rule.unit,
                            autoDetected: true,
                            startsAt: new Date(),
                            lastSeenAt: new Date()
                        });

                        summary.incidentsCreated++;
                        summary.details.push({ rule: rule.id, action: "created", incidentId: newIncident._id });

                        // Non-blocking RCA attachment
                        attachAiRcaIfAvailable(newIncident);
                    }
                }
            } else if (evalResult.status === "recovered" || evalResult.status === "normal") {
                // Condition normalized: reset breach counter
                breachTracker.set(rule.id, 0);

                // Check if an existing open incident should be auto-resolved
                const openIncident = await Incident.findOne({
                    alertFingerprint: fingerprint,
                    status: { $in: ["open", "OPEN", "in_progress", "INVESTIGATING"] }
                });

                if (openIncident && evalResult.status === "recovered") {
                    openIncident.status = "RESOLVED";
                    openIncident.resolvedAt = new Date();
                    openIncident.endsAt = new Date();
                    openIncident.resolutionNote = `Auto-resolved: ${rule.title} returned to normal (${val}${rule.unit} <= threshold ${rule.recoveryThreshold}${rule.unit}).`;
                    await openIncident.save();

                    summary.incidentsResolved++;
                    summary.details.push({ rule: rule.id, action: "resolved", incidentId: openIncident._id });
                }
            }
        }
    } catch (err) {
        console.error("❌ [INCIDENT DETECTOR] Error during evaluation pass:", err.message);
        summary.error = err.message;
    } finally {
        isEvaluating = false;
    }

    return summary;
}

/**
 * Start background detector polling lifecycle
 */
function startIncidentDetector() {
    if (!DETECTOR_CONFIG.enabled) {
        console.log("ℹ️ [INCIDENT DETECTOR] Disabled via INCIDENT_DETECTION_ENABLED=false");
        return;
    }

    if (detectorIntervalId) {
        console.log("ℹ️ [INCIDENT DETECTOR] Already running (interval ID active)");
        return;
    }

    const intervalMs = DETECTOR_CONFIG.intervalSeconds * 1000;
    console.log(`🚀 [INCIDENT DETECTOR] Starting background evaluation engine (interval: ${DETECTOR_CONFIG.intervalSeconds}s, consecutive breaches: ${DETECTOR_CONFIG.consecutiveBreachesRequired})`);

    // Initial pass shortly after boot
    setTimeout(() => {
        evaluateRulesOnce().catch(err => {
            console.warn("⚠️ [INCIDENT DETECTOR] Initial pass notice:", err.message);
        });
    }, 5000);

    detectorIntervalId = setInterval(() => {
        evaluateRulesOnce().catch(err => {
            console.warn("⚠️ [INCIDENT DETECTOR] Scheduled pass notice:", err.message);
        });
    }, intervalMs);

    // Keep timer from holding Node process open if unref is desirable
    if (detectorIntervalId.unref) {
        detectorIntervalId.unref();
    }
}

/**
 * Stop background detector on graceful shutdown
 */
function stopIncidentDetector() {
    if (detectorIntervalId) {
        clearInterval(detectorIntervalId);
        detectorIntervalId = null;
        console.log("🛑 [INCIDENT DETECTOR] Background detector stopped");
    }
}

module.exports = {
    startIncidentDetector,
    stopIncidentDetector,
    evaluateRulesOnce,
    collectMetrics,
    evaluateSeverity
};
