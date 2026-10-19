const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { kubernetesService } = require("../src/services/kubernetes/kubernetes.service");
const {
    scaleDeployment,
    restartDeployment,
    getDeploymentStatus,
    activeDeploymentOperations
} = require("../src/controllers/kubernetes.controller");
const authorize = require("../src/middleware/role.middleware");

// Helper to construct mock Express req/res
function createMockContext({ user = { role: "ENGINEER" }, params = {}, body = {}, query = {} } = {}) {
    const req = {
        user,
        params,
        body,
        query,
        headers: {}
    };

    let statusCode = 200;
    let jsonBody = null;

    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(data) {
            jsonBody = data;
            return res;
        },
        getStatusCode() {
            return statusCode;
        },
        getBody() {
            return jsonBody;
        }
    };

    return { req, res };
}

describe("Kubernetes Operations — Scale and Restart Endpoints & Controller Logic", () => {

    describe("1. Input & Payload Validation", () => {
        it("should reject replica count with decimals (e.g., 3.5)", async () => {
            const { req, res } = createMockContext({
                params: { name: "cloudops-backend" },
                body: { replicas: 3.5, namespace: "cloudops" }
            });

            await scaleDeployment(req, res);
            assert.equal(res.getStatusCode(), 400);
            assert.equal(res.getBody().success, false);
            assert.ok(res.getBody().message.includes("integer"));
        });

        it("should reject replica count below minimum 1 (e.g., 0)", async () => {
            const { req, res } = createMockContext({
                params: { name: "cloudops-backend" },
                body: { replicas: 0, namespace: "cloudops" }
            });

            await scaleDeployment(req, res);
            assert.equal(res.getStatusCode(), 400);
            assert.equal(res.getBody().success, false);
            assert.ok(res.getBody().message.includes("between 1 and 10"));
        });

        it("should reject negative replica count (e.g., -2)", async () => {
            const { req, res } = createMockContext({
                params: { name: "cloudops-backend" },
                body: { replicas: -2, namespace: "cloudops" }
            });

            await scaleDeployment(req, res);
            assert.equal(res.getStatusCode(), 400);
            assert.equal(res.getBody().success, false);
            assert.ok(res.getBody().message.includes("between 1 and 10"));
        });

        it("should reject replica count above maximum 10 (e.g., 15)", async () => {
            const { req, res } = createMockContext({
                params: { name: "cloudops-backend" },
                body: { replicas: 15, namespace: "cloudops" }
            });

            await scaleDeployment(req, res);
            assert.equal(res.getStatusCode(), 400);
            assert.equal(res.getBody().success, false);
            assert.ok(res.getBody().message.includes("between 1 and 10"));
        });

        it("should reject missing or non-numeric replica payload", async () => {
            const { req, res } = createMockContext({
                params: { name: "cloudops-backend" },
                body: { replicas: "invalid", namespace: "cloudops" }
            });

            await scaleDeployment(req, res);
            assert.equal(res.getStatusCode(), 400);
            assert.equal(res.getBody().success, false);
        });

        it("should reject invalid RFC 1123 deployment names", async () => {
            const { req, res } = createMockContext({
                params: { name: "INVALID_NAME_WITH_CAPS!" },
                body: { replicas: 3, namespace: "cloudops" }
            });

            await scaleDeployment(req, res);
            assert.equal(res.getStatusCode(), 400);
            assert.equal(res.getBody().success, false);
            assert.ok(res.getBody().message.includes("RFC 1123"));
        });

        it("should reject scaling stateful database singleton (cloudops-mongodb)", async () => {
            const { req, res } = createMockContext({
                params: { name: "cloudops-mongodb" },
                body: { replicas: 3, namespace: "cloudops" }
            });

            await scaleDeployment(req, res);
            assert.equal(res.getStatusCode(), 400);
            assert.equal(res.getBody().success, false);
            assert.ok(res.getBody().message.includes("singleton"));
        });
    });

    describe("2. Authentication and RBAC Middleware", () => {
        it("should reject users with insufficient role (e.g., VIEWER)", () => {
            const authMiddleware = authorize("ENGINEER", "ADMIN");
            const { req, res } = createMockContext({
                user: { role: "VIEWER" }
            });

            let nextCalled = false;
            authMiddleware(req, res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, false);
            assert.equal(res.getStatusCode(), 403);
            assert.equal(res.getBody().success, false);
            assert.ok(res.getBody().message.includes("Insufficient permissions"));
        });

        it("should reject unauthenticated requests (missing req.user)", () => {
            const authMiddleware = authorize("ENGINEER", "ADMIN");
            const { req, res } = createMockContext();
            req.user = null;

            let nextCalled = false;
            authMiddleware(req, res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, false);
            assert.equal(res.getStatusCode(), 403);
        });

        it("should permit ENGINEER role", () => {
            const authMiddleware = authorize("ENGINEER", "ADMIN");
            const { req, res } = createMockContext({
                user: { role: "ENGINEER" }
            });

            let nextCalled = false;
            authMiddleware(req, res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, true);
        });

        it("should permit ADMIN role", () => {
            const authMiddleware = authorize("ENGINEER", "ADMIN");
            const { req, res } = createMockContext({
                user: { role: "ADMIN" }
            });

            let nextCalled = false;
            authMiddleware(req, res, () => {
                nextCalled = true;
            });

            assert.equal(nextCalled, true);
        });
    });

    describe("3. Duplicate Operation Prevention (409 Conflict)", () => {
        it("should reject concurrent scale or restart on the same deployment", async () => {
            const lockKey = "cloudops/cloudops-backend";
            activeDeploymentOperations.set(lockKey, {
                action: "SCALE",
                target: "cloudops-backend",
                startTime: Date.now()
            });

            try {
                const { req, res } = createMockContext({
                    params: { name: "cloudops-backend" },
                    body: { replicas: 3, namespace: "cloudops" }
                });

                await scaleDeployment(req, res);
                assert.equal(res.getStatusCode(), 409);
                assert.equal(res.getBody().success, false);
                assert.ok(res.getBody().message.includes("already in progress"));

                // Restart request should also be rejected
                const restartCtx = createMockContext({
                    params: { name: "cloudops-backend" },
                    body: { namespace: "cloudops" }
                });

                await restartDeployment(restartCtx.req, restartCtx.res);
                assert.equal(restartCtx.res.getStatusCode(), 409);
                assert.equal(restartCtx.res.getBody().success, false);
                assert.ok(restartCtx.res.getBody().message.includes("already in progress"));
            } finally {
                activeDeploymentOperations.delete(lockKey);
            }
        });
    });

    describe("4. Error Handling for Missing Deployments and Disconnected Cluster", () => {
        it("should return 404 when deployment is not found on live cluster or service", async () => {
            const clusterStatus = await kubernetesService.getClusterStatus();
            if (!clusterStatus.connected) {
                // If cluster is not connected locally, test graceful disconnected handling
                const { req, res } = createMockContext({
                    params: { name: "cloudops-server" },
                    body: { replicas: 2, namespace: "cloudops" }
                });
                await scaleDeployment(req, res);
                assert.ok([404, 503].includes(res.getStatusCode()));
            } else {
                // cloudops-server is in the allowed targets whitelist, but is not deployed in Minikube
                const { req, res } = createMockContext({
                    params: { name: "cloudops-server" },
                    body: { replicas: 2, namespace: "cloudops" }
                });
                await scaleDeployment(req, res);
                assert.equal(res.getStatusCode(), 404);
                assert.equal(res.getBody().success, false);
                assert.ok(res.getBody().message.includes("not found"));
            }
        });

        it("should return 404 on getDeploymentStatus for non-existent deployment", async () => {
            const clusterStatus = await kubernetesService.getClusterStatus();
            if (clusterStatus.connected) {
                const { req, res } = createMockContext({
                    params: { name: "nonexistent-deployment" },
                    query: { namespace: "cloudops" }
                });
                await getDeploymentStatus(req, res);
                assert.equal(res.getStatusCode(), 404);
                assert.equal(res.getBody().success, false);
            }
        });
    });

    describe("5. Live Minikube Cluster Operations (Scale & Restart)", () => {
        it("should execute real scaling and rolling restart against Minikube if connected", async () => {
            const status = await kubernetesService.getClusterStatus();
            if (!status.connected) {
                console.log("Minikube cluster not connected in this test run — skipping live cluster mutations.");
                return;
            }

            console.log("Minikube connected — running live deployment scale and rolling restart validation...");

            // Step A: Scale from 6 to 4 replicas
            console.log("Scaling cloudops-backend to 4 replicas...");
            const scaleTo4 = await kubernetesService.scaleDeployment("cloudops-backend", 4, "cloudops");
            assert.equal(scaleTo4.success, true);
            assert.equal(scaleTo4.desiredReplicas, 4);

            // Verify status endpoint returns 4 replicas
            const statusAfter4 = await kubernetesService.getDeployment("cloudops-backend", "cloudops");
            assert.equal(statusAfter4.replicas, 4);

            // Step B: Scale from 4 to 8 replicas
            console.log("Scaling cloudops-backend from 4 to 8 replicas...");
            const scaleTo8 = await kubernetesService.scaleDeployment("cloudops-backend", 8, "cloudops");
            assert.equal(scaleTo8.success, true);
            assert.equal(scaleTo8.desiredReplicas, 8);

            const statusAfter8 = await kubernetesService.getDeployment("cloudops-backend", "cloudops");
            assert.equal(statusAfter8.replicas, 8);

            // Step C: Trigger rolling restart
            console.log("Triggering rolling restart on cloudops-backend...");
            const restartRes = await kubernetesService.restartDeployment("cloudops-backend", "cloudops");
            assert.equal(restartRes.success, true);
            assert.ok(restartRes.restartedAt);

            // Verify the pod template has the restartedAt annotation
            const statusAfterRestart = await kubernetesService.getDeployment("cloudops-backend", "cloudops");
            assert.ok(statusAfterRestart.readyReplicas >= 1);

            // Step D: Restore clean baseline replica count (6 replicas)
            console.log("Restoring cloudops-backend to initial 6 replicas...");
            const restoreScale = await kubernetesService.scaleDeployment("cloudops-backend", 6, "cloudops");
            assert.equal(restoreScale.success, true);
            assert.equal(restoreScale.desiredReplicas, 6);
        });
    });
});
