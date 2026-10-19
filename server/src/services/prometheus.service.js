const axios = require("axios");

// ========================================================
// PROMETHEUS CONFIGURATION & PROVIDER SELECTION
// ========================================================

/**
 * Normalize Prometheus base URL (removes trailing slashes, /push, and /api/v1 if included)
 */
function normalizeBaseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    let trimmed = rawUrl.trim().replace(/\/+$/, "");
    if (trimmed.endsWith("/push")) {
        trimmed = trimmed.substring(0, trimmed.length - 5).replace(/\/+$/, "");
    }
    if (trimmed.endsWith("/api/v1")) {
        trimmed = trimmed.substring(0, trimmed.length - 7).replace(/\/+$/, "");
    }
    return trimmed;
}

/**
 * Resolve the active Prometheus provider and client configuration
 * Accepts optional preferredProvider ("local" | "grafana_cloud")
 */
function getPrometheusConfig(preferredProvider) {
    const cloudUrl = process.env.GRAFANA_CLOUD_PROMETHEUS_URL || process.env.GRAFANA_CLOUD_REMOTE_WRITE_URL;
    const cloudUser = process.env.GRAFANA_CLOUD_PROMETHEUS_USERNAME || process.env.GRAFANA_CLOUD_USER;
    const cloudToken = process.env.GRAFANA_CLOUD_PROMETHEUS_TOKEN || process.env.GRAFANA_CLOUD_API_KEY;
    const localUrl = process.env.PROMETHEUS_URL || "http://prometheus:9090";

    const isCloudConfigured = Boolean(cloudUrl && cloudUrl.trim());

    if (preferredProvider === "local") {
        return {
            provider: "local",
            isCloud: false,
            isValid: true,
            configError: null,
            baseUrl: normalizeBaseUrl(localUrl),
            auth: null,
            timeout: 5000
        };
    }

    if (preferredProvider === "grafana_cloud" || (preferredProvider !== "local" && isCloudConfigured)) {
        const username = cloudUser ? String(cloudUser).trim() : "";
        const token = cloudToken ? String(cloudToken).trim() : "";

        if (!username || !token) {
            return {
                provider: "grafana_cloud",
                isCloud: true,
                isValid: false,
                configError: "Grafana Cloud URL is configured, but username or API token is missing.",
                baseUrl: normalizeBaseUrl(cloudUrl),
                auth: null,
                timeout: 10000
            };
        }

        return {
            provider: "grafana_cloud",
            isCloud: true,
            isValid: true,
            configError: null,
            baseUrl: normalizeBaseUrl(cloudUrl),
            auth: {
                username,
                password: token
            },
            timeout: 10000
        };
    }

    return {
        provider: "local",
        isCloud: false,
        isValid: true,
        configError: null,
        baseUrl: normalizeBaseUrl(localUrl),
        auth: null,
        timeout: 5000
    };
}

// Preserve exported PROMETHEUS_URL compatibility
const PROMETHEUS_URL = process.env.GRAFANA_CLOUD_PROMETHEUS_URL || process.env.GRAFANA_CLOUD_REMOTE_WRITE_URL || process.env.PROMETHEUS_URL || "http://prometheus:9090";

/**
 * Create configured Axios request options without exposing secrets in logs
 */
function createRequestConfig(config, params = {}) {
    const reqConfig = {
        params,
        timeout: config.timeout,
        headers: {
            "Accept": "application/json"
        }
    };

    if (config.auth) {
        reqConfig.auth = {
            username: config.auth.username,
            password: config.auth.password
        };
    }

    return reqConfig;
}

/**
 * Format and sanitize Prometheus error message (never prints tokens or credentials)
 */
function sanitizeError(error, context) {
    let msg = error.message;
    let statusCode = null;

    if (error.response) {
        statusCode = error.response.status;
        const respData = error.response.data;
        if (typeof respData === "object" && respData !== null) {
            msg = respData.error || respData.message || `HTTP ${statusCode} ${error.response.statusText || ""}`;
        } else if (typeof respData === "string" && respData.length < 200) {
            msg = respData;
        } else {
            msg = `HTTP ${statusCode} ${error.response.statusText || ""}`;
        }

        if (statusCode === 401) {
            msg = `Authentication failed (HTTP 401 Unauthorized). Verify your Grafana Cloud username/token.`;
        } else if (statusCode === 403) {
            msg = `Access forbidden (HTTP 403 Forbidden). Ensure your access token has 'metrics:read' permission.`;
        }
    } else if (error.code === "ECONNREFUSED") {
        msg = `Connection refused. Metrics endpoint is unreachable.`;
    } else if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
        msg = `Query timed out after ${error.config?.timeout || 5000}ms.`;
    }

    const safeErr = new Error(`Prometheus ${context} failed: ${msg}`);
    safeErr.statusCode = statusCode;
    safeErr.code = error.code;
    safeErr.isPrometheusError = true;
    return safeErr;
}

