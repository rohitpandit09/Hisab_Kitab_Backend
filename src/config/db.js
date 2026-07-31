const mongoose = require('mongoose');

const fixUserIndexes = async () => {
    try {
        const db = mongoose.connection.db;
        const collection = db.collection('users');
        const indexes = await collection.indexes();

        for (const index of indexes) {
            if (index.key && index.key.googleId !== undefined) {
                const isUnique = index.unique === true;
                const isSparse = index.sparse === true;

                if (isUnique && !isSparse) {
                    await collection.dropIndex(index.name);
                    console.log(`[MongoDB] Dropped bad googleId index: ${index.name}`);
                }

                if (isUnique && isSparse) {
                    await collection.dropIndex(index.name);
                    console.log(`[MongoDB] Dropped old googleId unique+sparse index: ${index.name}`);
                }
            }
        }

        await collection.createIndex(
            { googleId: 1 },
            { sparse: true, unique: false, name: 'googleId_sparse' }
        );
        console.log('[MongoDB] googleId index ensured: sparse, non-unique');
    } catch (err) {
        console.error('[MongoDB] Index fix error:', err.message);
    }
};

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_DB_URI);
        console.log('[MongoDB] Connected successfully');
        await fixUserIndexes();
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
