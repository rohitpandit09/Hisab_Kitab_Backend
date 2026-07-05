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

        async (googleAccessToken,googleRefreshToken,profile,done) => {

            try {

                let user;

                const existingUser = await User.findOne({
                    googleId : profile.id
                });

                if(!existingUser){
                    
                        user =  await User.create({
                            googleId : profile.id,
                            email : profile.emails[0].value,
                            userName : profile.displayName,
                            gmailRefreshToken : googleRefreshToken,
                            profilePicture : profile.photos[0]?.value || ""
                        })

                }
                else{

                    existingUser.gmailRefreshToken = googleRefreshToken;
                    await existingUser.save();
                    user = existingUser
                    
                }

                
                done(null, user);

            } catch (err) {

                done(err, null);
            }

        }

    )

);

passport.serializeUser((user, done) => {

    done(null, user);

});

passport.deserializeUser((user, done) => {

    done(null, user);

});

module.exports = passport;