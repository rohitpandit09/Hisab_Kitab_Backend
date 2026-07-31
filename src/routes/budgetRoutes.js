const express = require("express");
const router = express.Router();
const { getBudgets, upsertBudget, deleteBudget } = require("../controllers/budgetController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.get("/", authMiddleware, getBudgets);
router.post("/", authMiddleware, upsertBudget);
router.delete("/:id", authMiddleware, deleteBudget);

module.exports = router;
