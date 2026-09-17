import {
    BrowserRouter,
    Routes,
    Route,
    Navigate,
    useLocation,
    useNavigate,
} from "react-router-dom";

import DarkVeil from "./components/DarkVeil";
import Layout from "./components/Layout";

import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Overview from "./pages/Overview";
import Infrastructure from "./pages/Infrastructure";
import IncidentsPage from "./pages/IncidentsPage";
import AIOperations from "./pages/AIOperations";
import KubernetesPage from "./pages/KubernetesPage";
import ReliabilityPage from "./pages/ReliabilityPage";
import ObservabilityPage from "./pages/ObservabilityPage";
import { useAuth } from "./context/AuthContext";

import "./index.css";
import "./AuthOverlay.css";

/* =========================================
   PROTECTED ROUTE
========================================= */

function ProtectedRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();

    if (loading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "#94a3b8" }}>
                <div className="auth-spinner" style={{ width: "24px", height: "24px", borderWidth: "3px" }}></div>
                <span style={{ marginLeft: "12px", fontSize: "0.95rem" }}>Authenticating session...</span>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

import ThemeToggle from "./components/ThemeToggle";

/* =========================================
   AUTH / USER ACTIONS
========================================= */

function TopActions() {
    const location = useLocation();
    const navigate = useNavigate();

    const isAuthPage = ["/login", "/register", "/forgot-password", "/reset-password"].includes(location.pathname);

    if (!isAuthPage) return null;

    return (
        <div className="global-auth-nav">
            {location.pathname === "/login" && (
                <>
                    <span className="auth-nav-text">Don't have an account?</span>
                    <button type="button" className="auth-nav-button" onClick={() => navigate("/register")}>
                        Create Account
                    </button>
                </>
            )}
            {location.pathname === "/register" && (
                <>
                    <span className="auth-nav-text">Already have an account?</span>
                    <button type="button" className="auth-nav-button" onClick={() => navigate("/login")}>
                        Login
                    </button>
                </>
            )}
            {["/forgot-password", "/reset-password"].includes(location.pathname) && (
                <button type="button" className="auth-nav-button" onClick={() => navigate("/login")}>
                    Back to Login
                </button>
            )}
            <ThemeToggle />
        </div>
    );
}

/* =========================================
   MAIN APP
========================================= */

function App() {
    return (
        <BrowserRouter>
            {/* FULL SCREEN BACKGROUND */}
            <DarkVeil
                hueShift={0}
                noiseIntensity={0.04}
                scanlineIntensity={0.03}
                speed={0.35}
                scanlineFrequency={0}
                warpAmount={0.15}
                resolutionScale={1}
            />

            {/* LOGIN / REGISTER NAVIGATION ACTIONS */}
            <TopActions />

            {/* APPLICATION ROUTES */}
            <div className="app-content">
                <Routes>
                    {/* PUBLIC AUTH ROUTES */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />

                    {/* PROTECTED CONTROL CENTER ROUTES */}
                    <Route
                        path="/"
                        element={
                            <ProtectedRoute>
                                <Layout />
                            </ProtectedRoute>
                        }
                    >
                        <Route index element={<Overview />} />
                        <Route path="observability" element={<ObservabilityPage />} />
                        <Route path="infrastructure" element={<Infrastructure />} />
                        <Route path="incidents" element={<IncidentsPage />} />
                        <Route path="ai-ops" element={<AIOperations />} />
                        <Route path="kubernetes" element={<KubernetesPage />} />
                        <Route path="reliability" element={<ReliabilityPage />} />
                    </Route>

                    {/* FALLBACK ROUTE */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </div>
        </BrowserRouter>
    );
}

export default App;