const User = require("../models/User");
const axios = require("axios");
const { getFreshGoogleAccessToken } = require("../utils/googleGenerateToken");
const Groq = require("groq-sdk");
const Transaction = require("../models/Transaction");

const gmailAxios = axios.create({
    baseURL: "https://gmail.googleapis.com/gmail/v1",
    timeout: 25000,
});

const GMAIL_SEARCH_QUERY = 'newer_than:90d (subject:debited OR subject:credited OR subject:transaction OR subject:payment OR subject:transfer OR subject:alert OR subject:spent OR subject:withdrawn OR subject:deposited OR subject:UPI OR subject:NEFT OR subject:IMPS OR subject:RTGS OR subject:INR)';

const decodeBase64 = (data) => {
    if (!data) return "";
    try {
        return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    } catch {
        return "";
    }
};

const extractTextFromPayload = (payload) => {
    if (!payload) return "";

    if (payload.mimeType === "text/plain" && payload.body?.data) {
        return decodeBase64(payload.body.data);
    }

    if (payload.parts && payload.parts.length > 0) {
        for (const part of payload.parts) {
            const text = extractTextFromPayload(part);
            if (text) return text;
        }
    }

    if (payload.body?.data) {
        return decodeBase64(payload.body.data);
    }

    return "";
};

const getValidAccessToken = async (user) => {
    if (!user.gmailRefreshToken) {
        throw new Error("NO_REFRESH_TOKEN");
    }
    const freshToken = await getFreshGoogleAccessToken(user.gmailRefreshToken);
    await User.findByIdAndUpdate(user._id, { gmailAccessToken: freshToken });
    return freshToken;
};

const callGmailAPI = async (user, endpoint, params = {}) => {
    let token = user.gmailAccessToken;

    try {
        const res = await gmailAxios.get(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            params,
        });
        return res.data;
    } catch (err) {
        if (err.response?.status !== 401) throw err;
    }

    token = await getValidAccessToken(user);
    const res = await gmailAxios.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        params,
    });
    return res.data;
};

