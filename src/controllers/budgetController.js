const Budget = require("../models/Budget");
const Transaction = require("../models/Transaction");

exports.getBudgets = async (req, res) => {
    try {
        const userId = req.user._id;

        // Fetch stored budget targets
        const budgets = await Budget.find({ userId });

        // Calculate current month's start date
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Fetch transactions for the current month
        const monthlyTransactions = await Transaction.find({
            userId,
            transactionType: "Expense",
            transactionDate: { $gte: startOfMonth }
        });

        // Group spending by category
        const categorySpentMap = {};
        monthlyTransactions.forEach(t => {
            const cat = t.categoryType || "Others";
            categorySpentMap[cat] = (categorySpentMap[cat] || 0) + (Number(t.amount) || 0);
        });

        // Combine budget targets with real spent amounts
        const result = budgets.map(b => {
            const spent = categorySpentMap[b.category] || 0;
            return {
                id: b._id,
                category: b.category,
                budget: b.targetAmount,
                spent,
                remaining: Math.max(0, b.targetAmount - spent),
                percentage: Math.min(100, Math.round((spent / b.targetAmount) * 100))
            };
        });

        return res.status(200).json({
            success: true,
            budgets: result
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

exports.upsertBudget = async (req, res) => {
    try {
        const userId = req.user._id;
        const { category, targetAmount } = req.body;

        if (!category || targetAmount === undefined || Number(targetAmount) < 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid Category and Budget Amount"
            });
        }

        const budget = await Budget.findOneAndUpdate(
            { userId, category: category.trim() },
            { userId, category: category.trim(), targetAmount: Number(targetAmount) },
            { upsert: true, returnDocument: "after" }
        );

        return res.status(200).json({
            success: true,
            message: "Budget saved successfully",
            budget
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

exports.deleteBudget = async (req, res) => {
    try {
        const userId = req.user._id;
        const { id } = req.params;

        const deleted = await Budget.findOneAndDelete({ _id: id, userId });
        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Budget not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Budget deleted successfully"
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};
