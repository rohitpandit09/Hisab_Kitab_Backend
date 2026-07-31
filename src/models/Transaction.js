const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },
    merchantName: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true
    },
    transactionDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    transactionType: {
        type: String,
        enum: ["Expense", "Income"],
        required: true
    },
    categoryType: {
        type: String,
        required: true,
        default: "Others"
    },
    description: {
        type: String,
        default: null
    },
    source: {
        type: String,
        enum: ["Gmail", "Manual"],
        default: "Manual"
    },
    gmailMessageId: {
        type: String,
        default: null
    },
    isRecurring: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Index to quickly find user transactions by date and prevent duplicate Gmail messages
transactionSchema.index({ userId: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, gmailMessageId: 1 }, { sparse: true });

module.exports = mongoose.model("Transaction", transactionSchema);