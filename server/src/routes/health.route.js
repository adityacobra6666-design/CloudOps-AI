const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "CloudOps AI API is working 🚀",
        timestamp: new Date()
    });
});

module.exports = router;