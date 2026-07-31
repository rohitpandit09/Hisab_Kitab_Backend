const express = require("express");
const router = express.Router();

const {
  getEmail,
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  updateIncome,
  getIncome
} = require("../controllers/gmailController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.get("/get-email", authMiddleware, getEmail);
router.get("/transactions", authMiddleware, getTransactions);
router.post("/transactions", authMiddleware, createTransaction);
router.patch("/transactions/:id", authMiddleware, updateTransaction);
router.delete("/transactions/:id", authMiddleware, deleteTransaction);

router.post("/update-income", authMiddleware, updateIncome);
router.get('/get-income', authMiddleware, getIncome);

module.exports = router;