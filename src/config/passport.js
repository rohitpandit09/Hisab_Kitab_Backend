const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_REDIRECT_URI
        },
        async (googleAccessToken, googleRefreshToken, profile, done) => {
            try {
                const userEmail = profile.emails[0]?.value?.toLowerCase();

                let user = await User.findOne({ googleId: profile.id });

                if (!user && userEmail) {
                    user = await User.findOne({ email: userEmail });
                }

                if (!user) {
                    user = await User.create({
                        googleId: profile.id,
                        email: userEmail,
                        userName: profile.displayName || "Google User",
                        gmailAccessToken: googleAccessToken,
                        gmailRefreshToken: googleRefreshToken || null,
                        gmailConnected: true,
                        profilePicture: profile.photos[0]?.value || ""
                    });
                } else {
                    if (!user.googleId) {
                        user.googleId = profile.id;
                    }
                    user.gmailAccessToken = googleAccessToken;
                    if (googleRefreshToken) {
                        user.gmailRefreshToken = googleRefreshToken;
                    }
                    user.gmailConnected = true;
                    if (profile.photos[0]?.value && !user.profilePicture) {
                        user.profilePicture = profile.photos[0].value;
                    }
                    await user.save();
                }

                done(null, user);
            } catch (err) {
                done(err, null);
            }
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

module.exports = passport;
