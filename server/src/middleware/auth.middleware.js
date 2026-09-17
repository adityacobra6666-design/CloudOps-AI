const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

/**
 * Protect Middleware: Verifies JWT token from HttpOnly cookie or Authorization header
 */
const protect = async (req, res, next) => {
    try {
        let token = null;

        // 1. Try HttpOnly Cookie first
        if (req.cookies && req.cookies.cloudops_token) {
            token = req.cookies.cloudops_token;
        }
        // 2. Fallback to Authorization Header if provided
        else if (
            req.headers.authorization &&
            req.headers.authorization.startsWith("Bearer")
        ) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. Session token missing."
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error("[AUTH] FATAL: JWT_SECRET environment variable is not set.");
            return res.status(500).json({
                success: false,
                message: "Server configuration error. Please contact the administrator."
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const user = await User.findById(decoded.id).select("-password -emailVerificationTokenHash -passwordResetTokenHash");

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User account no longer exists."
            });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired authentication session."
        });
    }
};

/**
 * RBAC Authorization Middleware: Enforces server-side role permissions
 * Example: requireRole("ADMIN", "ENGINEER")
 */
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const userRole = (req.user.role || "").toUpperCase();
        const normalizedAllowedRoles = allowedRoles.map(r => r.toUpperCase());

        if (!normalizedAllowedRoles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Requires one of the following roles: ${allowedRoles.join(", ")}.`
            });
        }

        next();
    };
};

module.exports = {
    protect,
    requireRole
};