const nodemailer = require("nodemailer");

const getFrontendPublicUrl = () => {
    return (
        process.env.FRONTEND_PUBLIC_URL ||
        process.env.APP_PUBLIC_URL ||
        process.env.CLIENT_URL ||
        "http://localhost:5173"
    ).replace(/\/+$/, "");
};

const getSenderEmail = (smtpUser) => {
    if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
    if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
    if (smtpUser && smtpUser.includes("@")) {
        return `"CloudOps AI" <${smtpUser}>`;
    }
    return '"CloudOps AI" <noreply@cloudops.ai>';
};

let transporter = null;

const initTransporter = () => {
    const service = process.env.EMAIL_SERVICE;
    const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
    const user = process.env.SMTP_USER || process.env.EMAIL_USER || process.env.SMTP_USERNAME;
    const rawPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
    const pass = rawPass ? rawPass.trim() : null;

    const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || "587", 10);
    const secure = (process.env.SMTP_SECURE || process.env.EMAIL_SECURE) === "true" || port === 465;

    if (service && user && pass) {
        // Strip spaces in App Passwords for Gmail
        const cleanPass = service.toLowerCase() === "gmail" ? pass.replace(/\s+/g, "") : pass;
        transporter = nodemailer.createTransport({
            service,
            auth: { user, pass: cleanPass }
        });
        console.log(`[EMAIL SERVICE] Configured SMTP Transporter with service: ${service}`);
        verifyTransporter();
    } else if (host && user && pass) {
        const isGmailHost = host.toLowerCase().includes("gmail");
        const cleanPass = isGmailHost ? pass.replace(/\s+/g, "") : pass;
        transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: { user, pass: cleanPass }
        });
        console.log(`[EMAIL SERVICE] Configured SMTP Transporter for host: ${host}:${port} (secure: ${secure})`);
        verifyTransporter();
    } else {
        transporter = null;
        console.warn("[EMAIL SERVICE WARNING] Real SMTP provider is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD in server/.env for email delivery.");
    }
    return transporter;
};

const verifyTransporter = () => {
    if (!transporter) return;
    transporter.verify((error) => {
        if (error) {
            console.error(`[EMAIL SERVICE ERROR] SMTP connection verification failed: ${error.message}`);
        } else {
            console.log("[EMAIL SERVICE SUCCESS] SMTP server is ready to deliver messages.");
        }
    });
};

// Initialize at startup
initTransporter();

/**
 * Send Password Reset link to user
 */
const sendPasswordResetEmail = async (toEmail, name, rawToken) => {
    const frontendUrl = getFrontendPublicUrl();
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
    const subject = "CloudOps AI — Password Reset Request";
    const user = process.env.SMTP_USER || process.env.EMAIL_USER || process.env.SMTP_USERNAME;
    const from = getSenderEmail(user);

    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 36px 32px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="margin-bottom: 24px;">
                <span style="font-size: 24px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px;">☁ CloudOps AI</span>
            </div>
            <h2 style="color: #0f172a; margin: 0 0 16px 0; font-size: 20px; font-weight: 700;">Password Reset Request</h2>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                Hello${name ? ` ${name}` : ""}, a password reset was requested for your CloudOps AI account. Click the button below to set a new password:
            </p>
            <div style="margin: 28px 0;">
                <a href="${resetUrl}" style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #ffffff; text-decoration: none; padding: 13px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
                    Reset Password
                </a>
            </div>
            <p style="color: #64748b; font-size: 13px; margin: 24px 0 8px 0;">Or copy and paste this reset URL into your browser:</p>
            <p style="color: #0284c7; font-size: 13px; word-break: break-all; margin: 0 0 24px 0;">${resetUrl}</p>
            <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 28px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                This link will expire in 1 hour. If you did not request this, please ignore this email.
            </p>
        </div>
    `;

    const activeTransporter = transporter || initTransporter();

    if (!activeTransporter) {
        console.error(`[EMAIL SERVICE ERROR] Cannot send password reset to ${toEmail}: SMTP provider is not configured.`);
        return {
            success: false,
            error: "SMTP provider not configured. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in server/.env."
        };
    }

    try {
        const info = await activeTransporter.sendMail({
            from,
            to: toEmail,
            subject,
            html
        });
        console.log(`[EMAIL SERVICE] Password reset email successfully accepted by provider for ${toEmail}. MessageID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`[EMAIL SERVICE ERROR] SMTP provider rejected/failed sending reset email to ${toEmail}: ${error.message}`);
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendPasswordResetEmail,
    initTransporter
};
