const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Groq = require("groq-sdk");

const getMonthRange = (year, month) => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { start, end };
};

const aggregateExpenses = (transactions) => {
    const categoryMap = {};
    let total = 0;
    transactions.forEach((t) => {
        const cat = t.categoryType || "Others";
        const amt = Number(t.amount) || 0;
        categoryMap[cat] = (categoryMap[cat] || 0) + amt;
        total += amt;
    });
    return { categoryMap, total };
};

const buildRuleBasedInsights = (currentData, previousData, categoryBreakdown) => {
    const insights = [];
    const change = previousData.totalExpense > 0
        ? Math.round(((currentData.totalExpense - previousData.totalExpense) / previousData.totalExpense) * 100)
        : 0;

    if (change > 0) {
        insights.push({
            text: `Spending increased by ${change}% compared to last month.`,
            type: "warning"
        });
    } else if (change < 0) {
        insights.push({
            text: `Spending decreased by ${Math.abs(change)}% compared to last month. Great job!`,
            type: "success"
        });
    }

    const topCategory = categoryBreakdown[0];
    if (topCategory) {
        insights.push({
            text: `${topCategory.category} accounts for ${topCategory.percentage}% of all expenses this month.`,
            type: "info"
        });
    }

    if (currentData.savingsRate >= 20) {
        insights.push({
            text: `Your savings rate of ${currentData.savingsRate}% is healthy. Keep it up!`,
            type: "success"
        });
    } else if (currentData.savingsRate < 10) {
        insights.push({
            text: `Savings rate is ${currentData.savingsRate}%. Try reducing discretionary spending to improve financial health.`,
            type: "warning"
        });
    }

    Object.keys(currentData.categoryMap).forEach((cat) => {
        const current = currentData.categoryMap[cat] || 0;
        const previous = previousData.categoryMap[cat] || 0;
        if (previous > 0 && current > previous) {
            const diff = current - previous;
            insights.push({
                text: `${cat} spending increased by ₹${diff.toLocaleString("en-IN")} compared to last month.`,
                type: "info"
            });
        }
    });

    return insights.slice(0, 6);
};

const generateAiInsights = async (reportPayload) => {
    if (!process.env.GROQ_API_KEY) {
        return buildRuleBasedInsights(
            reportPayload.current,
            reportPayload.previous,
            reportPayload.categoryBreakdown
        );
    }

    try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const prompt = `You are a personal finance advisor. Based on this monthly financial data, provide 4 concise actionable insights as a JSON array of objects with "text" and "type" (success, info, warning, or error) keys.

Data: ${JSON.stringify(reportPayload)}

Output ONLY valid JSON array. Example: [{"text":"Reduce food delivery spending","type":"warning"}]`;

        const response = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile"
        });

        let raw = response.choices[0]?.message?.content || "[]";
        raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.slice(0, 6);
        }
    } catch (err) {
        console.error("AI insights error:", err.message);
    }

    return buildRuleBasedInsights(
        reportPayload.current,
        reportPayload.previous,
        reportPayload.categoryBreakdown
    );
};

