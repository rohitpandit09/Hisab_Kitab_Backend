const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({

    googleId: {
        type: String,
        required: true,
        unique: true
    },

    userName: {
        type: String,
        required: true
    },

    mobile : {
        type : String,
        default : null
    },

    occupation : {

        type : String,
        default : null
    }
    ,

    email: {
        type: String,
        required: true,
        unique: true
    },

    profilePicture: {
        type: String
    },

    refreshToken: {
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
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("User", userSchema);