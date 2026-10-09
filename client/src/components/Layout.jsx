import React, { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import ErrorBoundary from "./ErrorBoundary";

export default function Layout() {
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = useNavigate();

    // Retrieve user profile from localStorage
    const storedUser = localStorage.getItem("user");
    let user = null;
    try {
        if (storedUser) user = JSON.parse(storedUser);
    } catch (e) {}

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/login");
    };

    return (
        <div className="control-center-shell">
            <Sidebar
                mobileOpen={mobileOpen}
                setMobileOpen={setMobileOpen}
                user={user}
                onLogout={handleLogout}
            />

            <div className="main-content-wrapper">
                <main className="main-viewport">
                    <ErrorBoundary>
                        <Outlet context={{ user, mobileOpen, setMobileOpen }} />
                    </ErrorBoundary>
                </main>
            </div>
        </div>
    );
}