// ========================================================
// INSTANT QUERY
// ========================================================

/**
 * Execute an instant query against Prometheus / Grafana Cloud
 * Returns number if matching data exists, or null if no series match.
 * Throws on network, authentication, or query syntax failures.
 */
async function queryInstant(queryExpr, preferredProvider) {
    const config = getPrometheusConfig(preferredProvider);

    if (!config.isValid) {
        console.error(`[PrometheusService] Configuration error: ${config.configError}`);
        const err = new Error(config.configError);
        err.isConfigError = true;
        throw err;
    }

    const url = `${config.baseUrl}/api/v1/query`;
    const reqConfig = createRequestConfig(config, { query: queryExpr });

    try {
        const response = await axios.get(url, reqConfig);

        if (
            response.data &&
            response.data.status === "success" &&
            response.data.data &&
            Array.isArray(response.data.data.result)
        ) {
            const results = response.data.data.result;
            if (results.length === 0) {
                return null; // legitimately no matching series
            }

            if (results.length === 1 && results[0].value) {
                const val = parseFloat(results[0].value[1]);
                return isNaN(val) ? null : val;
            }

            // Aggregate multiple series by summing values
            let sum = 0;
            let validPoints = 0;
            for (const item of results) {
                if (item.value && item.value[1] != null) {
                    const n = parseFloat(item.value[1]);
                    if (!isNaN(n)) {
                        sum += n;
                        validPoints++;
                    }
                }
            }

            return validPoints > 0 ? sum : null;
        }

        return null;
    } catch (error) {
        const sanitized = sanitizeError(error, `queryInstant("${queryExpr}")`);
        console.error(`[PrometheusService] ${sanitized.message}`);
        throw sanitized;
    }
}

// ========================================================
// RANGE QUERY
// ========================================================

/**
 * Execute a range query against Prometheus returning array of { timestamp, time, fullTime, value }
 * Aggregates multi-series by timestamp if multiple series are returned.
 */
async function queryRange(queryExpr, startSeconds, endSeconds, stepSeconds, preferredProvider) {
    const config = getPrometheusConfig(preferredProvider);

    if (!config.isValid) {
        console.error(`[PrometheusService] Configuration error: ${config.configError}`);
        const err = new Error(config.configError);
        err.isConfigError = true;
        throw err;
    }

    const url = `${config.baseUrl}/api/v1/query_range`;
    const reqConfig = createRequestConfig(config, {
        query: queryExpr,
        start: startSeconds,
        end: endSeconds,
        step: stepSeconds
    });

    try {
        const response = await axios.get(url, reqConfig);

        if (
            response.data &&
            response.data.status === "success" &&
            response.data.data &&
            Array.isArray(response.data.data.result)
        ) {
            const results = response.data.data.result;
            if (results.length === 0) {
                return []; // legitimately empty
            }

            // Format single series
            if (results.length === 1) {
                const rawValues = results[0].values || [];
                return rawValues.map(([ts, valStr]) => {
                    const val = parseFloat(valStr);
                    const numVal = isNaN(val) ? 0 : val;
                    const d = new Date(ts * 1000);
                    const hours = String(d.getHours()).padStart(2, "0");
                    const minutes = String(d.getMinutes()).padStart(2, "0");
                    const seconds = String(d.getSeconds()).padStart(2, "0");
                    return {
                        timestamp: ts,
                        time: `${hours}:${minutes}`,
                        fullTime: `${hours}:${minutes}:${seconds}`,
                        value: parseFloat(numVal.toFixed(2))
                    };
                });
            }

            // Aggregate multiple series by summing values per timestamp
            const tsMap = new Map();
            for (const series of results) {
                if (!Array.isArray(series.values)) continue;
                for (const [ts, valStr] of series.values) {
                    const val = parseFloat(valStr);
                    const n = isNaN(val) ? 0 : val;
                    tsMap.set(ts, (tsMap.get(ts) || 0) + n);
                }
            }

            const sortedTimestamps = Array.from(tsMap.keys()).sort((a, b) => a - b);
            return sortedTimestamps.map((ts) => {
                const numVal = tsMap.get(ts);
                const d = new Date(ts * 1000);
                const hours = String(d.getHours()).padStart(2, "0");
                const minutes = String(d.getMinutes()).padStart(2, "0");
                const seconds = String(d.getSeconds()).padStart(2, "0");
                return {
                    timestamp: ts,
                    time: `${hours}:${minutes}`,
                    fullTime: `${hours}:${minutes}:${seconds}`,
                    value: parseFloat(numVal.toFixed(2))
                };
            });
        }

        return [];
    } catch (error) {
        const sanitized = sanitizeError(error, `queryRange("${queryExpr}")`);
        console.error(`[PrometheusService] ${sanitized.message}`);
        throw sanitized;
    }
}

// ========================================================
// HEALTH CHECK
// ========================================================

/**
 * Lightweight health check for the active Prometheus provider
 * Uses authenticated query "1" which is standard across Prometheus, Mimir, Cortex, and Grafana Cloud
 */
