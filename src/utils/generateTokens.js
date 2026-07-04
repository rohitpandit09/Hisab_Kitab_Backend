const jwt = require('jsonwebtoken');

exports.generateRefreshToken = (user)=>{

    return jwt.sign(
        {
            id : user._id,
            email : user.email
        },

        process.env.JWT_REFRESH_TOKEN,

        {
            expiresIn : "1d"
        }
    )
}

exports.generateAccessToken = (user)=>{

    return jwt.sign(
        {
            id : user._id,
            email : user.email
        },

        process.env.JWT_ACCESS_TOKEN,

        {
            expiresIn : "30m"
        }
    )
    
}