const axios = require("axios");

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";

/**
 * Execute an instant query against Prometheus
 */
async function queryInstant(queryExpr) {
    try {
        const url = `${PROMETHEUS_URL}/api/v1/query`;
        const response = await axios.get(url, {
            params: { query: queryExpr },
            timeout: 5000
        });

        if (
            response.data &&
            response.data.status === "success" &&
            response.data.data &&
            response.data.data.result &&
            response.data.data.result.length > 0
        ) {
            const val = parseFloat(response.data.data.result[0].value[1]);
            return isNaN(val) ? 0 : val;
        }

        return 0;
    } catch (error) {
        console.error(`Prometheus queryInstant error ("${queryExpr}"):`, error.message);
        return 0;
    }
}

/**
 * Execute a range query against Prometheus returning array of { timestamp, time, value }
 */
async function queryRange(queryExpr, startSeconds, endSeconds, stepSeconds) {
    try {
        const url = `${PROMETHEUS_URL}/api/v1/query_range`;
        const response = await axios.get(url, {
            params: {
                query: queryExpr,
                start: startSeconds,
                end: endSeconds,
                step: stepSeconds
            },
            timeout: 8000
        });

        if (
            response.data &&
            response.data.status === "success" &&
            response.data.data &&
            response.data.data.result &&
            response.data.data.result.length > 0
        ) {
            const rawValues = response.data.data.result[0].values;
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

        return [];
    } catch (error) {
        console.error(`Prometheus queryRange error ("${queryExpr}"):`, error.message);
        return [];
    }
}

module.exports = {
    PROMETHEUS_URL,
    queryInstant,
    queryRange
};
