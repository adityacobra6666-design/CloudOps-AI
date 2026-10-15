const express = require("express");
const { alertWebhook } = require("../controllers/incidentController");

const router = express.Router();

// Route /alerts, /webhook, and /alertmanager through the unified alertWebhook handler
router.post("/alerts", alertWebhook);
router.post("/webhook", alertWebhook);
router.post("/alertmanager", alertWebhook);

module.exports = router;
