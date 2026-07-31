const express = require("express");
const router = express.Router();
const { getNotifications, markAsRead, markAllAsRead, deleteAllNotifications } = require("../controllers/notificationController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.get("/", authMiddleware, getNotifications);
router.patch("/read-all", authMiddleware, markAllAsRead);
router.delete("/clear-all", authMiddleware, deleteAllNotifications);
router.patch("/:id/read", authMiddleware, markAsRead);

module.exports = router;
