const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const ratelimiter = require('express-rate-limit');
const helmet = require('helmet');
const connectDB = require('./src/config/db');
const passport = require("./src/config/passport");
const session = require("express-session");
const dns = require('dns');

dns.setServers(['8.8.8.8', '8.8.4.4']);

const limiter = ratelimiter({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = ratelimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
});

const isProduction = process.env.NODE_ENV === "production";

const CLIENT_URL = process.env.CLIENT_URL;
const allowedOrigins = CLIENT_URL.split(",").map((u) => u.trim().replace(/\/$/, ""));

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.set("trust proxy", 1);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.some((o) => origin.startsWith(o))) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

app.use(session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 10 * 60 * 1000
    }
}));

app.use(passport.initialize());
app.use(passport.session());

connectDB();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(limiter);
app.use(cookieParser());

const authRoutes = require('./src/routes/authRoutes');
const gmailRoutes = require("./src/routes/gmailRoutes");
const budgetRoutes = require("./src/routes/budgetRoutes");
const reportRoutes = require("./src/routes/reportRoutes");
const notificationRoutes = require("./src/routes/notificationRoutes");
const categoryRoutes = require("./src/routes/categoryRoutes");

app.use('/api/auth', authLimiter, authRoutes);
app.use("/api/gmail", gmailRoutes);
app.use("/api/budget", budgetRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/categories", categoryRoutes);

app.use((err, req, res, next) => {
    if (err.message === "Not allowed by CORS") {
        return res.status(403).json({ success: false, message: "Origin not allowed" });
    }
    return res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server started on PORT ${PORT}`);
});
