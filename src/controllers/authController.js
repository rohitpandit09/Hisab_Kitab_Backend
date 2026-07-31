const User = require('../models/User');
const bcrypt = require("bcrypt");
const { generateAccessToken, generateRefreshToken } = require('../utils/generateTokens');
const jwt = require('jsonwebtoken');

const isProduction = process.env.NODE_ENV === "production";

const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
};

// -------------------- Register User --------------------------//
exports.registerUser = async (req, res) => {
    try {
        const { userName, email, password, mobile, occupation } = req.body;

        if (!email || !password || !userName) {
            return res.status(400).json({
                success: false,
                message: "Please provide Name, Email and Password"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User with this email already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await User.create({
            userName,
            email: email.toLowerCase(),
            password: hashedPassword,
            mobile: mobile || null,
            occupation: occupation || null,
            profilePicture: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(userName)}`
        });

        const jwtRefreshToken = generateRefreshToken(newUser);
        const jwtAccessToken = generateAccessToken(newUser);

        const hashedJWTRefreshToken = await bcrypt.hash(jwtRefreshToken, 10);
        newUser.refreshToken = hashedJWTRefreshToken;
        await newUser.save();

        res.cookie('jwtRefreshToken', jwtRefreshToken, cookieOptions);
        res.cookie('jwtAccessToken', jwtAccessToken, { ...cookieOptions, maxAge: 30 * 60 * 1000 });

        return res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: newUser._id,
                userName: newUser.userName,
                email: newUser.email,
                mobile: newUser.mobile,
                occupation: newUser.occupation,
                income: newUser.income,
                profilePicture: newUser.profilePicture,
                gmailConnected: newUser.gmailConnected
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// -------------------- Login User --------------------------//
exports.loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Please provide both Email and Password"
            });
        }

        const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

        if (!user || !user.password) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const jwtRefreshToken = generateRefreshToken(user);
        const jwtAccessToken = generateAccessToken(user);

        const hashedJWTRefreshToken = await bcrypt.hash(jwtRefreshToken, 10);
        user.refreshToken = hashedJWTRefreshToken;
        await user.save();

        res.cookie('jwtRefreshToken', jwtRefreshToken, cookieOptions);
        res.cookie('jwtAccessToken', jwtAccessToken, { ...cookieOptions, maxAge: 30 * 60 * 1000 });

        return res.status(200).json({
            success: true,
            message: "Logged in successfully",
            user: {
                id: user._id,
                userName: user.userName,
                email: user.email,
                mobile: user.mobile,
                occupation: user.occupation,
                income: user.income,
                profilePicture: user.profilePicture,
                gmailConnected: user.gmailConnected
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// -------------------- Google Login Callback Handler --------------------------//
exports.googleLogin = async (req, res) => {
    try {
        const user = req.user;

        const clientUrl = process.env.CLIENT_URL.replace(/\/+$/, "");

        if (!user) {
            return res.redirect(`${clientUrl}/?error=auth_failed`);
        }

        const jwtRefreshToken = generateRefreshToken(user);
        const jwtAccessToken = generateAccessToken(user);

        const hashedJWTRefreshToken = await bcrypt.hash(jwtRefreshToken, 10);

        user.refreshToken = hashedJWTRefreshToken;
        user.gmailConnected = true;
        await user.save();

        res.cookie('jwtRefreshToken', jwtRefreshToken, cookieOptions);
        res.cookie('jwtAccessToken', jwtAccessToken, { ...cookieOptions, maxAge: 30 * 60 * 1000 });

        return res.redirect(`${clientUrl}/dashboard`);
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// --------------------- Refreshing Access Token -----------------------------//
exports.refreshAccessToken = async (req, res) => {
    try {
        const refreshToken = req.cookies.jwtRefreshToken;

        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                code: "TOKEN_MISSING",
                message: "Refresh Token Missing"
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_TOKEN);
        } catch (err) {
            return res.status(401).json({
                success: false,
                code: "INVALID_REFRESH_TOKEN",
                message: "Invalid or expired refresh token"
            });
        }

        const user = await User.findById(decoded.id);

        if (!user || !user.refreshToken) {
            return res.status(404).json({
                success: false,
                message: "User not found or logged out"
            });
        }

        const isMatched = await bcrypt.compare(refreshToken, user.refreshToken);

        if (!isMatched) {
            return res.status(400).json({
                success: false,
                message: "Invalid Refresh Token"
            });
        }

        const newAccessToken = generateAccessToken(user);

        res.cookie("jwtAccessToken", newAccessToken, { ...cookieOptions, maxAge: 30 * 60 * 1000 });

        return res.status(200).json({
            success: true,
            message: "Access Token renewed"
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// -------------------------------- Logout ----------------------------------------//
exports.userLogout = async (req, res) => {
    try {
        const user = req.user;

        res.clearCookie("jwtRefreshToken", cookieOptions);
        res.clearCookie("jwtAccessToken", cookieOptions);

        if (user) {
            user.refreshToken = null;
            await user.save();
        }

        return res.status(200).json({
            message: "Successfully logged out",
            success: true
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// -------------------------------- Get Current User Info --------------------------------------------//
exports.getUser = async (req, res) => {
    try {
        const user = req.user;
        return res.status(200).json({
            success: true,
            user: {
                id: user._id,
                userName: user.userName,
                email: user.email,
                mobile: user.mobile,
                occupation: user.occupation,
                income: user.income,
                profilePicture: user.profilePicture,
                gmailConnected: user.gmailConnected,
                currency: user.currency || "INR",
                theme: user.theme || "light",
                notifications: user.notifications || { emailAlerts: true, budgetAlerts: true, aiInsights: true }
            }
        });
    } catch (err) {
        return res.status(500).json({
            message: err.message,
            success: false
        });
    }
};

// -------------------------------- Change Password ------------------------------------//
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Please provide current and new password"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 6 characters"
            });
        }

        const user = await User.findById(req.user._id).select("+password");

        if (!user.password) {
            return res.status(400).json({
                success: false,
                message: "Password change is not available for Google OAuth accounts"
            });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// -------------------------------- Update Profile ------------------------------------//
exports.updateProfile = async (req, res) => {
    try {
        const { name, phone, occupation, currency, theme, notifications } = req.body;
        const user = req.user;

        if (name) user.userName = name;
        if (phone !== undefined) user.mobile = phone;
        if (occupation !== undefined) user.occupation = occupation;
        if (currency) user.currency = currency;
        if (theme) user.theme = theme;
        if (notifications) user.notifications = { ...user.notifications, ...notifications };

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
                income: user.income,
                profilePicture: user.profilePicture,
                gmailConnected: user.gmailConnected,
                currency: user.currency,
                theme: user.theme,
                notifications: user.notifications
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};