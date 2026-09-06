import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginUser } from "../services/api";
import { useAuth } from "../context/AuthContext";


function Login() {

    const navigate = useNavigate();

    const { login } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");


    const handleSubmit = async (event) => {

        event.preventDefault();

        setError("");


        if (!email.trim() || !password.trim()) {

            setError(
                "Please enter email and password."
            );

            return;
        }


        try {

            setLoading(true);


            // Call backend
            const response = await loginUser({
                email: email.trim(),
                password
            });


            console.log("LOGIN RESPONSE:", response);


            // Save token + user in AuthContext
            login(response);


            // Go to dashboard
            navigate("/", {
                replace: true
            });


        } catch (err) {

            console.error(
                "Login Error:",
                err
            );

            setError(
                err.message ||
                "Invalid email or password."
            );

        } finally {

            setLoading(false);

        }

    };


    return (

        <div className="auth-page">

            <div className="auth-card">


                {/* LOGO */}

                <div className="auth-logo">

                    <div className="auth-logo-icon">
                        ☁
                    </div>

                </div>


                {/* HEADER */}

                <div className="auth-header">

                    <h1>
                        CloudOps AI
                    </h1>

                    <p>
                        Sign in to your dashboard
                    </p>

                </div>


                {/* ERROR */}

                {error && (

                    <div className="auth-error">

                        <span>✕</span>

                        <span>
                            {error}
                        </span>

                    </div>

                )}


                {/* FORM */}

                <form
                    className="auth-form"
                    onSubmit={handleSubmit}
                >


                    {/* EMAIL */}

                    <div className="form-group">

                        <label>
                            Email
                        </label>

                        <input
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(event) =>
                                setEmail(
                                    event.target.value
                                )
                            }
                            autoComplete="email"
                        />

                    </div>


                    {/* PASSWORD */}

                    <div className="form-group">

                        <label>
                            Password
                        </label>

                        <input
                            type="password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(event) =>
                                setPassword(
                                    event.target.value
                                )
                            }
                            autoComplete="current-password"
                        />

                    </div>


                    {/* LOGIN */}

                    <button
                        type="submit"
                        className="auth-submit"
                        disabled={loading}
                    >

                        {loading ? (

                            <>
                                <span className="auth-spinner"></span>
                                Signing in...
                            </>

                        ) : (

                            "Sign In"

                        )}

                    </button>


                </form>


                {/* REGISTER */}

                <div className="auth-divider">

                    <span>
                        OR
                    </span>

                </div>


                <div className="register-link">

                    <span>
                        Don't have an account?
                    </span>

                    <button
                        type="button"
                        onClick={() =>
                            navigate("/register")
                        }
                    >
                        Create an account
                    </button>

                </div>


                {/* FOOTER */}

                <div className="auth-footer">

                    <span>
                        CloudOps AI
                    </span>

                    <span>
                        •
                    </span>

                    <span>
                        Intelligent Incident Management
                    </span>

                </div>


            </div>

        </div>

    );

}


export default Login;