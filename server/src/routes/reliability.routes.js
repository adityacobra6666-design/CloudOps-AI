const express = require("express");
const router = express.Router();
const reliabilityController = require("../controllers/reliability.controller");
const { protect } = require("../middleware/auth.middleware");

router.get("/overview", protect, reliabilityController.getReliabilityOverview);

module.exports = router;