exports.getEmail = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        if (!user.gmailRefreshToken) {
            const stored = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();
            return res.status(200).json({ success: true, synced: false, message: "Gmail not connected.", transactions: stored });
        }

        let listData;
        try {
            listData = await callGmailAPI(user, "/users/me/messages", { q: GMAIL_SEARCH_QUERY, maxResults: 10 });
        } catch (err) {
            
            const stored = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();
            return res.status(200).json({ success: true, synced: false, message: "Gmail auth failed. Try re-connecting.", transactions: stored });
        }

        const messages = listData.messages;
        if (!messages || messages.length === 0) {
            const stored = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();
            return res.status(200).json({ success: true, synced: true, message: "No bank emails found.", transactions: stored });
        }

        const existingIds = new Set(
            (await Transaction.find(
                { userId: user._id, gmailMessageId: { $in: messages.map((m) => m.id), $ne: null } },
                "gmailMessageId"
            ).lean()).map((t) => t.gmailMessageId)
        );

        const newMessages = messages.filter((m) => !existingIds.has(m.id));

        if (newMessages.length === 0) {
            const stored = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();
            return res.status(200).json({ success: true, synced: true, transactions: stored });
        }

        const emailPayloads = [];

        for (const msg of newMessages) {
            try {
                const data = await callGmailAPI(user, `/users/me/messages/${msg.id}`, { format: "full" });
                const body = extractTextFromPayload(data.payload) || data.snippet || "";
                const headers = data.payload?.headers || [];
                const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "";
                const from = headers.find((h) => h.name.toLowerCase() === "from")?.value || "";

                emailPayloads.push({
                    id: data.id,
                    date: new Date(Number(data.internalDate)).toISOString(),
                    subject,
                    from,
                    body: body.slice(0, 1500),
                });

            } catch (err) {
                console.error(`Failed to fetch email ${msg.id}:`, err.message);
            }
        }

        if (emailPayloads.length === 0) {
            const stored = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();
            return res.status(200).json({ success: true, synced: true, transactions: stored });
        }

        if (!process.env.GROQ_API_KEY) {
            const stored = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();
            return res.status(200).json({ success: true, synced: true, transactions: stored });
        }

        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        const prompt = `You are a financial transaction extraction AI for Indian bank alert emails.

        Extract ALL bank transactions from the emails below. Never skip any transaction no matter how small (even ₹1).

        EMAILS:
        ${JSON.stringify(emailPayloads, null, 2)}

        RULES:
        - Set "emailId" to the exact "id" value from the email object (copy it exactly).
        - amount: extract the exact number (e.g. "INR 1.00" → 1, "Rs.500" → 500, "₹1,234.56" → 1234.56).
        - merchant: payee name, UPI ID, or bank name. Never leave blank — use "Bank Transfer" if unknown.
        - type: "Expense" if money left your account (debited/sent/paid/withdrawn). "Income" if money arrived (credited/received/deposited).
        - category: exactly one of: Food, Grocery, Shopping, Transport, Travel, Entertainment, Health, Education, Recharge, Bills, Fuel, Investment, Salary, Transfer, Rent, Utilities, Others
        - date: copy exactly from the email's "date" field.
        - Skip non-financial emails (OTP, login alerts, offers, password reset). Do not include them.

        Return ONLY a valid JSON array, no markdown, no explanation:
        [{"emailId":"...","merchant":"...","amount":0,"type":"Expense","category":"Others","date":"..."}]

        If no transactions found: []`;

        let parsedTransactions = [];
        try {
            const groqRes = await groq.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: "openai/gpt-oss-20b",
                temperature: 0,
                max_tokens: 2000,
            });

            console.log(groqRes);

            let raw = groqRes.choices[0]?.message?.content || "[]";
            raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
            const match = raw.match(/\[[\s\S]*\]/);
            raw = match ? match[0] : "[]";
            const parsed = JSON.parse(raw);
            parsedTransactions = Array.isArray(parsed) ? parsed : [];
        } catch (err) {

            console.error("Groq parse error:", err.message);
            parsedTransactions = [];
        }

        const emailIdMap = new Map(emailPayloads.map((e) => [e.id, e]));
        let savedCount = 0;

        for (const item of parsedTransactions) {
            if (!item.emailId || !item.merchant || item.amount === undefined || item.amount === null) continue;

            const numericAmount = parseFloat(String(item.amount).replace(/,/g, ""));
            if (isNaN(numericAmount) || numericAmount < 0) continue;

            const sourceEmail = emailIdMap.get(item.emailId);
            if (!sourceEmail) continue;

            const txDate = new Date(item.date || sourceEmail.date);
            if (isNaN(txDate.getTime())) continue;

            try {
                const result = await Transaction.updateOne(
                    { userId: user._id, gmailMessageId: item.emailId },
                    {
                        $setOnInsert: {
                            userId: user._id,
                            merchantName: String(item.merchant).trim().slice(0, 200),
                            amount: numericAmount,
                            transactionDate: txDate,
                            transactionType: item.type === "Income" ? "Income" : "Expense",
                            categoryType: item.category || "Others",
                            source: "Gmail",
                            gmailMessageId: item.emailId,
                        },
                    },
                    { upsert: true }
                );
                if (result.upsertedCount > 0) savedCount++;
            } catch (err) {
                console.error("Transaction save error:", err.message);
            }
        }

        const allTransactions = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();

        return res.status(200).json({
            success: true,
            synced: true,
            newCount: savedCount,
            transactions: allTransactions,
        });
    } catch (err) {
        console.error("getEmail fatal error:", err.message);
        return res.status(500).json({ success: false, message: err.message || "Gmail sync failed" });
    }
};

