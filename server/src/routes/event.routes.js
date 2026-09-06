const express = require("express");
const { alertWebhook } = require("../controllers/incidentController");

const router = express.Router();

// Route both /alerts and /webhook through the unified alertWebhook handler
router.post("/alerts", alertWebhook);
router.post("/webhook", alertWebhook);

module.exports = router;
