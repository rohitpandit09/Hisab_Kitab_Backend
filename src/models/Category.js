const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    icon: {
        type: String,
        default: "💰"
    },
    type: {
        type: String,
        enum: ["Expense", "Income", "Both"],
        default: "Expense"
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Category", categorySchema);
