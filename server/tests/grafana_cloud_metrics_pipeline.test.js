const test = require("node:test");
const assert = require("node:assert");

// Load prometheus service
const {
    getPrometheusConfig,
    checkPrometheusHealth,
    checkGrafanaCloudHealth,
    checkLocalPrometheusHealth
} = require("../src/services/prometheus.service");

test.describe("Grafana Cloud Metrics & Prometheus Ingestion Pipeline", () => {
    const originalEnv = { ...process.env };

    test.beforeEach(() => {
        // Reset relevant environment variables before each test
        delete process.env.GRAFANA_CLOUD_PROMETHEUS_URL;
        delete process.env.GRAFANA_CLOUD_PROMETHEUS_USERNAME;
        delete process.env.GRAFANA_CLOUD_PROMETHEUS_TOKEN;
        delete process.env.GRAFANA_CLOUD_REMOTE_WRITE_URL;
        delete process.env.GRAFANA_CLOUD_USER;
        delete process.env.GRAFANA_CLOUD_API_KEY;
        delete process.env.PROMETHEUS_URL;
    });

    test.afterEach(() => {
        // Restore original environment
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, originalEnv);
    });

    test.describe("1. Environment Variable Normalization & Fallbacks", () => {
        test("should default to local provider when no cloud credentials are configured", () => {
            const config = getPrometheusConfig();
            assert.strictEqual(config.provider, "local");
            assert.strictEqual(config.isCloud, false);
            assert.strictEqual(config.isValid, true);
            assert.strictEqual(config.baseUrl, "http://prometheus:9090");
            assert.strictEqual(config.auth, null);
        });

        test("should respect GRAFANA_CLOUD_PROMETHEUS_* variables", () => {
            process.env.GRAFANA_CLOUD_PROMETHEUS_URL = "https://prometheus-prod-43.grafana.net/api/prom";
            process.env.GRAFANA_CLOUD_PROMETHEUS_USERNAME = "3651411";
            process.env.GRAFANA_CLOUD_PROMETHEUS_TOKEN = "glc_token_123";

            const config = getPrometheusConfig();
            assert.strictEqual(config.provider, "grafana_cloud");
            assert.strictEqual(config.isCloud, true);
            assert.strictEqual(config.isValid, true);
            assert.strictEqual(config.baseUrl, "https://prometheus-prod-43.grafana.net/api/prom");
            assert.strictEqual(config.auth.username, "3651411");
            assert.strictEqual(config.auth.password, "glc_token_123");
        });

        test("should fallback to GRAFANA_CLOUD_REMOTE_WRITE_URL, USER, API_KEY when PROMETHEUS_* variables are unset", () => {
            process.env.GRAFANA_CLOUD_REMOTE_WRITE_URL = "https://prometheus-prod-43.grafana.net/api/prom/push";
            process.env.GRAFANA_CLOUD_USER = "3651411";
            process.env.GRAFANA_CLOUD_API_KEY = "glc_api_key_456";

            const config = getPrometheusConfig();
            assert.strictEqual(config.provider, "grafana_cloud");
            assert.strictEqual(config.isCloud, true);
            assert.strictEqual(config.isValid, true);
            // Notice: /push should be automatically stripped for the query baseUrl
            assert.strictEqual(config.baseUrl, "https://prometheus-prod-43.grafana.net/api/prom");
            assert.strictEqual(config.auth.username, "3651411");
            assert.strictEqual(config.auth.password, "glc_api_key_456");
        });

        test("should strip trailing slashes, /push, and /api/v1 from baseUrl", () => {
            process.env.GRAFANA_CLOUD_PROMETHEUS_URL = "https://prometheus-prod-43.grafana.net/api/prom/push///";
            process.env.GRAFANA_CLOUD_PROMETHEUS_USERNAME = "123456";
            process.env.GRAFANA_CLOUD_PROMETHEUS_TOKEN = "token";

            const config = getPrometheusConfig();
            assert.strictEqual(config.baseUrl, "https://prometheus-prod-43.grafana.net/api/prom");
        });

        test("should flag configuration error if cloud URL is set without credentials", () => {
            process.env.GRAFANA_CLOUD_PROMETHEUS_URL = "https://prometheus-prod-43.grafana.net/api/prom";

            const config = getPrometheusConfig();
            assert.strictEqual(config.provider, "grafana_cloud");
            assert.strictEqual(config.isCloud, true);
            assert.strictEqual(config.isValid, false);
            assert.ok(config.configError.includes("username or API token is missing"));
        });
    });

    test.describe("2. Provider Selection via preferredProvider", () => {
        test("should allow forcing local provider even if Grafana Cloud is configured", () => {
            process.env.GRAFANA_CLOUD_PROMETHEUS_URL = "https://prometheus-prod-43.grafana.net/api/prom";
            process.env.GRAFANA_CLOUD_PROMETHEUS_USERNAME = "123456";
            process.env.GRAFANA_CLOUD_PROMETHEUS_TOKEN = "token";

            const config = getPrometheusConfig("local");
            assert.strictEqual(config.provider, "local");
            assert.strictEqual(config.isCloud, false);
            assert.strictEqual(config.baseUrl, "http://prometheus:9090");
        });

        test("should allow forcing grafana_cloud provider explicitly", () => {
            process.env.GRAFANA_CLOUD_REMOTE_WRITE_URL = "https://prometheus-prod-43.grafana.net/api/prom/push";
            process.env.GRAFANA_CLOUD_USER = "123456";
            process.env.GRAFANA_CLOUD_API_KEY = "token";

            const config = getPrometheusConfig("grafana_cloud");
            assert.strictEqual(config.provider, "grafana_cloud");
            assert.strictEqual(config.isCloud, true);
            assert.strictEqual(config.baseUrl, "https://prometheus-prod-43.grafana.net/api/prom");
        });
    });

    test.describe("3. Security & Secret Protection", () => {
        test("should never expose tokens in error strings or health details when unconfigured", async () => {
            process.env.GRAFANA_CLOUD_API_KEY = "SUPER_SECRET_TOKEN_DO_NOT_LEAK";
            // Missing URL and user:
            const health = await checkGrafanaCloudHealth();
            const healthJson = JSON.stringify(health);

            assert.strictEqual(healthJson.includes("SUPER_SECRET_TOKEN_DO_NOT_LEAK"), false);
            assert.strictEqual(health.configured, false);
        });
    });
});
