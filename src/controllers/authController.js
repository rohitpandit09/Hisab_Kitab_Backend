const User = require('../models/User');
const bcrypt = require("bcrypt");
const {generateAccessToken, generateRefreshToken} = require('../utils/generateTokens');


// -------------------- Google Login --------------------------//

exports.googleLogin = async (req,res) =>{

    try{

        const user = req.user;

        if(!user){
            return res.status(404).json({
                message : "User not found"
            })
        }

        const jwtRefreshToken = generateRefreshToken(user);
        const jwtAccessToken = generateAccessToken(user);

        const hashedJWTRefreshToken = await bcrypt.hash(jwtRefreshToken,10);

        user.refreshToken = hashedJWTRefreshToken;
        await user.save();

        res.cookie('jwtRefreshToken',jwtRefreshToken,

            {
                httpOnly : true,
                secure : false,
                sameSite : "lax",
                maxAge : 1*60*1000
            }
        )

        res.cookie('jwtAccessToken',jwtAccessToken,

            {
                httpOnly : true,
                secure : false,
                sameSite : "lax",
                maxAge : 30*1000
            }
        )

        res.redirect(`http://localhost:5173/dashboard`);


    }catch(err){
        return res.status(500).json({
            message : err.message
        })
    }

}

// --------------------- Refreshing the access Token using refresh token -----------------------------//

exports.refreshAccessToken = async (req,res) => {

    console.log("Refresh Access token called")

    try{

        const refreshToken = req.cookies.jwtRefreshToken;
        
        const decoded = await jwt.verify(
            refreshToken,
            process.env.JWT_REFRESH_TOKEN
        
        );

        const user = await User.findById(decoded.id);

        if(!user){
            return res.status(404).json({
                message  : "User not found"
            })
        }

        const isMatched = await bcrypt.compare(refreshToken,user.refreshToken);

        if(!isMatched){
            return res.status(400).json({
                message : "Invalid Refresh Token"
            })
        }

        const newAccessToken = generateAccessToken(user);

        res.cookie("jwtAccessToken", newAccessToken, {

            httpOnly: true,
            secure: false,
            sameSite: "lax",
            maxAge:  30 * 1000

        });

        return res.status(200).json({
            message : "Access Token renewed"
            
        })



    }catch(err){
        return res.status(401).json({
            message : err.message
        })
    }
    
}

// ------------------------------------------- Logout ----------------------------------------//

exports.userLogout = async (req,res)=>{

    try{

        const user = req.user;
        res.clearCookie("jwtRefreshToken");
        res.clearCookie("jwtAccessToken");
        user.refreshToken = null;
        await user.save();
        
        
    }catch(err){

        return res.status(401).json({
            message : err.message
        })
    }
}

// ------------------------------------------- userInfo --------------------------------------------//

exports.getUser = async (req, res) => {

    

    return res.status(200).json({

        success: true,

        user: {

            id: req.user._id,

            userName: req.user.userName,

            email: req.user.email,

            profilePicture: req.user.profilePicture

        }

    });

}

// -------------------------------- Update Profile ------------------------------------//

exports.updateProfile = async (req, res) => {

    try {

        const { name, phone, occupation } = req.body;

        const user = req.user;

        user.userName = name;
        user.mobile = phone;
        user.occupation = occupation;

        await user.save();

        return res.status(200).json({

            success: true,

            message: "Profile Updated Successfully",

            user: {

                id: user._id,
                userName: user.userName,
                email: user.email,
                mobile: user.mobile,
                occupation: user.occupation,
                profilePicture: user.profilePicture

            }

        });

    }

    catch (err) {

        return res.status(500).json({

            success: false,

            message: err.message

        });

    }

}