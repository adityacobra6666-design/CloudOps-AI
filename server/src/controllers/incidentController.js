const Incident = require("../models/Incident");
const {
    createEmbedding,
    cosineSimilarity,
    generateAnalysis
} = require("../services/rag/rag.service");
const {
    generateRemediationDecision
} = require("../services/remediation/aiDecision");

// CREATE INCIDENT
exports.createIncident = async (req, res) => {

    try {

        // Whitelist allowed fields to prevent mass assignment
        const { title, description, severity, source, category, status, server } = req.body;
        const incident = await Incident.create({
            title, description, severity, source, category, status, server
        });


        res.status(201).json({
            success: true,
            incident
        });


    } catch (error) {

        res.status(500).json({
            success:false,
            message: "Failed to create incident"
        });

    }

};



// GET ALL INCIDENTS
exports.getIncidents = async (req,res)=>{

    try{

        const incidents = await Incident.find();
        incidents.sort((a, b) => {
            const dateA = new Date(a.createdAt || a._id.getTimestamp?.() || 0);
            const dateB = new Date(b.createdAt || b._id.getTimestamp?.() || 0);
            return dateB - dateA;
        });


        res.json({

            success:true,
            incidents

        });


    }catch(error){

        res.status(500).json({

            success:false,
            message:error.message

        });

    }

};
exports.alertWebhook = async (req, res) => {
    try {
        const payload = req.body || {};
        const alerts = payload.alerts || [];

        console.log("\n========================================");
        console.log("🚨 [ALERTMANAGER WEBHOOK] Payload Received");
        console.log(`   Alert Count: ${alerts.length}`);
        console.log("========================================");

        if (!alerts.length) {
            console.log("ℹ️ [ALERTMANAGER WEBHOOK] No alerts in payload.");
            return res.status(200).json({
                success: true,
                message: "No alerts in payload",
                created: 0,
                updated: 0,
                resolved: 0
            });
        }

        let createdCount = 0;
        let updatedCount = 0;
        let resolvedCount = 0;
        const results = [];

        for (const alert of alerts) {
            const labels = alert.labels || {};
            const annotations = alert.annotations || {};

            const alertName = labels.alertname || "Prometheus Alert";
            const rawStatus = (alert.status || "firing").toLowerCase();
            const fingerprint = alert.fingerprint || `${alertName}-${labels.instance || labels.job || labels.service || "default"}`;
            const title = annotations.summary || alertName;
            const description = annotations.description || `Prometheus alert "${alertName}" firing on ${labels.instance || labels.job || "infrastructure"}`;

            // Map severity safely to Incident schema enum
            let severity = "warning";
            const rawSev = String(labels.severity || "").toLowerCase();
            if (rawSev === "critical" || rawSev === "high") {
                severity = "critical";
            } else if (rawSev === "warning" || rawSev === "medium") {
                severity = "warning";
            } else if (rawSev === "info" || rawSev === "low") {
                severity = "info";
            }

            const serverName = labels.instance || labels.job || labels.container || "cloudops-server";
            const category = labels.category || "infrastructure";

            console.log(`\n🔔 [ALERT] Name: "${alertName}" | Status: "${rawStatus}" | Severity: "${severity}" | Fingerprint: "${fingerprint}"`);

            // Check for existing open incident by fingerprint OR title
            const existingIncident = await Incident.findOne({
                $or: [
                    { alertFingerprint: fingerprint, status: { $in: ["open", "OPEN"] } },
                    { title: title, status: { $in: ["open", "OPEN"] } }
                ]
            });

            // -------------------------------------------------------------
            // RESOLVED ALERT
            // -------------------------------------------------------------
            if (rawStatus === "resolved") {
                if (existingIncident) {
                    existingIncident.status = "resolved";
                    existingIncident.endsAt = alert.endsAt ? new Date(alert.endsAt) : new Date();
                    await existingIncident.save();

                    console.log(`✅ [ALERTMANAGER WEBHOOK] Incident RESOLVED: "${existingIncident.title}" (ID: ${existingIncident._id})`);
                    resolvedCount++;
                    results.push({ alert: alertName, action: "resolved", incidentId: existingIncident._id });
                } else {
                    console.log(`ℹ️ [ALERTMANAGER WEBHOOK] Resolved alert ignored (no open matching incident): "${title}"`);
                    results.push({ alert: alertName, action: "no_op" });
                }
                continue;
            }

            // -------------------------------------------------------------
            // FIRING ALERT — DEDUPLICATION / UPDATE
            // -------------------------------------------------------------
            if (existingIncident) {
                existingIncident.description = description;
                existingIncident.severity = severity;
                existingIncident.category = category;
                existingIncident.server = serverName;
                existingIncident.source = "Prometheus Alertmanager";
                existingIncident.startsAt = alert.startsAt ? new Date(alert.startsAt) : existingIncident.startsAt;
                existingIncident.generatorURL = alert.generatorURL || existingIncident.generatorURL;
                await existingIncident.save();

                console.log(`🔄 [ALERTMANAGER WEBHOOK] Duplicate firing alert updated (ID: ${existingIncident._id})`);
                updatedCount++;
                results.push({ alert: alertName, action: "updated", incidentId: existingIncident._id });
                continue;
            }

            // -------------------------------------------------------------
            // FIRING ALERT — CREATE NEW INCIDENT
            // -------------------------------------------------------------
            const newIncident = await Incident.create({
                title,
                description,
                severity,
                source: "Prometheus Alertmanager",
                category,
                status: "open",
                server: serverName,
                alertName,
                alertFingerprint: fingerprint,
                startsAt: alert.startsAt ? new Date(alert.startsAt) : new Date(),
                generatorURL: alert.generatorURL || null
            });

            console.log(`🔥 [ALERTMANAGER WEBHOOK] NEW INCIDENT CREATED: "${title}" (ID: ${newIncident._id})`);
            createdCount++;
            results.push({ alert: alertName, action: "created", incidentId: newIncident._id });
        }

        console.log("========================================\n");

        return res.status(200).json({
            success: true,
            message: "Alertmanager webhook processed successfully",
            created: createdCount,
            updated: updatedCount,
            resolved: resolvedCount,
            results
        });

    } catch (error) {
        console.error("❌ [ALERTMANAGER WEBHOOK ERROR]:", error.message);
        return res.status(500).json({
            success: false,
            message: "Webhook processing error"
        });
    }
};
// GET SINGLE INCIDENT
exports.getIncidentById = async (req,res)=>{

    try{

        const incident = await Incident.findById(req.params.id);


        res.json({
            success:true,
            incident
        });


    }catch(error){

        res.status(500).json({
            success:false,
            message:error.message
        });

    }

};



