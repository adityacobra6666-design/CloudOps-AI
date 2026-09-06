const axios = require("axios");

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";
const PROMETHEUS_TIMEOUT = 5000;

// Helper to query Prometheus instant vector
async function queryPrometheusInstant(query) {
    try {
        const res = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
            params: { query },
            timeout: PROMETHEUS_TIMEOUT
        });
        const val = res.data?.data?.result?.[0]?.value?.[1];
        const num = parseFloat(val);
        return isNaN(num) ? null : num;
    } catch (err) {
        console.error(`Prometheus instant query error (${query}):`, err.message);
        return null;
    }
}

// Helper to query Prometheus range matrix
async function queryPrometheusRange(query, start, end, step) {
    try {
        const res = await axios.get(`${PROMETHEUS_URL}/api/v1/query_range`, {
            params: { query, start, end, step },
            timeout: PROMETHEUS_TIMEOUT
        });
        return res.data?.data?.result || [];
    } catch (err) {
        console.error(`Prometheus range query error (${query}):`, err.message);
        return [];
    }
}

// =========================================
// GET RELIABILITY OVERVIEW & SLO METRICS
// =========================================
exports.getReliabilityOverview = async (req, res) => {
    try {
        // Configurable SLO Targets (preserve existing project definitions)
        const availabilityTarget = 99.90; // %
        const latencyTarget = 500;        // ms
        const errorRateTarget = 1.00;     // %

        // 1. AVAILABILITY SLO (Real Prometheus calculation over 1h window)
        // Primary: avg_over_time of up metric for cloudops-server service
        let rawAvail = await queryPrometheusInstant('avg_over_time(up{job="cloudops-server"}[1h]) * 100');
        if (rawAvail === null) {
            // Fallback: check general up metric for cloudops-server or exporter
            rawAvail = await queryPrometheusInstant('avg_over_time(up{job="cloudops-server"}[5m]) * 100');
            if (rawAvail === null) {
                const isUp = await queryPrometheusInstant('up{job="cloudops-server"}');
                rawAvail = isUp === 1 ? 100.0 : isUp === 0 ? 0.0 : null;
            }
        }

        const availabilityCurrent = rawAvail !== null ? parseFloat(Math.min(100, Math.max(0, rawAvail)).toFixed(2)) : 100.0;

        // 2. P95 LATENCY SLO (Real Prometheus calculation over 1h window)
        let rawLat = await queryPrometheusInstant('histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[1h])) by (le)) * 1000');
        if (rawLat === null) {
            rawLat = await queryPrometheusInstant('histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) * 1000');
        }
        const latencyCurrent = rawLat !== null ? Math.round(rawLat) : 0;

        // 3. ERROR RATE SLO (Real Prometheus calculation over 1h window)
        let rawErr = await queryPrometheusInstant('(sum(increase(cloudops_http_requests_total{status_code=~"5.."}[1h])) / clamp_min(sum(increase(cloudops_http_requests_total[1h])), 1)) * 100');
        if (rawErr === null) {
            rawErr = await queryPrometheusInstant('(sum(rate(cloudops_http_requests_total{status_code=~"5.."}[5m])) / clamp_min(sum(rate(cloudops_http_requests_total[5m])), 0.001)) * 100');
        }
        const errorRateCurrent = rawErr !== null ? parseFloat(Math.max(0, rawErr).toFixed(2)) : 0.00;

        // 4. ERROR BUDGET CALCULATION
        // Allowed Unavailability = 100% - SLO Target (e.g. 100 - 99.90 = 0.10%)
        const allowedUnavailPercent = parseFloat((100 - availabilityTarget).toFixed(2)); // 0.10%
        // Observed Unavailability % = max(0, 100 - availabilityCurrent)
        const observedUnavailPercent = parseFloat(Math.max(0, 100 - availabilityCurrent).toFixed(2));
        
        // Account for error rate or downtime in budget usage
        const effectiveObservedError = Math.max(observedUnavailPercent, errorRateCurrent);
        
        // Used Budget % = (effectiveObservedError / allowedUnavailPercent) * 100
        const usedPercent = parseFloat(Math.min(100, Math.max(0, (effectiveObservedError / allowedUnavailPercent) * 100)).toFixed(1));
        const remainingPercent = parseFloat((100 - usedPercent).toFixed(1));

        // 5. BURN RATE CALCULATION
        // Burn Rate = Observed Error Rate / Allowed Error Rate (0.10%)
        const rawBurnRate = parseFloat((effectiveObservedError / allowedUnavailPercent).toFixed(1));
        const burnRateStr = `${rawBurnRate}x`;

        // 6. RELIABILITY RISK ASSESSMENT (Deterministic thresholds)
        // HIGH: Remaining Error Budget < 20% OR Burn Rate >= 2.0x
        // MEDIUM: Remaining Error Budget < 50% OR Burn Rate >= 1.0x
        // LOW: Remaining Error Budget >= 50% AND Burn Rate < 1.0x
        let reliabilityRisk = "LOW";
        if (remainingPercent < 20 || rawBurnRate >= 2.0) {
            reliabilityRisk = "HIGH";
        } else if (remainingPercent < 50 || rawBurnRate >= 1.0) {
            reliabilityRisk = "MEDIUM";
        }

        // 7. HISTORICAL SLO TREND (Real Prometheus query_range over last 7 days)
        const start = Math.floor((Date.now() - 7 * 86400 * 1000) / 1000);
        const end = Math.floor(Date.now() / 1000);
        const step = 86400; // 1 day

        const [availRangeResult, latRangeResult, errRangeResult] = await Promise.all([
            queryPrometheusRange('avg_over_time(up{job="cloudops-server"}[1d]) * 100', start, end, step),
            queryPrometheusRange('histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[1d])) by (le)) * 1000', start, end, step),
            queryPrometheusRange('(sum(increase(cloudops_http_requests_total{status_code=~"5.."}[1d])) / clamp_min(sum(increase(cloudops_http_requests_total[1d])), 1)) * 100', start, end, step)
        ]);

        const availSeries = availRangeResult?.[0]?.values || [];
        const latSeries = latRangeResult?.[0]?.values || [];
        const errSeries = errRangeResult?.[0]?.values || [];

        const history = [];

        if (availSeries.length > 0) {
            availSeries.forEach((item, index) => {
                const ts = item[0] * 1000;
                const isToday = index === availSeries.length - 1;
                const isYesterday = index === availSeries.length - 2;

                let dateLabel = new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                if (isToday) dateLabel = "Today";
                else if (isYesterday) dateLabel = "Yesterday";

                const hAvail = parseFloat(Math.min(100, Math.max(0, parseFloat(item[1]))).toFixed(2));
                const hLat = latSeries[index] ? Math.round(parseFloat(latSeries[index][1])) : 0;
                const hErr = errSeries[index] ? parseFloat(parseFloat(errSeries[index][1]).toFixed(2)) : 0.0;

                history.push({
                    date: dateLabel,
                    availability: isNaN(hAvail) ? 100.0 : hAvail,
                    latency: isNaN(hLat) ? 0 : hLat,
                    errorRate: isNaN(hErr) ? 0.0 : hErr
                });
            });
        }

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            slos: {
                availability: {
                    name: "Availability SLO",
                    current: availabilityCurrent,
                    target: availabilityTarget,
                    unit: "%",
                    status: availabilityCurrent >= availabilityTarget ? "HEALTHY" : "VIOLATED",
                    period: "30d"
                },
                latency: {
                    name: "P95 Latency SLO",
                    current: latencyCurrent,
                    target: latencyTarget,
                    unit: "ms",
                    status: (latencyCurrent === 0 || latencyCurrent <= latencyTarget) ? "HEALTHY" : "VIOLATED",
                    period: "30d"
                },
                errorRate: {
                    name: "Error Rate SLO",
                    current: errorRateCurrent,
                    target: errorRateTarget,
                    unit: "%",
                    status: errorRateCurrent <= errorRateTarget ? "HEALTHY" : "VIOLATED",
                    period: "30d"
                }
            },
            errorBudget: {
                totalPercent: 100,
                usedPercent,
                remainingPercent,
                burnRate: burnRateStr,
                risk: reliabilityRisk
            },
            history
        });

    } catch (error) {
        console.error("Error calculating reliability overview from Prometheus:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch reliability metrics from Prometheus",
            error: error.message
        });
    }
};
