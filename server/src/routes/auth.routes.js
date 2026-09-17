const express = require("express");
const rateLimit = require("express-rate-limit");
const {
    register,
    login,
    logout,
    getMe,
    forgotPassword,
    resetPassword
} = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");

const router = express.Router();

// Rate Limiter for Authentication Endpoints (Brute-force protection)
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minutes
    max: 20, // Limit each IP to 20 auth attempts per 15 mins
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many authentication requests from this IP. Please try again after 15 minutes."
    }
});

// PUBLIC AUTH ROUTES (Rate limited)
router.post("/register", authRateLimiter, register);
router.post("/login", authRateLimiter, login);
router.post("/forgot-password", authRateLimiter, forgotPassword);
router.post("/reset-password", authRateLimiter, resetPassword);

// PROTECTED AUTH ROUTES
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);

module.exports = router;