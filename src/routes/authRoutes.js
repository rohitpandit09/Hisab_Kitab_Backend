const express = require('express');
const router = express.Router();
const { registerUser, loginUser, googleLogin, userLogout, refreshAccessToken, getUser, updateProfile, changePassword } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');
const passport = require("passport");

router.post("/register", registerUser);
router.post("/login", loginUser);

router.get("/google",
    passport.authenticate(
        "google",
        {
            scope: [
                "profile",
                "email",
                "https://www.googleapis.com/auth/gmail.readonly"
            ],
            accessType: "offline",
            prompt: "consent"
        }
    )
);

router.get(
    "/google/callback",
    passport.authenticate(
        "google",
        {
            failureRedirect: `${(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "")}/?error=google_auth_failed`,
            session: false
        }
    ),
    googleLogin
);

router.post("/refresh-token", refreshAccessToken);
router.post('/logout', authMiddleware, userLogout);
router.get('/me', authMiddleware, getUser);
router.patch("/update-profile", authMiddleware, updateProfile);
router.patch("/change-password", authMiddleware, changePassword);

module.exports = router;