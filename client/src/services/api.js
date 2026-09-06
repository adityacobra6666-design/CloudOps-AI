const API_URL = "http://localhost:5000/api";

export const getIncidents = async () => {
    const response = await fetch(
        `${API_URL}/incidents`
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to fetch incidents"
        );
    }

    return result;
};

export const createIncident = async (incidentData) => {
    const response = await fetch(
        `${API_URL}/incidents`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(incidentData)
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to create incident"
        );
    }

    return result;
};

export const updateIncident = async (
    incidentId,
    incidentData
) => {
    const response = await fetch(
        `${API_URL}/incidents/${incidentId}`,
        {
            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(incidentData)
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to update incident"
        );
    }

    return result;
};

export const deleteIncident = async (incidentId) => {
    const response = await fetch(
        `${API_URL}/incidents/${incidentId}`,
        {
            method: "DELETE"
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to delete incident"
        );
    }

    return result;
};

export const analyzeIncident = async (incidentId) => {
    const response = await fetch(
        `${API_URL}/incidents/${incidentId}/analyze`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            }
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to analyze incident"
        );
    }

    return result;
};

export const getIncidentActivity = async (incidentId) => {
    const response = await fetch(
        `${API_URL}/incidents/${incidentId}/activity`
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to fetch incident activity"
        );
    }

    return result;
};

export const loginUser = async (userData) => {
    const response = await fetch(
        `${API_URL}/auth/login`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(userData)
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Login failed"
        );
    }

    return result;
};

export const registerUser = async (userData) => {
    const response = await fetch(
        `${API_URL}/auth/register`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ...userData,
                role: userData.role.toUpperCase()
            })
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Registration failed"
        );
    }

    return result;
};

// =========================================
// REMEDIATION APIs
// =========================================

export const executeRemediation = async (incidentId) => {
    const response = await fetch(
        `${API_URL}/remediation/${incidentId}/execute`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            }
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to execute remediation"
        );
    }

    return result;
};

export const getRemediationHistory = async (incidentId) => {
    const response = await fetch(
        `${API_URL}/remediation/${incidentId}/history`
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to fetch remediation history"
        );
    }

    return result;
};

export const getRemediationStatus = async (actionId) => {
    const response = await fetch(
        `${API_URL}/remediation/actions/${actionId}`
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.message || "Failed to fetch remediation status"
        );
    }

    return result;
};

// =========================================
// CONTROL CENTER APIs
// =========================================

export const getAllRemediationActions = async () => {
    const response = await fetch(`${API_URL}/remediation/actions`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch remediation actions");
    return result;
};

export const getOverviewMetrics = async () => {
    const response = await fetch(`${API_URL}/metrics/overview`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch overview metrics");
    return result;
};

export const getServicesHealth = async () => {
    const response = await fetch(`${API_URL}/metrics/services`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch services health");
    return result;
};

export const getSystemHealth = async () => {
    const response = await fetch(`${API_URL}/metrics/system-health`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch system health");
    return result;
};

export const getReliabilityOverview = async () => {
    const response = await fetch(`${API_URL}/reliability/overview`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch reliability overview");
    return result;
};

// =========================================
// KUBERNETES APIs
// =========================================

export const getKubernetesOverview = async (namespace) => {
    const url = namespace ? `${API_URL}/kubernetes/overview?namespace=${namespace}` : `${API_URL}/kubernetes/overview`;
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch kubernetes overview");
    return result;
};

export const getKubernetesStatus = async () => {
    const response = await fetch(`${API_URL}/kubernetes/status`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch kubernetes status");
    return result;
};

export const getKubernetesHealth = async () => {
    const response = await fetch(`${API_URL}/kubernetes/health`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch kubernetes health");
    return result;
};

export const getKubernetesNodes = async () => {
    const response = await fetch(`${API_URL}/kubernetes/nodes`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch kubernetes nodes");
    return result;
};

export const getKubernetesPods = async (namespace) => {
    const url = namespace ? `${API_URL}/kubernetes/pods?namespace=${namespace}` : `${API_URL}/kubernetes/pods`;
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch kubernetes pods");
    return result;
};

export const getKubernetesDeployments = async (namespace) => {
    const url = namespace ? `${API_URL}/kubernetes/deployments?namespace=${namespace}` : `${API_URL}/kubernetes/deployments`;
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch kubernetes deployments");
    return result;
};

export const getKubernetesServices = async (namespace) => {
    const url = namespace ? `${API_URL}/kubernetes/services?namespace=${namespace}` : `${API_URL}/kubernetes/services`;
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch kubernetes services");
    return result;
};

export const executeKubernetesAction = async (actionData) => {
    const response = await fetch(`${API_URL}/kubernetes/action`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(actionData)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to execute kubernetes action");
    return result;
};

// =========================================
// OBSERVABILITY APIs
// =========================================

export const getObservabilityTelemetry = async (range = "30m", signal = null) => {
    const url = `${API_URL}/observability/telemetry?range=${range}`;
    const response = await fetch(url, { signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Failed to fetch observability telemetry");
    return result;
};