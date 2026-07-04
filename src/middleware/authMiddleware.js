const jwt = require("jsonwebtoken");
const User = require("../models/User");

exports.authMiddleware = async (req, res, next) => {

    try {

        const accessToken = req.cookies.jwtAccessToken;

        if (!accessToken) {

            return res.status(401).json({
                success:false,
                code:"TOKEN_MISSING"
            });

        }

        const decoded = jwt.verify(

            accessToken,

            process.env.JWT_ACCESS_TOKEN

        );

        const user = await User.findById(decoded.id);

        if (!user) {

            return res.status(404).json({

                success: false,

                message: "User not found"

            });

        }

        req.user = user;

        next();

    }

    catch(err){

        if(err.name==="TokenExpiredError"){

            return res.status(401).json({

                success:false,

                code:"TOKEN_EXPIRED"

            });

        }

        return res.status(401).json({

            success:false,

            code:"INVALID_TOKEN"

        });

    }

}