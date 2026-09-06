const express = require("express");
const cors = require("cors");
const client = require("prom-client");

// Routes
const incidentRoutes = require("./routes/incident.route");
const authRoutes = require("./routes/auth.routes");
const eventRoutes = require("./routes/event.routes");
const remediationRoutes = require("./routes/remediation.routes");
const metricsRoutes = require("./routes/metrics.routes");
const reliabilityRoutes = require("./routes/reliability.routes");
const kubernetesRoutes = require("./routes/kubernetes.routes");
const observabilityRoutes = require("./routes/observability.routes");

const app = express();

// ======================================================
// PROMETHEUS METRICS REGISTRY
// ======================================================

const register = new client.Registry();

client.collectDefaultMetrics({
    register
});

const httpRequestsTotal = new client.Counter({
    name: "cloudops_http_requests_total",
    help: "Total number of HTTP requests received",
    labelNames: ["method", "route", "status_code"]
});

const httpRequestDuration = new client.Histogram({
    name: "cloudops_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDuration);

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP METRICS MIDDLEWARE
app.use((req, res, next) => {
    const start = process.hrtime();
    res.on("finish", () => {
        const diff = process.hrtime(start);
        const duration = diff[0] + diff[1] / 1e9;
        const route = req.route?.path || req.path || "unknown";
        const labels = {
            method: req.method,
            route,
            status_code: res.statusCode.toString()
        };
        httpRequestsTotal.inc(labels);
        httpRequestDuration.observe(labels, duration);
    });
    next();
});

// ======================================================
// HEALTH CHECK & SIMULATED FAILURE
// ======================================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "CloudOps AI Backend Running 🚀"
    });
});

app.get("/api/test-error", (req, res) => {
    res.status(500).json({
        success: false,
        message: "Simulated CloudOps failure"
    });
});

app.get("/metrics", async (req, res) => {
    try {
        res.set("Content-Type", register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        console.error("Metrics Error:", error.message);
        res.status(500).end();
    }
});

// ======================================================
// API ROUTES
// ======================================================

app.use("/api/auth", authRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/remediation", remediationRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/reliability", reliabilityRoutes);
app.use("/api/kubernetes", kubernetesRoutes);
app.use("/api/observability", observabilityRoutes);

// ======================================================
// ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
    console.error("SERVER ERROR:", err.message);
    res.status(500).json({
        success: false,
        message: "Internal Server Error"
    });
});

module.exports = app;