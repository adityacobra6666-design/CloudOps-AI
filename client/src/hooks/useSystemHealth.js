import { useState, useEffect, useCallback } from "react";
import { getServicesHealth } from "../services/api";

export function useSystemHealth(pollIntervalMs = 5000) {
    const [services, setServices] = useState([]);
    const [globalStatus, setGlobalStatus] = useState("DEGRADED");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const fetchHealth = useCallback(async () => {
        try {
            const data = await getServicesHealth();
            if (data && data.success) {
                setServices(data.services || []);
                setGlobalStatus(data.globalStatus || "HEALTHY");
                setLastUpdated(new Date());
                setError(null);
            }
        } catch (err) {
            setError(err.message || "Failed to fetch service health");
            setGlobalStatus("DEGRADED");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchHealth();
        const interval = setInterval(fetchHealth, pollIntervalMs);
        return () => clearInterval(interval);
    }, [fetchHealth, pollIntervalMs]);

    return { services, globalStatus, loading, error, lastUpdated, refetch: fetchHealth };
}
