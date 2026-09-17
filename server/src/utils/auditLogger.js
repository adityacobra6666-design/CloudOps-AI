/**
 * Security Audit Logging Helper
 * Formats and records non-sensitive operational & security events.
 */

const logAuditEvent = (event, metadata = {}) => {
    const timestamp = new Date().toISOString();
    
    // Sanitize metadata to strip any sensitive values accidentally passed
    const safeMetadata = { ...metadata };
    delete safeMetadata.password;
    delete safeMetadata.passwordHash;
    delete safeMetadata.token;
    delete safeMetadata.tokenHash;
    delete safeMetadata.secret;

    console.log(`[SECURITY AUDIT] ${timestamp} | EVENT: ${event} | META:`, JSON.stringify(safeMetadata));
};

module.exports = {
    logAuditEvent
};
