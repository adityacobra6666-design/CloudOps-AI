const crypto = require("crypto");
const bcrypt = require("bcrypt");
const User = require("../models/user.model");
const generateToken = require("../utils/generateToken");
const { sendPasswordResetEmail } = require("../services/email/email.service");
const { logAuditEvent } = require("../utils/auditLogger");

// Helper: Compute SHA-256 hash for secure token storage
const hashToken = (token) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};

// Helper: Set HttpOnly JWT Cookie on response
const setAuthCookie = (res, token) => {
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("cloudops_token", token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "strict" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
};

// ================================
// REGISTER CONTROLLER
// ================================
const register = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and password are required."
            });
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character (@$!%*?&)."
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists with this email address."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name: String(name).trim(),
            email: normalizedEmail,
            password: hashedPassword,
            role: role ? String(role).toUpperCase() : "VIEWER"
        });

        logAuditEvent("REGISTER", { userId: user._id, email: normalizedEmail, role: user.role });

        return res.status(201).json({
            success: true,
            message: "User registered successfully.",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("[AUTH REGISTER ERROR]:", error.message);
        return res.status(500).json({
            success: false,
            message: "Registration failed. Please try again."
        });
    }
};

// ================================
// LOGIN CONTROLLER
// ================================
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            logAuditEvent("LOGIN_FAILURE", { email: normalizedEmail, reason: "User not found" });
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const match = await bcrypt.compare(String(password), user.password);

        if (!match) {
            logAuditEvent("LOGIN_FAILURE", { userId: user._id, email: normalizedEmail, reason: "Password mismatch" });
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        // Generate JWT and set HttpOnly Cookie
        const token = generateToken(user);
        setAuthCookie(res, token);

        user.lastLoginAt = new Date();
        await user.save();

        logAuditEvent("LOGIN_SUCCESS", { userId: user._id, email: normalizedEmail, role: user.role });

        return res.json({
            success: true,
            token, // Included for authorization headers or API clients
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("[AUTH LOGIN ERROR]:", error.message);
        return res.status(500).json({
            success: false,
            message: "Login failed."
        });
    }
};

// ================================
// LOGOUT CONTROLLER
// ================================
const logout = async (req, res) => {
    try {
        if (req.user) {
            logAuditEvent("LOGOUT", { userId: req.user._id, email: req.user.email });
        }
        res.clearCookie("cloudops_token");
        return res.json({
            success: true,
            message: "Logged out successfully."
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Logout failed."
        });
    }
};

// ================================
// GET CURRENT USER (/api/auth/me)
// ================================
const getMe = async (req, res) => {
    try {
        return res.json({
            success: true,
            user: req.user
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve user session."
        });
    }
};

// ================================
// FORGOT PASSWORD CONTROLLER
// ================================
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email address is required."
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });

        const genericMessage = "If an account exists for this email, a password reset link has been sent.";

        if (!user) {
            logAuditEvent("FORGOT_PASSWORD_REQUEST", { email: normalizedEmail, userFound: false });
            return res.json({
                success: true,
                message: genericMessage
            });
        }

        // Generate 32-byte reset token & store SHA-256 hash with 1-hour expiry
        const rawResetToken = crypto.randomBytes(32).toString("hex");
        user.passwordResetTokenHash = hashToken(rawResetToken);
        user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 Hour
        await user.save();

        const emailResult = await sendPasswordResetEmail(user.email, user.name, rawResetToken);

        if (!emailResult.success) {
            console.error(`[AUTH FORGOT PASSWORD ERROR] Failed to send reset email to ${user.email}:`, emailResult.error);
            return res.status(502).json({
                success: false,
                message: "Failed to send password reset email. Email provider is not configured or rejected delivery."
            });
        }

        logAuditEvent("FORGOT_PASSWORD_REQUEST", { userId: user._id, email: user.email, userFound: true });

        return res.json({
            success: true,
            message: genericMessage
        });
    } catch (error) {
        console.error("[AUTH FORGOT PASSWORD ERROR]:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to process password reset request."
        });
    }
};

// ================================
// RESET PASSWORD CONTROLLER
// ================================
const resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({
                success: false,
                message: "Reset token and new password are required."
            });
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character (@$!%*?&)."
            });
        }

        const tokenHash = hashToken(token);

        const user = await User.findOne({
            passwordResetTokenHash: tokenHash,
            passwordResetExpiresAt: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired password reset token."
            });
        }

        // Update password hash & invalidate reset token fields
        user.password = await bcrypt.hash(password, 10);
        user.passwordResetTokenHash = null;
        user.passwordResetExpiresAt = null;
        await user.save();

        logAuditEvent("PASSWORD_RESET_COMPLETED", { userId: user._id, email: user.email });

        return res.json({
            success: true,
            message: "Password reset successful! You can now log in with your new password."
        });
    } catch (error) {
        console.error("[AUTH RESET PASSWORD ERROR]:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to reset password."
        });
    }
};

module.exports = {
    register,
    login,
    logout,
    getMe,
    forgotPassword,
    resetPassword
};