exports.getTransactions = async (req, res) => {
    try {
        const userId = req.user._id;
        const { search, category, type, month, year, page = 1, limit = 15, all } = req.query;

        const filter = { userId };

        if (category) filter.categoryType = category;
        if (type && ["Expense", "Income"].includes(type)) filter.transactionType = type;

        if (month !== undefined && year !== undefined) {
            const m = Number(month);
            const y = Number(year);
            filter.transactionDate = {
                $gte: new Date(y, m, 1),
                $lte: new Date(y, m + 1, 0, 23, 59, 59, 999),
            };
        }

        if (search && search.trim()) {
            const regex = new RegExp(search.trim(), "i");
            filter.$or = [{ merchantName: regex }, { categoryType: regex }, { description: regex }];
        }

        if (all === "true") {
            const transactions = await Transaction.find(filter).sort({ transactionDate: -1 }).lean();
            return res.status(200).json({
                success: true,
                transactions,
                pagination: { page: 1, limit: transactions.length, total: transactions.length, totalPages: 1 },
            });
        }

        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 15));

        const [transactions, total] = await Promise.all([
            Transaction.find(filter)
                .sort({ transactionDate: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            Transaction.countDocuments(filter),
        ]);

        return res.status(200).json({
            success: true,
            transactions,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum) || 1,
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.createTransaction = async (req, res) => {
    try {
        const { merchantName, amount, transactionDate, transactionType, categoryType, description } = req.body;

        if (!merchantName || !merchantName.trim()) {
            return res.status(400).json({ success: false, message: "Merchant Name is required" });
        }

        const numericAmount = parseFloat(amount);
        if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ success: false, message: "Amount must be a valid positive number" });
        }

        const tx = await Transaction.create({
            userId: req.user._id,
            merchantName: merchantName.trim(),
            amount: numericAmount,
            transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
            transactionType: transactionType || "Expense",
            categoryType: categoryType || "Others",
            description: description?.trim() || null,
            source: "Manual",
        });

        return res.status(201).json({ success: true, message: "Transaction added successfully", transaction: tx });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = {};
        const allowed = ["merchantName", "amount", "transactionDate", "transactionType", "categoryType", "description"];

        for (const field of allowed) {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "No valid fields to update" });
        }

        if (updates.amount !== undefined) {
            updates.amount = parseFloat(updates.amount);
            if (isNaN(updates.amount) || updates.amount < 0) {
                return res.status(400).json({ success: false, message: "Amount must be a valid positive number" });
            }
        }

        if (updates.transactionDate) updates.transactionDate = new Date(updates.transactionDate);

        if (updates.transactionType && !["Expense", "Income"].includes(updates.transactionType)) {
            return res.status(400).json({ success: false, message: "Transaction type must be Expense or Income" });
        }

        const updated = await Transaction.findOneAndUpdate(
            { _id: id, userId: req.user._id },
            updates,
            { returnDocument: "after", runValidators: true }
        );

        if (!updated) return res.status(404).json({ success: false, message: "Transaction not found" });

        return res.status(200).json({ success: true, message: "Transaction updated", transaction: updated });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteTransaction = async (req, res) => {
    try {
        const deleted = await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: "Transaction not found" });
        return res.status(200).json({ success: true, message: "Transaction deleted" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateIncome = async (req, res) => {
    try {
        const { monthlySalary } = req.body;
        if (monthlySalary === undefined || monthlySalary === null) {
            return res.status(400).json({ success: false, message: "Please specify an income value" });
        }
        const updated = await User.findByIdAndUpdate(req.user._id, { income: Number(monthlySalary) }, { returnDocument: "after" });
        return res.status(200).json({ success: true, message: "Income updated successfully", income: updated.income });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.getIncome = async (req, res) => {
    try {
        const user = await User.findById(req.user._id, "income").lean();
        return res.status(200).json({ success: true, income: user?.income || 0 });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
