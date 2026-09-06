import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerUser } from "../services/api";


function Register() {

    const navigate = useNavigate();

    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        role: "VIEWER"
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");


    const handleChange = (event) => {

        const {
            name,
            value
        } = event.target;

        setForm((previous) => ({
            ...previous,
            [name]: value
        }));

        setError("");
        setSuccess("");
    };


    const handleSubmit = async (event) => {

        event.preventDefault();

        setError("");
        setSuccess("");


        if (
            !form.name.trim() ||
            !form.email.trim() ||
            !form.password.trim()
        ) {

            setError(
                "Please fill all required fields."
            );

            return;
        }


        if (form.password.length < 6) {

            setError(
                "Password must be at least 6 characters."
            );

            return;
        }


        try {

            setLoading(true);

            await registerUser(form);

            setSuccess(
                "Account created successfully! Redirecting to login..."
            );


            setTimeout(() => {
                navigate("/login");
            }, 1200);


        } catch (err) {

            console.error(
                "Registration Error:",
                err
            );

            setError(
                err?.message ||
                "Registration failed. Please try again."
            );

        } finally {

            setLoading(false);

        }

    };


    return (

        <div className="auth-page">

            <div className="auth-card register-card">


                {/* LOGO */}

                <div className="auth-logo">

                    <div className="auth-logo-icon">
                        ☁
                    </div>

                </div>


                {/* HEADER */}

                <div className="auth-header">

                    <h1>
                        Create Account
                    </h1>

                    <p>
                        Join CloudOps AI and manage incidents smarter
                    </p>

                </div>


                {/* ERROR */}

                {error && (

                    <div className="auth-error">

                        <span>
                            ✕
                        </span>

                        <span>
                            {error}
                        </span>

                    </div>

                )}


                {/* SUCCESS */}

                {success && (

                    <div className="auth-success">

                        <span>
                            ✓
                        </span>

                        <span>
                            {success}
                        </span>

                    </div>

                )}


                {/* FORM */}

                <form
                    className="auth-form"
                    onSubmit={handleSubmit}
                >


                    {/* NAME */}

                    <div className="form-group">

                        <label>
                            Full Name
                        </label>

                        <input
                            type="text"
                            name="name"
                            placeholder="Enter your name"
                            value={form.name}
                            onChange={handleChange}
                            autoComplete="name"
                        />

                    </div>


                    {/* EMAIL */}

                    <div className="form-group">

                        <label>
                            Email
                        </label>

                        <input
                            type="email"
                            name="email"
                            placeholder="you@example.com"
                            value={form.email}
                            onChange={handleChange}
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
                            name="password"
                            placeholder="Create a password"
                            value={form.password}
                            onChange={handleChange}
                            autoComplete="new-password"
                        />

                        <span className="input-hint">
                            Minimum 6 characters
                        </span>

                    </div>


                    {/* ROLE */}

                    <div className="form-group">

                        <label>
                            Account Role
                        </label>

                        <select
                            name="role"
                            value={form.role}
                            onChange={handleChange}
                        >

                            <option value="VIEWER">
                                Viewer — Read only
                            </option>

                            <option value="ENGINEER">
                                Engineer — Manage incidents
                            </option>

                            <option value="ADMIN">
                                Admin — Full access
                            </option>

                        </select>

                    </div>


                    {/* REGISTER */}

                    <button
                        type="submit"
                        className="auth-submit"
                        disabled={loading}
                    >

                        {loading ? (

                            <>
                                <span className="auth-spinner"></span>
                                Creating Account...
                            </>

                        ) : (

                            <>
                                Create Account
                            </>

                        )}

                    </button>

                </form>


                {/* LOGIN */}

                <div className="auth-divider">

                    <span>
                        OR
                    </span>

                </div>


                <div className="register-link">

                    <span>
                        Already have an account?
                    </span>

                    <button
                        type="button"
                        onClick={() =>
                            navigate("/login")
                        }
                    >
                        Sign in
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


export default Register;