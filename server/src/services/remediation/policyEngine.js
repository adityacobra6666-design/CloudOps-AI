const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS,
    POLICY_RULES
} = require("../../config/remediation.config");


// =========================================
// VALIDATE ACTION
// =========================================

function isValidAction(action) {
    return ALLOWED_ACTIONS.includes(action);
}


// =========================================
// VALIDATE TARGET
// =========================================

function isValidTarget(target) {
    return target in ALLOWED_TARGETS;
}


// =========================================
// FIND MATCHING POLICY RULE
// =========================================

function findMatchingRule(incident, action) {

    const textToSearch = [
        incident.title || "",
        incident.description || "",
        incident.category || "",
        incident.aiAnalysis || ""
    ]
        .join(" ")
        .toLowerCase();

    const severity =
        String(incident.severity || "").toLowerCase();

    for (const rule of POLICY_RULES) {

        // Check if any keyword matches
        const keywordMatch =
            rule.match.keywords.some(
                keyword =>
                    textToSearch.includes(keyword)
            );

        // Check severity match
        const severityMatch =
            rule.match.severities.includes(severity);

        // Check if action is allowed by this rule
        const actionAllowed =
            rule.allowedActions.includes(action);

        if (keywordMatch && severityMatch && actionAllowed) {
            return rule;
        }
    }

    return null;
}


// =========================================
// EVALUATE POLICY
// =========================================

function evaluatePolicy(incident, action, target) {

    console.log(
        `📋 Policy evaluation: action=${action} target=${target}`
    );


    // -------------------------------------------
    // 1. VALIDATE ACTION
    // -------------------------------------------

    if (!isValidAction(action)) {

        const reason =
            `Action "${action}" is not in the allowed actions list`;

        console.log(
            `❌ Policy REJECTED: ${reason}`
        );

        return {
            approved: false,
            rule: null,
            reason
        };
    }


    // -------------------------------------------
    // 2. VALIDATE TARGET
    // -------------------------------------------

    if (!isValidTarget(target)) {

        const reason =
            `Target "${target}" is not in the allowed targets list`;

        console.log(
            `❌ Policy REJECTED: ${reason}`
        );

        return {
            approved: false,
            rule: null,
            reason
        };
    }


    // -------------------------------------------
    // 3. FIND MATCHING RULE
    // -------------------------------------------

    const matchedRule =
        findMatchingRule(incident, action);

    if (!matchedRule) {

        const reason =
            `No policy rule matches action "${action}" for this incident context`;

        console.log(
            `❌ Policy REJECTED: ${reason}`
        );

        return {
            approved: false,
            rule: null,
            reason
        };
    }


    // -------------------------------------------
    // 4. APPROVED
    // -------------------------------------------

    console.log(
        `✅ Policy APPROVED via rule: ${matchedRule.name}`
    );

    return {
        approved: true,
        rule: matchedRule.name,
        reason:
            `Approved by policy rule: ${matchedRule.name}`,
        verifyMetric: matchedRule.verifyMetric
    };
}


module.exports = {
    evaluatePolicy,
    isValidAction,
    isValidTarget,
    findMatchingRule
};
