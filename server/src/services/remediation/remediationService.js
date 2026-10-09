const Incident = require("../../models/Incident");
const RemediationAction = require("../../models/remediationAction.model");

const { evaluatePolicy } = require("./policyEngine");
const { generateRemediationDecision } = require("./aiDecision");
const { createExecutor } = require("./executor");
const { verifyRemediation, captureMetric } = require("./verification");

const { REMEDIATION_STATUS } = require("../../config/remediation.config");


// =========================================
// EXECUTE REMEDIATION FOR INCIDENT
// =========================================

async function executeRemediation(incidentId) {

    console.log("\n========================================");
    console.log("🚀 REMEDIATION PIPELINE STARTED");
    console.log(`   Incident: ${incidentId}`);
    console.log("========================================");


    // -------------------------------------------
    // 1. FIND INCIDENT
    // -------------------------------------------

    const incident =
        await Incident.findById(incidentId);

    if (!incident) {
        throw new Error(
            `Incident not found: ${incidentId}`
        );
    }

    console.log(
        `📋 Incident: ${incident.title}`
    );


    // -------------------------------------------
    // 2. GET REMEDIATION DECISION
    // -------------------------------------------

    let decision = incident.remediationDecision;

    if (!decision || !decision.action) {

        console.log(
            "🤖 No stored decision, generating..."
        );

        decision = await generateRemediationDecision(
            incident,
            incident.aiAnalysis
        );

        if (decision) {

            await Incident.updateOne(
                { _id: incident._id },
                { $set: { remediationDecision: decision } }
            );
        }
    }


    if (!decision || !decision.action) {

        console.log(
            "⚠️ No remediation action recommended"
        );

        const record = await RemediationAction.create({
            incident: incident._id,
            action: "RESTART_SERVICE",
            target: "unknown",
            reason: "AI could not determine a remediation action",
            triggeredBy: "CloudOps AI",
            status: REMEDIATION_STATUS.REJECTED,
            policy: {
                approved: false,
                rule: null,
                reason: "No valid AI recommendation produced"
            },
            error: "AI decision was null or invalid"
        });

        return {
            success: false,
            message: "No valid remediation action recommended by AI",
            action: record
        };
    }


    console.log(
        `🎯 Decision: ${decision.action} → ${decision.target}`
    );


    // -------------------------------------------
    // 3. POLICY EVALUATION
    // -------------------------------------------

    console.log("📋 Evaluating policy...");

    const policyResult = evaluatePolicy(
        incident,
        decision.action,
        decision.target
    );


    // Create the remediation action record
    const actionRecord = await RemediationAction.create({
        incident: incident._id,
        connection: incident.connectionId || null,
        action: decision.action,
        target: decision.target,
        reason: decision.reason,
        triggeredBy: "CloudOps AI",
        status: policyResult.approved
            ? REMEDIATION_STATUS.APPROVED
            : REMEDIATION_STATUS.REJECTED,
        policy: {
            approved: policyResult.approved,
            rule: policyResult.rule,
            reason: policyResult.reason
        }
    });


    if (!policyResult.approved) {

        console.log(
            `❌ Policy REJECTED: ${policyResult.reason}`
        );

        // Update incident remediation status
        await Incident.updateOne(
            { _id: incident._id },
            { $set: { remediationStatus: "REJECTED" } }
        );

        return {
            success: false,
            message:
                `Policy rejected: ${policyResult.reason}`,
            action: actionRecord
        };
    }


    // -------------------------------------------
    // 4. CAPTURE PRE-EXECUTION METRICS
    // -------------------------------------------

    console.log("📊 Capturing pre-execution metrics...");

    const verifyMetric =
        policyResult.verifyMetric || "service_up";

    const beforeValue =
        await captureMetric(verifyMetric);


    // -------------------------------------------
    // 5. EXECUTE REMEDIATION
    // -------------------------------------------

    console.log("⚡ Executing remediation...");

    actionRecord.status = REMEDIATION_STATUS.EXECUTING;
    actionRecord.startedAt = new Date();
    await actionRecord.save();

    // Update incident status
    await Incident.updateOne(
        { _id: incident._id },
        { $set: { remediationStatus: "EXECUTING" } }
    );


    const executorContext = { incident, beforeValue, connectionId: incident.connectionId };
    const executor = createExecutor(undefined, executorContext);
    actionRecord.executor = executor.getName();
    await actionRecord.save();

    let executionResult;

    try {

        executionResult = await executor.execute(
            decision.action,
            decision.target,
            executorContext
        );


        if (!executionResult.success) {

            actionRecord.status = REMEDIATION_STATUS.FAILED;
            actionRecord.completedAt = new Date();
            actionRecord.result = executionResult.message;
            actionRecord.error = executionResult.message;
            await actionRecord.save();

            await Incident.updateOne(
                { _id: incident._id },
                { $set: { remediationStatus: "FAILED" } }
            );

            console.log(
                `❌ Execution failed: ${executionResult.message}`
            );

            return {
                success: false,
                message: executionResult.message,
                action: actionRecord
            };
        }


        actionRecord.result = executionResult.message;

        console.log(
            `✅ Execution completed: ${executionResult.message}`
        );


    } catch (error) {

        console.error(
            "❌ Execution error:",
            error.message
        );

        actionRecord.status = REMEDIATION_STATUS.FAILED;
        actionRecord.completedAt = new Date();
        actionRecord.error = error.message;
        await actionRecord.save();

        await Incident.updateOne(
            { _id: incident._id },
            { $set: { remediationStatus: "FAILED" } }
        );

        return {
            success: false,
            message:
                `Execution failed: ${error.message}`,
            action: actionRecord
        };
    }


    // -------------------------------------------
    // 6. VERIFY REMEDIATION
    // -------------------------------------------

    console.log("🔍 Starting verification...");

    const verification = await verifyRemediation(
        verifyMetric,
        beforeValue,
        {
            executor: executionResult?.executor,
            deploymentName: executionResult?.deploymentName,
            previousReplicas: executionResult?.previousReplicas,
            newReplicas: executionResult?.newReplicas,
            namespace: executionResult?.namespace
        }
    );


    actionRecord.verification = verification;
    actionRecord.completedAt = new Date();


    if (verification.status === "SUCCESS") {

        actionRecord.status = REMEDIATION_STATUS.SUCCESS;

        await actionRecord.save();

        // Update incident
        await Incident.updateOne(
            { _id: incident._id },
            {
                $set: {
                    status: "resolved",
                    remediationStatus: "SUCCESS"
                }
            }
        );

        console.log(
            "✅ REMEDIATION SUCCESSFUL — Incident resolved"
        );


    } else if (verification.status === "FAILED") {

        actionRecord.status = REMEDIATION_STATUS.FAILED;

        await actionRecord.save();

        await Incident.updateOne(
            { _id: incident._id },
            { $set: { remediationStatus: "FAILED" } }
        );

        console.log(
            "❌ VERIFICATION FAILED — Incident remains open"
        );


    } else {

        actionRecord.status = REMEDIATION_STATUS.UNVERIFIED;

        await actionRecord.save();

        await Incident.updateOne(
            { _id: incident._id },
            { $set: { remediationStatus: "UNVERIFIED" } }
        );

        console.log(
            "⚠️ VERIFICATION UNVERIFIED — Incident remains open"
        );
    }


    // -------------------------------------------
    // 7. AUDIT SUMMARY
    // -------------------------------------------

    console.log("\n========================================");
    console.log("📝 REMEDIATION AUDIT TRAIL");
    console.log("========================================");
    console.log(`Incident:      ${incident.title}`);
    console.log(`Action:        ${decision.action}`);
    console.log(`Target:        ${decision.target}`);
    console.log(`Reason:        ${decision.reason}`);
    console.log(`Triggered By:  CloudOps AI`);
    console.log(`Policy:        ${policyResult.approved ? "APPROVED" : "REJECTED"}`);
    console.log(`Execution:     ${executionResult.success ? "SUCCESS" : "FAILED"}`);
    console.log(`Verification:  ${verification.status}`);

    if (verification.before !== null && verification.after !== null) {
        console.log(
            `Result:        ${verification.metric} ${verification.before} → ${verification.after}`
        );
    }

    console.log("========================================\n");


    return {
        success:
            actionRecord.status === REMEDIATION_STATUS.SUCCESS,
        message:
            verification.message || actionRecord.result,
        action: actionRecord
    };
}


// =========================================
// GET REMEDIATION HISTORY
// =========================================

async function getRemediationHistory(incidentId) {

    const actions = await RemediationAction
        .find({ incident: incidentId })
        .sort({ createdAt: -1 });

    return actions;
}


// =========================================
// GET REMEDIATION ACTION BY ID
// =========================================

async function getRemediationById(actionId) {

    const action = await RemediationAction
        .findById(actionId);

    return action;
}


module.exports = {
    executeRemediation,
    getRemediationHistory,
    getRemediationById
};
