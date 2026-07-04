const express = require('express');
const router = express.Router();
const {googleLogin, userLogout,refreshAccessToken,getUser,updateProfile} = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');
const passport = require("passport");

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

            failureRedirect: "/",
            session: false

        }

    ),

    googleLogin

);


router.post("/refresh-token",refreshAccessToken);
router.post('/logout',userLogout);
router.get('/me',authMiddleware,getUser);
router.patch("/update-profile",authMiddleware,updateProfile);


module.exports = router