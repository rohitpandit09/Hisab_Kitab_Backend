const Notification = require("../models/Notification");
const Budget = require("../models/Budget");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

const upsertNotification = async (userId, data) => {
    await Notification.findOneAndUpdate(
        { userId, referenceKey: data.referenceKey },
        { userId, ...data },
        { upsert: true, returnDocument: "after" }
    );
};

exports.syncUserNotifications = async (userId) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [user, budgets, monthlyExpenses] = await Promise.all([
        User.findById(userId, "notifications").lean(),
        Budget.find({ userId }),
        Transaction.find({
            userId,
            transactionType: "Expense",
            transactionDate: { $gte: startOfMonth }
        })
    ]);

    const budgetAlertsEnabled = user?.notifications?.budgetAlerts !== false;
    const aiInsightsEnabled = user?.notifications?.aiInsights !== false;

    const categorySpentMap = {};
    monthlyExpenses.forEach((t) => {
        const cat = t.categoryType || "Others";
        categorySpentMap[cat] = (categorySpentMap[cat] || 0) + (Number(t.amount) || 0);
    });

    if (budgetAlertsEnabled) {
        for (const budget of budgets) {
            const spent = categorySpentMap[budget.category] || 0;
            const percent = budget.targetAmount > 0 ? Math.round((spent / budget.targetAmount) * 100) : 0;

            if (percent >= 100) {
                await upsertNotification(userId, {
                    title: `${budget.category} Budget Exceeded`,
                    description: `You have spent ₹${spent.toLocaleString("en-IN")} against your ₹${budget.targetAmount.toLocaleString("en-IN")} ${budget.category} budget.`,
                    type: "error",
                    referenceKey: `budget-exceeded-${budget.category}-${now.getFullYear()}-${now.getMonth()}`
                });
            } else if (percent >= 80) {
                await upsertNotification(userId, {
                    title: `${budget.category} Budget Warning`,
                    description: `${budget.category} spending has reached ${percent}% of your monthly budget. Consider pacing expenses.`,
                    type: "warning",
                    referenceKey: `budget-warning-${budget.category}-${now.getFullYear()}-${now.getMonth()}`
                });
            }
        }
    }

    if (aiInsightsEnabled) {
        const gmailCount = await Transaction.countDocuments({ userId, source: "Gmail" });
        if (gmailCount > 0) {
            await upsertNotification(userId, {
                title: "Gmail Transaction Sync Active",
                description: `AI has extracted ${gmailCount} transaction${gmailCount === 1 ? "" : "s"} from your connected Gmail account.`,
                type: "success",
                referenceKey: "gmail-sync-status"
            });
        }
    }

    const manualCount = await Transaction.countDocuments({ userId, source: "Manual" });
    const gmailTotal = await Transaction.countDocuments({ userId, source: "Gmail" });
    if (manualCount === 0 && gmailTotal === 0) {
        await upsertNotification(userId, {
            title: "Get Started with Hisab Kitab",
            description: "Add your first transaction or connect Gmail to start tracking your finances automatically.",
            type: "info",
            referenceKey: "onboarding-empty"
        });
    }
};
