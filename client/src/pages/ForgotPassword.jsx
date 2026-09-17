import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forgotPassword } from "../services/api";

function ForgotPassword() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");

        if (!email.trim()) {
            setError("Please enter your registered email address.");
            return;
        }

        try {
            setLoading(true);
            const res = await forgotPassword(email.trim());
            setMessage(res.message || "If an account exists with that email, a password reset link has been sent.");
        } catch (err) {
            setError(err.message || "Failed to process request.");
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
                    <h1>Forgot Password</h1>
                    <p>Enter your email to receive a password reset link</p>
                </div>

                {error && (
                    <div className="auth-error">
                        <span>✕</span>
                        <span>{error}</span>
                    </div>
                )}

                {message ? (
                    <div style={{ textAlign: "center", padding: "16px 0" }}>
                        <div style={{ fontSize: "36px", marginBottom: "12px" }}>📧</div>
                        <p style={{ color: "#38bdf8", fontSize: "0.95rem", lineHeight: "1.5", marginBottom: "20px" }}>
                            {message}
                        </p>
                        <button
                            type="button"
                            className="auth-submit"
                            onClick={() => navigate("/login")}
                        >
                            Return to Sign In
                        </button>
                    </div>
                ) : (
                    <form className="auth-form" onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Account Email</label>
                            <input
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
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
                                    Sending...
                                </>
                            ) : (
                                "Send Reset Link"
                            )}
                        </button>
                    </form>
                )}

                <div className="register-link" style={{ marginTop: "20px" }}>
                    <span>Remember your password?</span>
                    <button type="button" onClick={() => navigate("/login")}>
                        Sign In
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

export default ForgotPassword;
