import {
    createContext,
    useContext,
    useEffect,
    useState
} from "react";
import { getCurrentUser, logoutUser } from "../services/api";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem("token"));
    const [loading, setLoading] = useState(true);

    // Verify session with server on boot
    useEffect(() => {
        let isMounted = true;
        const checkAuth = async () => {
            try {
                const res = await getCurrentUser();
                if (isMounted && res.success && res.user) {
                    setUser(res.user);
                    // Retain token in state/localStorage for authorization fallback if needed
                    if (res.token) {
                        setToken(res.token);
                        localStorage.setItem("token", res.token);
                    }
                    localStorage.setItem("user", JSON.stringify(res.data));
                }
            } catch (err) {
                // If checking user session fails, check if local storage has cached session
                const savedUser = localStorage.getItem("user");
                const savedToken = localStorage.getItem("token");
                if (savedUser && savedToken) {
                    try {
                        setUser(JSON.parse(savedUser));
                        setToken(savedToken);
                    } catch (e) {
                        localStorage.removeItem("user");
                        localStorage.removeItem("token");
                    }
                } else {
                    setUser(null);
                    setToken(null);
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        checkAuth();
        return () => { isMounted = false; };
    }, []);

    // LOGIN METHOD
    const login = (data) => {
        if (data.token) {
            localStorage.setItem("token", data.token);
            setToken(data.token);
        }
        if (data.user) {
            localStorage.setItem("user", JSON.stringify(data.user));
            setUser(data.user);
        }
    };

    // LOGOUT METHOD
    const logout = async () => {
        try {
            await logoutUser();
        } catch (err) {
            console.error("Logout request error:", err);
        } finally {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            setToken(null);
            setUser(null);
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                loading,
                login,
                logout,
                isAuthenticated: !!user || !!token
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    return useContext(AuthContext);
};