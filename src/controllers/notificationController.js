const Notification = require("../models/Notification");
const { syncUserNotifications } = require("../utils/notificationSync");

exports.getNotifications = async (req, res) => {
    try {
        const userId = req.user._id;
        await syncUserNotifications(userId);

        const notifications = await Notification.find({ userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        const formatted = notifications.map((n) => ({
            id: n._id,
            title: n.title,
            description: n.description,
            type: n.type,
            read: n.read,
            time: n.createdAt
        }));

        return res.status(200).json({
            success: true,
            notifications: formatted,
            unreadCount: notifications.filter((n) => !n.read).length
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await Notification.findOneAndUpdate(
            { _id: id, userId: req.user._id },
            { read: true },
            { returnDocument: "after" }
        );

        if (!updated) {
            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Notification marked as read"
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.user._id, read: false },
            { read: true }
        );

        return res.status(200).json({
            success: true,
            message: "All notifications marked as read"
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

exports.deleteAllNotifications = async (req, res) => {
    try {
        await Notification.deleteMany({ userId: req.user._id });
        return res.status(200).json({
            success: true,
            message: "All notifications cleared"
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};
