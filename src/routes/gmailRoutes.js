const express = require("express");
const router = express.Router();

const {getEmail} = require("../controllers/gmailController")
const {authMiddleware} = require("../middleware/authMiddleware")


router.get("/get-email",authMiddleware,getEmail);


module.exports = router;