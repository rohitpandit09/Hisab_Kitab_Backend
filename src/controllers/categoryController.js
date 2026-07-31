const Category = require("../models/Category");

const DEFAULT_CATEGORIES = [
    { name: "Food", icon: "🍔", type: "Expense" },
    { name: "Grocery", icon: "🛒", type: "Expense" },
    { name: "Shopping", icon: "🛍️", type: "Expense" },
    { name: "Transport", icon: "🚌", type: "Expense" },
    { name: "Travel", icon: "✈️", type: "Expense" },
    { name: "Bills", icon: "⚡", type: "Expense" },
    { name: "Health", icon: "🏥", type: "Expense" },
    { name: "Education", icon: "🎓", type: "Expense" },
    { name: "Entertainment", icon: "🎬", type: "Expense" },
    { name: "Recharge", icon: "📱", type: "Expense" },
    { name: "Fuel", icon: "⛽", type: "Expense" },
    { name: "Rent", icon: "🏠", type: "Expense" },
    { name: "Utilities", icon: "💡", type: "Expense" },
    { name: "Investment", icon: "📈", type: "Both" },
    { name: "Salary", icon: "💵", type: "Income" },
    { name: "Transfer", icon: "🔄", type: "Both" },
    { name: "Others", icon: "💰", type: "Both" }
];

exports.getCategories = async (req, res) => {
    try {
        let categories = await Category.find().sort({ name: 1 }).lean();

        if (categories.length === 0) {
            await Category.insertMany(DEFAULT_CATEGORIES);
            categories = await Category.find().sort({ name: 1 }).lean();
        }

        return res.status(200).json({
            success: true,
            categories
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};
