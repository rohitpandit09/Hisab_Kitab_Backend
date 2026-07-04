const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const ratelimiter = require('express-rate-limit');
const connectDB = require('./src/config/db');
const passport = require("./src/config/passport");
const session = require("express-session");


// rate limiter 

const limiter = ratelimiter({
    windowMs : 15*60*1000,
    max:100,
})

// passport setup  and session

app.use(session({
    secret : process.env.JWT_SECRET,
    resave : false,
    saveUninitialized : true
}));
app.use(passport.initialize());
app.use(passport.session());



// Datebase calling

connectDB();

// Importing Routes

const authRoutes = require('./src/routes/authRoutes');


// Using all installed packages 

app.use(cors({
    origin:'http://localhost:5173',
    credentials: true
}));

app.use(express.json());
app.use(limiter);
app.use(cookieParser());



// Using app.use

app.use('/api/auth',authRoutes);


// Running the server

app.listen(5000,()=>{
    console.log("Server started on PORT 5000");
})


