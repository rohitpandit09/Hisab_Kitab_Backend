const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_DB_URI);
        console.log('[MongoDB] Connected successfully');
    } catch (err) {
        console.error(`[MongoDB Connection Error]: ${err.message}`);
        process.exit(1);
    }
};

process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('[MongoDB] Connection closed on app termination');
    process.exit(0);
});

module.exports = connectDB;
