import React, { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext();

const THEME_KEY = "cloudops-theme";

export function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState(() => {
        try {
            const savedTheme = localStorage.getItem(THEME_KEY);
            if (savedTheme === "dark" || savedTheme === "light") {
                return savedTheme;
            }
        } catch (e) {
            console.error("Error reading theme from localStorage", e);
        }
        return "light";
    });

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (e) {
            console.error("Error saving theme to localStorage", e);
        }
    }, [theme]);

    const toggleTheme = () => {
        setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
    };

    const setTheme = (newTheme) => {
        if (newTheme === "dark" || newTheme === "light") {
            setThemeState(newTheme);
        }
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
