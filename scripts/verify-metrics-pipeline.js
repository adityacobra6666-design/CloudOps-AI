#!/usr/bin/env node

/**
 * =========================================================================
 * CloudOps AI — Metrics Pipeline & Grafana Cloud Verification Tool
 * =========================================================================
 * Safely inspects and verifies:
 * 1. Grafana Cloud reachability & TLS
 * 2. Grafana Cloud query authentication (metrics:read scope)
 * 3. Grafana Cloud active ingestion status (count(up))
 * 4. Grafana Cloud remote_write endpoint authentication (metrics:write scope)
 * 5. Local Alertmanager DNS & service health
 * 6. Local Prometheus targets health
 *
 * SECURITY: NEVER prints secret tokens or passwords.
 * =========================================================================
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

// Read root .env file safely
function loadEnv() {
    const envPaths = [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "server/.env")
    ];

    const env = { ...process.env };
    for (const p of envPaths) {
        if (fs.existsSync(p)) {
            try {
                const content = fs.readFileSync(p, "utf8");
                content.split("\n").forEach(line => {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith("#")) {
                        const idx = trimmed.indexOf("=");
                        if (idx > 0) {
                            const key = trimmed.substring(0, idx).trim();
                            const val = trimmed.substring(idx + 1).trim();
                            if (!env[key] && val) {
                                env[key] = val;
                            }
                        }
                    }
                });
            } catch (_) {}
        }
    }
    return env;
}

const env = loadEnv();

const rawUrl = env.GRAFANA_CLOUD_REMOTE_WRITE_URL || env.GRAFANA_CLOUD_PROMETHEUS_URL;
const user = env.GRAFANA_CLOUD_USER || env.GRAFANA_CLOUD_PROMETHEUS_USERNAME;
const token = env.GRAFANA_CLOUD_API_KEY || env.GRAFANA_CLOUD_PROMETHEUS_TOKEN;

const alertmanagerUrl = env.ALERTMANAGER_URL || "http://localhost:9093";
const prometheusUrl = env.PROMETHEUS_URL || "http://localhost:9090";

function normalizeBaseUrl(url) {
    if (!url) return "";
    let trimmed = url.trim().replace(/\/+$/, "");
    if (trimmed.endsWith("/push")) {
        trimmed = trimmed.substring(0, trimmed.length - 5).replace(/\/+$/, "");
    }
    if (trimmed.endsWith("/api/v1")) {
        trimmed = trimmed.substring(0, trimmed.length - 7).replace(/\/+$/, "");
    }
    return trimmed;
}

function mask(str) {
    if (!str) return "[NOT SET]";
    if (str.length <= 8) return "[SET (length " + str.length + ")]";
    return str.substring(0, 4) + "..." + str.substring(str.length - 4) + " (length " + str.length + ")";
}

console.log("=================================================================");
console.log(" CloudOps AI — Metrics Pipeline & Ingestion Verification Tool");
console.log("=================================================================\n");

console.log("Configuration Contract Assessment:");
console.log("  Endpoint:       " + (rawUrl ? rawUrl : "[NOT SET]"));
console.log("  User/ID:        " + (user ? user : "[NOT SET]"));
console.log("  Token/Key:      " + mask(token));
console.log("  Alertmanager:   " + alertmanagerUrl);
console.log("  Prometheus:     " + prometheusUrl + "\n");

async function checkLocalAlertmanager() {
    return new Promise((resolve) => {
        const u = alertmanagerUrl.includes("localhost") || alertmanagerUrl.includes("127.0.0.1")
            ? alertmanagerUrl
            : "http://localhost:9093";

        const req = http.get(`${u}/-/healthy`, { timeout: 2000 }, (res) => {
            let body = "";
            res.on("data", c => body += c);
            res.on("end", () => {
                const ok = res.statusCode >= 200 && res.statusCode < 300;
                resolve({ ok, status: res.statusCode, body: body.trim() });
            });
        });
        req.on("error", (e) => resolve({ ok: false, error: e.message }));
        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false, error: "Connection timed out" });
        });
    });
}

async function checkLocalPrometheus() {
    return new Promise((resolve) => {
        const u = prometheusUrl.includes("localhost") || prometheusUrl.includes("127.0.0.1")
            ? prometheusUrl
            : "http://localhost:9090";

        const req = http.get(`${u}/api/v1/targets`, { timeout: 2000 }, (res) => {
            let body = "";
            res.on("data", c => body += c);
            res.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const active = data.data?.activeTargets || [];
                    const upTargets = active.filter(t => t.health === "up");
                    resolve({ ok: res.statusCode === 200, total: active.length, up: upTargets.length, targets: active });
                } catch (e) {
                    resolve({ ok: false, error: "Non-JSON response" });
                }
            });
        });
        req.on("error", (e) => resolve({ ok: false, error: e.message }));
        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false, error: "Connection timed out" });
        });
    });
}

async function checkGrafanaCloudRead(baseUrl, username, password) {
    return new Promise((resolve) => {
        const queryUrl = `${baseUrl}/api/v1/query?query=1`;
        const u = new URL(queryUrl);

        const req = https.get(u, {
            headers: {
                "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
                "Accept": "application/json"
            },
            timeout: 5000
        }, (res) => {
            let body = "";
            res.on("data", c => body += c);
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (_) {}
                resolve({ status: res.statusCode, ok: res.statusCode === 200, data: parsed, body: body.trim() });
            });
        });
        req.on("error", e => resolve({ ok: false, error: e.message }));
        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false, error: "Connection timed out" });
        });
    });
}

async function checkGrafanaCloudSamples(baseUrl, username, password) {
    return new Promise((resolve) => {
        const queryUrl = `${baseUrl}/api/v1/query?query=count(up)`;
        const u = new URL(queryUrl);

        const req = https.get(u, {
            headers: {
                "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
                "Accept": "application/json"
            },
            timeout: 5000
        }, (res) => {
            let body = "";
            res.on("data", c => body += c);
            res.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const r = data.data?.result;
                    const count = r && r.length > 0 ? parseFloat(r[0].value[1]) : 0;
                    resolve({ ok: res.statusCode === 200, sampleCount: count });
                } catch (_) {
                    resolve({ ok: false, sampleCount: 0 });
                }
            });
        });
        req.on("error", e => resolve({ ok: false, error: e.message }));
        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false, error: "Connection timed out" });
        });
    });
}

async function checkGrafanaCloudWriteScope(pushUrl, username, password) {
    return new Promise((resolve) => {
        const u = new URL(pushUrl);

        const req = https.request(u, {
            method: "POST",
            headers: {
                "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
                "Content-Type": "application/x-protobuf",
                "Content-Encoding": "snappy"
            },
            timeout: 5000
        }, (res) => {
            let body = "";
            res.on("data", c => body += c);
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (_) {}
                resolve({ status: res.statusCode, body: body.trim(), parsed });
            });
        });
        req.on("error", e => resolve({ ok: false, error: e.message }));
        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false, error: "Connection timed out" });
        });
        // Send empty Snappy buffer to trigger auth validation
        req.end(Buffer.from([]));
    });
}

async function run() {
    console.log("Checking Local Monitoring Stack Services...");

    // 1. Alertmanager check
    const amRes = await checkLocalAlertmanager();
    if (amRes.ok) {
        console.log("  [PASS] Alertmanager: Online and healthy (HTTP " + amRes.status + ")");
    } else {
        console.log("  [FAIL] Alertmanager: " + (amRes.error || `HTTP ${amRes.status}`));
    }

    // 2. Prometheus targets check
    const promRes = await checkLocalPrometheus();
    if (promRes.ok) {
        console.log(`  [PASS] Prometheus Targets: ${promRes.up}/${promRes.total} active targets healthy (UP)`);
        promRes.targets.forEach(t => {
            const job = t.labels?.job || "unknown";
            const addr = t.discoveredLabels?.__address__ || t.scrapeUrl || "";
            const h = t.health === "up" ? "UP" : "DOWN";
            console.log(`         • ${job} (${addr}): ${h}`);
        });
    } else {
        console.log("  [FAIL] Prometheus Targets: " + (promRes.error || "Unreachable"));
    }

    console.log("\nChecking Grafana Cloud Ingestion Pipeline...");

    if (!rawUrl || !user || !token) {
        console.log("  [SKIP] Grafana Cloud credentials incomplete. Configure root .env to verify.");
        return;
    }

    const baseUrl = normalizeBaseUrl(rawUrl);
    const pushUrl = `${baseUrl}/push`;

    // 3. Query API check (metrics:read)
    const readRes = await checkGrafanaCloudRead(baseUrl, user, token);
    if (readRes.ok) {
        console.log("  [PASS] Grafana Cloud Query API: Authenticated successfully (metrics:read scope verified)");
    } else {
        console.log(`  [FAIL] Grafana Cloud Query API: HTTP ${readRes.status} (${readRes.parsed?.error || readRes.body || readRes.error})`);
    }

    // 4. Remote write push check (metrics:write)
    const writeRes = await checkGrafanaCloudWriteScope(pushUrl, user, token);
    if (writeRes.status === 401) {
        const errText = writeRes.parsed?.error || writeRes.body || "";
        if (errText.includes("invalid scope requested")) {
            console.log("  [FAIL] Grafana Cloud Remote Write: HTTP 401 Unauthorized — INVALID SCOPE REQUESTED");
            console.log("         ROOT CAUSE CONFIRMED: The configured token only has 'metrics:read' scope.");
            console.log("         RESOLUTION: In Grafana Cloud -> Access Policies, add 'metrics:write' scope.");
        } else if (errText.includes("invalid token")) {
            console.log("  [FAIL] Grafana Cloud Remote Write: HTTP 401 Unauthorized — INVALID TOKEN");
            console.log("         The token value or basic-auth username does not match this Grafana Cloud stack.");
        } else {
            console.log(`  [FAIL] Grafana Cloud Remote Write: HTTP 401 (${errText})`);
        }
    } else if (writeRes.status === 400 || writeRes.status === 204 || writeRes.status === 200) {
        console.log("  [PASS] Grafana Cloud Remote Write: Authenticated successfully (metrics:write scope verified)");
    } else {
        console.log(`  [WARN] Grafana Cloud Remote Write: HTTP ${writeRes.status} (${writeRes.error || writeRes.body})`);
    }

    // 5. Ingestion samples check
    if (readRes.ok) {
        const samplesRes = await checkGrafanaCloudSamples(baseUrl, user, token);
        if (samplesRes.sampleCount > 0) {
            console.log(`  [PASS] Grafana Cloud Metrics Ingestion: Active (${samplesRes.sampleCount} series reporting up)`);
        } else {
            console.log("  [INFO] Grafana Cloud Metrics Ingestion: No active series found (count(up) = 0).");
            console.log("         Once Prometheus remote_write is authorized with metrics:write, samples will appear here.");
        }
    }

    console.log("\n=================================================================");
}

run().catch(e => {
    console.error("Verification execution error:", e.message);
    process.exit(1);
});
