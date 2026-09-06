const express = require("express");
const router = express.Router();
const reliabilityController = require("../controllers/reliability.controller");

router.get("/overview", reliabilityController.getReliabilityOverview);

module.exports = router;
