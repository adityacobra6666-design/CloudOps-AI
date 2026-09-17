import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { resetPassword } from "../services/api";

function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");
    const navigate = useNavigate();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!token) {
            setError("Invalid or missing reset token.");
            return;
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            setError("Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.");
            return;
        }

        try {
            setLoading(true);
            await resetPassword(token, password);
            setSuccess(true);
        } catch (err) {
            setError(err.message || "Failed to reset password. The link may have expired.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-logo">
                    <div className="auth-logo-icon">☁</div>
                </div>

                <div className="auth-header">
                    <h1>Reset Password</h1>
                    <p>Enter your new account password</p>
                </div>

                {error && (
                    <div className="auth-error">
                        <span>✕</span>
                        <span>{error}</span>
                    </div>
                )}

                {success ? (
                    <div style={{ textAlign: "center", padding: "16px 0" }}>
                        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🔒</div>
                        <h2 style={{ color: "#10b981", fontSize: "1.2rem", marginBottom: "8px" }}>Password Reset Complete</h2>
                        <p style={{ color: "var(--text-secondary, #cbd5e1)", marginBottom: "20px" }}>
                            Your password has been updated successfully. You can now log in with your new password.
                        </p>
                        <button
                            type="button"
                            className="auth-submit"
                            onClick={() => navigate("/login")}
                        >
                            Sign In Now
                        </button>
                    </div>
                ) : (
                    <form className="auth-form" onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>New Password</label>
                            <input
                                type="password"
                                placeholder="At least 8 chars, 1 uppercase, 1 special"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                            />
                        </div>

                        <div className="form-group">
                            <label>Confirm New Password</label>
                            <input
                                type="password"
                                placeholder="Confirm new password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                            />
                        </div>

                        <button
                            type="submit"
                            className="auth-submit"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <span className="auth-spinner"></span>
                                    Resetting...
                                </>
                            ) : (
                                "Update Password"
                            )}
                        </button>
                    </form>
                )}

                <div className="register-link" style={{ marginTop: "20px" }}>
                    <button type="button" onClick={() => navigate("/login")}>
                        Back to Sign In
                    </button>
                </div>

                <div className="auth-footer" style={{ marginTop: "24px" }}>
                    <span>CloudOps AI</span>
                    <span>•</span>
                    <span>Intelligent Incident Management</span>
                </div>
            </div>
        </div>
    );
}

export default ResetPassword;