// GET INCIDENT ACTIVITY
exports.getIncidentActivity = async(req,res)=>{

    res.json({
        success:true,
        message:"Activity module coming soon"
    });

};



// UPDATE INCIDENT
exports.updateIncident = async(req,res)=>{

    try{

        // Whitelist allowed update fields
        const allowed = ['title', 'description', 'severity', 'source', 'category', 'status', 'server'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                updates[key] = req.body[key];
            }
        }

        const incident = await Incident.findByIdAndUpdate(
            req.params.id,
            updates,
            {
                new:true
            }
        );


        res.json({
            success:true,
            incident
        });


    }catch(error){

        res.status(500).json({
            success:false,
            message: "Failed to update incident"
        });

    }

};



// DELETE INCIDENT
exports.deleteIncident = async(req,res)=>{

    try{

        await Incident.findByIdAndDelete(
            req.params.id
        );


        res.json({
            success:true,
            message:"Incident deleted"
        });


    }catch(error){

        res.status(500).json({
            success:false,
            message:error.message
        });

    }

};



// AI ANALYSIS HANDLER
exports.analyzeIncidentWithAI = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. FIND INCIDENT
        const incident = await Incident.findById(id);
        if (!incident) {
            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }

        const incidentText = `${incident.title} ${incident.description || ""} severity: ${incident.severity} category: ${incident.category || ""}`;

        // 2. CREATE QUERY EMBEDDING (Safe fallback if Ollama embedding fails)
        let queryEmbedding = null;
        try {
            queryEmbedding = await createEmbedding(incidentText);
        } catch (embErr) {
            console.warn("[AI ANALYSIS] Embedding creation warning:", embErr.message);
        }

        // 3. SIMILARITY SEARCH ON HISTORICAL INCIDENTS
        let topMatches = [];
        if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
            try {
                const historicalIncidents = await Incident.find({
                    _id: { $ne: incident._id }
                }).sort({ createdAt: -1 }).limit(50);

                const scoredIncidents = [];
                for (const historical of historicalIncidents) {
                    let histEmbedding = historical.embedding;
                    if (!histEmbedding || !Array.isArray(histEmbedding) || histEmbedding.length !== queryEmbedding.length) {
                        const histText = `${historical.title} ${historical.description || ""} severity: ${historical.severity} category: ${historical.category || ""}`;
                        histEmbedding = await createEmbedding(histText);
                    }

                    if (histEmbedding && Array.isArray(histEmbedding) && histEmbedding.length === queryEmbedding.length) {
                        const similarity = cosineSimilarity(queryEmbedding, histEmbedding);
                        scoredIncidents.push({ incident: historical, similarity });
                    }
                }

                scoredIncidents.sort((a, b) => b.similarity - a.similarity);
                topMatches = scoredIncidents.slice(0, 3).map(item => item.incident);
            } catch (histErr) {
                console.warn("[AI ANALYSIS] Historical similarity search warning:", histErr.message);
            }
        }

        // 4. GENERATE AI ANALYSIS (LLAMA 3.2)
        const analysis = await generateAnalysis(incident, topMatches);

        // 5. SAVE AI RESULT TO MONGODB
        const updateFields = {
            aiAnalysis: analysis,
            aiAnalyzedAt: new Date()
        };
        if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
            updateFields.embedding = queryEmbedding;
        }

        const updatedIncident = await Incident.findByIdAndUpdate(
            incident._id,
            { $set: updateFields },
            { new: true }
        );

        // 6. REMEDIATION DECISION
        let remediationDecision = null;
        try {
            remediationDecision = await generateRemediationDecision(updatedIncident, analysis);
            if (remediationDecision) {
                await Incident.updateOne(
                    { _id: incident._id },
                    { $set: { remediationDecision } }
                );
                updatedIncident.remediationDecision = remediationDecision;
            }
        } catch (decisionError) {
            console.error("⚠️ Remediation decision failed (non-blocking):", decisionError.message);
        }

        // 7. RETURN JSON RESPONSE
        return res.json({
            success: true,
            incidentId: incident._id,
            incident: updatedIncident,
            analysis,
            similarIncidents: topMatches.map(item => ({
                id: item._id,
                title: item.title
            })),
            remediationDecision
        });

    } catch (error) {
        console.error("AI ANALYSIS ERROR:", error.message || error);
        return res.status(500).json({
            success: false,
            message: `AI analysis failed: ${error.message || "Internal server error"}`
        });
    }
};
