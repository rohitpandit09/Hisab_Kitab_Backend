const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    googleId: {
        type: String,
        default: null,
        sparse: true
    },
    password: {
        type: String,
        default: null,
        select: false
    },
    income: {
        type: Number,
        default: 0
    },
    userName: {
        type: String,
        required: true,
        trim: true
    },
    mobile: {
        type: String,
        default: null
    },
    occupation: {
        type: String,
        default: null
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    profilePicture: {
        type: String,
        default: ""
    },
    refreshToken: {
        type: String,
        default: null
    },
    gmailAccessToken: {
        type: String,
        default: null
    },
    gmailRefreshToken: {
        type: String,
        default: null
    },
    gmailConnected: {
        type: Boolean,
        default: false
    },
    currency: {
        type: String,
        default: "INR"
    },
    theme: {
        type: String,
        enum: ["light", "dark", "system"],
        default: "light"
    },
    notifications: {
        emailAlerts: { type: Boolean, default: true },
        budgetAlerts: { type: Boolean, default: true },
        aiInsights: { type: Boolean, default: true }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("User", userSchema);