import { useState, useEffect, useCallback } from "react";
import { getOverviewMetrics } from "../services/api";

export function useMetrics(pollIntervalMs = 5000) {
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const fetchMetrics = useCallback(async () => {
        try {
            const data = await getOverviewMetrics();
            if (data && data.success) {
                setMetrics(data.metrics);
                setLastUpdated(new Date());
                setError(null);
            }
        } catch (err) {
            setError(err.message || "Failed to fetch live metrics");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMetrics();
        const interval = setInterval(fetchMetrics, pollIntervalMs);
        return () => clearInterval(interval);
    }, [fetchMetrics, pollIntervalMs]);

    return { metrics, loading, error, lastUpdated, refetch: fetchMetrics };
}