exports.getMonthlyReport = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();
        const month = req.query.month !== undefined ? Number(req.query.month) : now.getMonth();
        const year = req.query.year !== undefined ? Number(req.query.year) : now.getFullYear();

        const currentRange = getMonthRange(year, month);
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        const previousRange = getMonthRange(prevYear, prevMonth);

        const [user, currentTx, previousTx] = await Promise.all([
            User.findById(userId, "income").lean(),
            Transaction.find({
                userId,
                transactionDate: { $gte: currentRange.start, $lte: currentRange.end }
            }).lean(),
            Transaction.find({
                userId,
                transactionDate: { $gte: previousRange.start, $lte: previousRange.end }
            }).lean()
        ]);

        const salary = Number(user?.income) || 0;
        const currentIncomeTx = currentTx.filter((t) => t.transactionType === "Income");
        const currentExpenseTx = currentTx.filter((t) => t.transactionType === "Expense");
        const previousExpenseTx = previousTx.filter((t) => t.transactionType === "Expense");

        const incomeFromTx = currentIncomeTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const totalIncome = salary + incomeFromTx;
        const currentAgg = aggregateExpenses(currentExpenseTx);
        const previousAgg = aggregateExpenses(previousExpenseTx);

        const totalExpense = currentAgg.total;
        const savings = totalIncome - totalExpense;
        const savingsRate = totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0;

        const categoryBreakdown = Object.entries(currentAgg.categoryMap)
            .map(([category, amount]) => ({
                category,
                amount,
                percentage: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0
            }))
            .sort((a, b) => b.amount - a.amount);

        const highestExpense = currentExpenseTx.length > 0
            ? currentExpenseTx.reduce((max, t) => (Number(t.amount) > Number(max.amount) ? t : max))
            : null;

        const highestIncome = currentIncomeTx.length > 0
            ? currentIncomeTx.reduce((max, t) => (Number(t.amount) > Number(max.amount) ? t : max))
            : (salary > 0 ? { merchantName: "Salary", amount: salary } : null);

        const topCategory = categoryBreakdown[0] || null;

        const budgetUtilization = totalIncome > 0
            ? Math.min(100, Math.round((totalExpense / totalIncome) * 100))
            : 0;

        const financialScore = Math.max(0, Math.min(100,
            Math.round(
                (savingsRate * 0.4) +
                (Math.max(0, 100 - budgetUtilization) * 0.3) +
                (savings >= 0 ? 30 : 0)
            )
        ));

        const monthComparison = {
            thisMonth: totalExpense,
            lastMonth: previousAgg.total,
            changePercent: previousAgg.total > 0
                ? Math.round(((totalExpense - previousAgg.total) / previousAgg.total) * 100)
                : 0
        };

        const reportPayload = {
            current: {
                totalIncome,
                totalExpense,
                savings,
                savingsRate,
                categoryMap: currentAgg.categoryMap
            },
            previous: {
                totalExpense: previousAgg.total,
                categoryMap: previousAgg.categoryMap
            },
            categoryBreakdown
        };

        const aiInsights = await generateAiInsights(reportPayload);

        let healthMessage = "You're maintaining healthy spending habits.";
        if (financialScore >= 80) {
            healthMessage = "Excellent! You're maintaining healthy spending habits.";
        } else if (financialScore >= 50) {
            healthMessage = "Good progress. Focus on reducing discretionary expenses.";
        } else {
            healthMessage = "Your spending needs attention. Review budgets and cut non-essential costs.";
        }

        return res.status(200).json({
            success: true,
            report: {
                totalIncome,
                totalExpense,
                savings,
                savingsRate,
                categoryBreakdown,
                monthComparison,
                highestExpense: highestExpense
                    ? { merchant: highestExpense.merchantName, amount: Number(highestExpense.amount) }
                    : null,
                highestIncome: highestIncome
                    ? { merchant: highestIncome.merchantName, amount: Number(highestIncome.amount) }
                    : null,
                topCategory: topCategory
                    ? { category: topCategory.category, amount: topCategory.amount }
                    : null,
                financialScore,
                healthMessage,
                aiInsights,
                month,
                year
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

exports.exportTransactions = async (req, res) => {
    try {
        const userId = req.user._id;
        const format = req.query.format || "csv";

        const transactions = await Transaction.find({ userId })
            .sort({ transactionDate: -1 })
            .lean();

        if (format === "json") {
            res.setHeader("Content-Disposition", "attachment; filename=transactions.json");
            res.setHeader("Content-Type", "application/json");
            return res.status(200).json({
                success: true,
                exportedAt: new Date().toISOString(),
                count: transactions.length,
                transactions
            });
        }

        const headers = ["Date", "Merchant", "Category", "Type", "Amount", "Source", "Description"];
        const rows = transactions.map((t) => [
            new Date(t.transactionDate).toISOString().split("T")[0],
            `"${(t.merchantName || "").replace(/"/g, '""')}"`,
            t.categoryType || "Others",
            t.transactionType,
            Number(t.amount),
            t.source || "Manual",
            `"${(t.description || "").replace(/"/g, '""')}"`
        ]);

        const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

        res.setHeader("Content-Disposition", "attachment; filename=transactions.csv");
        res.setHeader("Content-Type", "text/csv");
        return res.status(200).send(csv);
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};
