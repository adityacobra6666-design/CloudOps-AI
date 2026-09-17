const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const client = require("prom-client");
const mongoose = require("mongoose");

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
// SECURITY & ESSENTIAL MIDDLEWARE
// ======================================================

app.use(helmet());
app.use(cookieParser());

// Build allowed origins from CORS_ORIGINS env var + sensible defaults
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
    : [];

const allowedOrigins = [
    ...corsOrigins,
    process.env.CLIENT_URL,
    // Development defaults (only when no explicit CORS_ORIGINS is set)
    ...(!process.env.CORS_ORIGINS ? [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000"
    ] : [])
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, Prometheus scraping, curl)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: Origin ${origin} is not allowed`));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Global API Rate Limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests from this IP, please try again later." }
});

app.use("/api/", apiLimiter);

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
// ROOT ENDPOINT
// ======================================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "CloudOps AI Backend Running 🚀"
    });
});

// ======================================================
// HEALTH CHECK (with real dependency status)
// ======================================================

app.get(["/health", "/api/health"], async (req, res) => {
    const axios = require("axios");
    const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
    const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";

    const isDbHealthy = mongoose.connection.readyState === 1;

    let isPrometheusHealthy = false;
    let isOllamaHealthy = false;

    await Promise.allSettled([
        axios.get(`${PROMETHEUS_URL}/-/healthy`, { timeout: 1500 })
            .then(() => { isPrometheusHealthy = true; }).catch(() => {}),
        axios.get(`${OLLAMA_URL}/api/version`, { timeout: 1500 })
            .then(() => { isOllamaHealthy = true; }).catch(() => {})
    ]);

    const status = isDbHealthy ? "healthy" : "unhealthy";
    const httpStatus = isDbHealthy ? 200 : 503;

    res.status(httpStatus).json({
        success: isDbHealthy,
        status,
        timestamp: new Date().toISOString(),
        dependencies: {
            database: isDbHealthy ? "healthy" : "unhealthy",
            prometheus: isPrometheusHealthy ? "healthy" : "unavailable",
            ollama: isOllamaHealthy ? "healthy" : "unavailable"
        }
    });
});

// ======================================================
// SIMULATED FAILURE (Development Only)
// ======================================================

if (process.env.NODE_ENV !== "production") {
    app.get("/api/test-error", (req, res) => {
        res.status(500).json({
            success: false,
            message: "Simulated CloudOps failure"
        });
    });
}

// ======================================================
// PROMETHEUS METRICS ENDPOINT
// ======================================================

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
// 404 NOT FOUND HANDLER (Guarantees JSON, never HTML)
// ======================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `API endpoint not found: ${req.method} ${req.originalUrl}`
    });
});

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