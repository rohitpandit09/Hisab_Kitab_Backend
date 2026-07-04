const mongoose = require('mongoose');

const connectDB = async ()=>{

    try{

        await mongoose.connect(process.env.MONGO_DB_URI);
        console.log("MongoDB connected successfully")

    }catch(err){
        console.log("ERROR :- ",err);
    }
}

module.exports = connectDB;