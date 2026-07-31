const express = require("express");
const router = express.Router();
const { getMonthlyReport, exportTransactions } = require("../controllers/reportController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.get("/monthly", authMiddleware, getMonthlyReport);
router.get("/export", authMiddleware, exportTransactions);

module.exports = router;
