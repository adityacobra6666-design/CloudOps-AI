const axios = require("axios");

class PrometheusCollector {
    constructor(prometheusUrl) {
        this.prometheusUrl = prometheusUrl;
        this.client = axios.create({
            baseURL: prometheusUrl,
            timeout: 5000
        });

        // Whitelist of supported PromQL queries (Agent will NEVER execute arbitrary PromQL)
        this.queries = {
            cpu: `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`,
            memory: `100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`,
            requestRate: `sum(rate(cloudops_http_requests_total[1m])) or vector(0)`,
            errorRate: `((sum(rate(cloudops_http_requests_total{status_code=~"5.."}[1m])) or vector(0)) / clamp_min(sum(rate(cloudops_http_requests_total[1m])) or vector(0.001), 0.001)) * 100`,
            p95Latency: `(histogram_quantile(0.95, sum(rate(cloudops_http_request_duration_seconds_bucket[5m])) by (le)) or vector(0)) * 1000`,
            networkRx: `sum(rate(container_network_receive_bytes_total{name=~".+"}[1m])) / 1024`,
            networkTx: `sum(rate(container_network_transmit_bytes_total{name=~".+"}[1m])) / 1024`
        };
    }

    async queryMetric(queryExpr) {
        try {
            const response = await this.client.get("/api/v1/query", {
                params: { query: queryExpr }
            });

            if (
                response.data?.status === "success" &&
                response.data?.data?.result &&
                response.data.data.result.length > 0
            ) {
                const val = parseFloat(response.data.data.result[0].value[1]);
                return isNaN(val) ? 0 : val;
            }
            return 0;
        } catch (error) {
            return 0;
        }
    }

    async collectMetrics() {
        try {
            const [
                cpu, memory, requestRate, errorRate, p95Latency, networkRx, networkTx
            ] = await Promise.all([
                this.queryMetric(this.queries.cpu),
                this.queryMetric(this.queries.memory),
                this.queryMetric(this.queries.requestRate),
                this.queryMetric(this.queries.errorRate),
                this.queryMetric(this.queries.p95Latency),
                this.queryMetric(this.queries.networkRx),
                this.queryMetric(this.queries.networkTx)
            ]);

            return {
                cpu: parseFloat(cpu.toFixed(1)),
                memory: parseFloat(memory.toFixed(1)),
                requestRate: parseFloat(requestRate.toFixed(2)),
                errorRate: parseFloat(errorRate.toFixed(2)),
                p95Latency: Math.round(p95Latency),
                networkRx: parseFloat(networkRx.toFixed(1)),
                networkTx: parseFloat(networkTx.toFixed(1))
            };
        } catch (err) {
            console.warn(`[PROMETHEUS COLLECTOR] Collection notice: ${err.message}`);
            return {
                cpu: 0,
                memory: 0,
                requestRate: 0,
                errorRate: 0,
                p95Latency: 0,
                networkRx: 0,
                networkTx: 0
            };
        }
    }
}

module.exports = PrometheusCollector;