async function checkPrometheusHealth() {
    const config = getPrometheusConfig();

    if (!config.isValid) {
        return {
            healthy: false,
            provider: config.provider,
            isCloud: config.isCloud,
            error: config.configError
        };
    }

    try {
        const url = `${config.baseUrl}/api/v1/query`;
        const reqConfig = createRequestConfig(config, { query: "1" });
        reqConfig.timeout = 3000;

        const response = await axios.get(url, reqConfig);
        const isOk = response.data && response.data.status === "success";

        return {
            healthy: Boolean(isOk),
            provider: config.provider,
            isCloud: config.isCloud,
            error: isOk ? null : "Prometheus returned non-success status"
        };
    } catch (error) {
        const sanitized = sanitizeError(error, "health check");
        return {
            healthy: false,
            provider: config.provider,
            isCloud: config.isCloud,
            error: sanitized.message
        };
    }
}

/**
 * Specifically checks Grafana Cloud Prometheus metrics integration
 * Validates authentication and checks if active metric samples are being ingested
 */
async function checkGrafanaCloudHealth() {
    const cloudUrl = process.env.GRAFANA_CLOUD_PROMETHEUS_URL || process.env.GRAFANA_CLOUD_REMOTE_WRITE_URL;
    const cloudUser = process.env.GRAFANA_CLOUD_PROMETHEUS_USERNAME || process.env.GRAFANA_CLOUD_USER;
    const cloudToken = process.env.GRAFANA_CLOUD_PROMETHEUS_TOKEN || process.env.GRAFANA_CLOUD_API_KEY;

    if (!cloudUrl || !cloudUrl.trim()) {
        return {
            configured: false,
            healthy: false,
            ingested: false,
            details: "Grafana Cloud credentials not configured"
        };
    }

    if (!cloudUser || !cloudToken) {
        return {
            configured: false,
            healthy: false,
            ingested: false,
            details: "Missing Grafana Cloud username or API token"
        };
    }

    const config = {
        baseUrl: normalizeBaseUrl(cloudUrl),
        timeout: 5000,
        auth: {
            username: String(cloudUser).trim(),
            password: String(cloudToken).trim()
        }
    };

    try {
        const url = `${config.baseUrl}/api/v1/query`;
        const reqConfig = createRequestConfig(config, { query: "1" });
        reqConfig.timeout = 4000;
        const response = await axios.get(url, reqConfig);
        const isOk = response.data && response.data.status === "success";

        if (!isOk) {
            return {
                configured: true,
                healthy: false,
                ingested: false,
                details: "Grafana Cloud query returned non-success"
            };
        }

        // Check if real metrics exist in Grafana Cloud (verifying remote_write ingestion)
        let ingested = false;
        let seriesCount = 0;
        try {
            const upRes = await axios.get(url, createRequestConfig(config, { query: "count(up)" }));
            if (upRes.data?.status === "success" && Array.isArray(upRes.data?.data?.result) && upRes.data.data.result.length > 0) {
                seriesCount = parseFloat(upRes.data.data.result[0].value[1]) || 0;
                ingested = seriesCount > 0;
            }
        } catch (_) {}

        return {
            configured: true,
            healthy: true,
            ingested,
            seriesCount,
            details: ingested
                ? `Grafana Cloud active (${seriesCount} targets reporting)`
                : "Grafana Cloud connected (read ok), but awaiting ingested metrics"
        };
    } catch (error) {
        const sanitized = sanitizeError(error, "Grafana Cloud health check");
        return {
            configured: true,
            healthy: false,
            ingested: false,
            details: sanitized.message
        };
    }
}

/**
 * Specifically checks local Prometheus metrics integration
 */
async function checkLocalPrometheusHealth(isRenderOrProd) {
    const localUrl = process.env.PROMETHEUS_URL || "http://prometheus:9090";
    const isLocalhost = /localhost|127\.0\.0\.1|prometheus:9090/.test(localUrl);

    if (isRenderOrProd && isLocalhost) {
        return {
            configured: false,
            healthy: false,
            isLocalhost: true,
            details: "Localhost service — not accessible from cloud host"
        };
    }

    try {
        const normalized = normalizeBaseUrl(localUrl);
        const res = await axios.get(`${normalized}/-/healthy`, { timeout: 1500 });
        const ok = res.status >= 200 && res.status < 300;
        return {
            configured: true,
            healthy: ok,
            isLocalhost,
            details: ok ? "Local Prometheus online" : "Unhealthy response from Prometheus"
        };
    } catch (err) {
        return {
            configured: !isLocalhost,
            healthy: false,
            isLocalhost,
            details: `Unreachable at ${localUrl}`
        };
    }
}

module.exports = {
    PROMETHEUS_URL,
    queryInstant,
    queryRange,
    checkPrometheusHealth,
    checkGrafanaCloudHealth,
    checkLocalPrometheusHealth,
    getPrometheusConfig
};
