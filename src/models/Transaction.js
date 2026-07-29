const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({

    userId : {
        type : String,
        required : true
    },

    transactions : [
        [
            {

                transactionDate : {
                    type : Date,
                    required : true
                },

                transactionId : {
                    type : String,
                    required : true
                },

                amount : {
                    type : Number,
                    required : true
                },

                merchantName : {
                    type : String,
                    required : true
                },

                description : {

                    type : String,
                    default : null

                },

                categoryType : {
                    type : String,
                    required : true
                },

                transactionType : {
                    type : String,
                    required : true
                }
            }
        ]
    ]
});

module.exports = mongoose.model("Transaction", transactionSchema);