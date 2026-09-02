const User = require("../models/User");
const axios = require("axios");
const { getFreshGoogleAccessToken } = require("../utils/googleGenerateToken");
const { ChatGroq } = require("@langchain/groq");
const Transaction = require("../models/Transaction");

const gmailAxios = axios.create({
    baseURL: "https://gmail.googleapis.com/gmail/v1",
    timeout: 25000,
});

const GMAIL_SEARCH_QUERY =
    'newer_than:90d (subject:debited OR subject:credited OR subject:transaction OR subject:payment OR subject:transfer OR subject:alert OR subject:spent OR subject:withdrawn OR subject:deposited OR subject:UPI OR subject:NEFT OR subject:IMPS OR subject:RTGS OR subject:INR)';

const decodeBase64 = (data) => {
    if (!data) return "";

    try {
        return Buffer.from(
            data.replace(/-/g, "+").replace(/_/g, "/"),
            "base64"
        ).toString("utf-8");
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

            if (text) {
                return text;
            }
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

    const freshToken = await getFreshGoogleAccessToken(
        user.gmailRefreshToken
    );

    await User.findByIdAndUpdate(user._id, {
        gmailAccessToken: freshToken,
    });

    return freshToken;
};

const callGmailAPI = async (user, endpoint, params = {}) => {
    let token = user.gmailAccessToken;

    try {
        const response = await gmailAxios.get(endpoint, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            params,
        });

        return response.data;
    } catch (err) {
        if (err.response?.status !== 401) {
            throw err;
        }
    }

    token = await getValidAccessToken(user);

    const response = await gmailAxios.get(endpoint, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        params,
    });

    return response.data;
};

const createGroqModel = () => {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is missing");
    }

    return new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model: "openai/gpt-oss-120b",
        temperature: 0,
        maxTokens: 4000,
    });
};

const cleanAIResponse = (content) => {
    if (typeof content !== "string") {
        return "[]";
    }

    let raw = content
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");

    if (start === -1 || end === -1 || end < start) {
        return "[]";
    }

    return raw.slice(start, end + 1);
};

const extractTransactionsWithAI = async (emailPayloads) => {
    const model = createGroqModel();

    const prompt = `
You are a financial transaction extraction AI for Indian bank alert emails.

Your task is to extract ALL financial transactions from the provided emails.

Never skip a transaction, even if the amount is very small such as ₹1.

EMAILS:

${JSON.stringify(emailPayloads, null, 2)}

RULES:

1. Set "emailId" to the exact "id" value from the email object.

2. "amount":
Extract the exact transaction amount.
Examples:
INR 1.00 -> 1
Rs.500 -> 500
₹1,234.56 -> 1234.56

3. "merchant":
Use the payee, merchant name, UPI ID, recipient name, sender name, or bank name.

Never leave merchant empty.

If the merchant cannot be identified, use:
"Bank Transfer"

4. "type":
Use exactly one of:

Expense
Income

Expense means money left the user's account:
- debited
- sent
- paid
- withdrawn
- purchase

Income means money entered the user's account:
- credited
- received
- deposited
- salary

5. "category":

Use exactly one of:

Food
Grocery
Shopping
Transport
Travel
Entertainment
Health
Education
Recharge
Bills
Fuel
Investment
Salary
Transfer
Rent
Utilities
Others

6. "date":
Copy the exact date from the email object's "date" field.

7. Ignore non-financial emails:
- OTP
- login alerts
- security alerts
- promotional offers
- advertisements
- password reset
- account notifications without a financial transaction

8. Return ONLY a valid JSON array.

Do not return markdown.

Do not return explanations.

Required format:

[
    {
        "emailId": "gmail-message-id",
        "merchant": "merchant name",
        "amount": 0,
        "type": "Expense",
        "category": "Others",
        "date": "email date"
    }
]

If there are no transactions, return:

[]
`;

    const response = await model.invoke(prompt);

    let content = "";

    if (typeof response.content === "string") {
        content = response.content;
    } else if (Array.isArray(response.content)) {
        content = response.content
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                return item?.text || "";
            })
            .join("");
    }

    const cleaned = cleanAIResponse(content);

    try {
        const parsed = JSON.parse(cleaned);

        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("LangChain Groq JSON parse error:", err.message);
        console.error("AI response:", content);

        return [];
    }
};

exports.getEmail = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        if (!user.gmailRefreshToken) {
            const stored = await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                synced: false,
                message: "Gmail not connected.",
                transactions: stored,
            });
        }

        let listData;

        try {
            listData = await callGmailAPI(
                user,
                "/users/me/messages",
                {
                    q: GMAIL_SEARCH_QUERY,
                    maxResults: 10,
                }
            );
        } catch (err) {
            console.error("Gmail API error:", err.message);

            const stored = await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                synced: false,
                message: "Gmail auth failed. Try re-connecting.",
                transactions: stored,
            });
        }

        const messages = listData.messages;

        if (!messages || messages.length === 0) {
            const stored = await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                synced: true,
                message: "No bank emails found.",
                transactions: stored,
            });
        }

        const messageIds = messages.map((message) => message.id);

        const existingIds = new Set(
            (
                await Transaction.find(
                    {
                        userId: user._id,
                        gmailMessageId: {
                            $in: messageIds,
                            $ne: null,
                        },
                    },
                    "gmailMessageId"
                ).lean()
            ).map((transaction) => transaction.gmailMessageId)
        );

        const newMessages = messages.filter(
            (message) => !existingIds.has(message.id)
        );

        if (newMessages.length === 0) {
            const stored = await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                synced: true,
                newCount: 0,
                transactions: stored,
            });
        }

        const emailPayloads = [];

        for (const message of newMessages) {
            try {
                const data = await callGmailAPI(
                    user,
                    `/users/me/messages/${message.id}`,
                    {
                        format: "full",
                    }
                );

                const body =
                    extractTextFromPayload(data.payload) ||
                    data.snippet ||
                    "";

                const headers = data.payload?.headers || [];

                const subject =
                    headers.find(
                        (header) =>
                            header.name.toLowerCase() === "subject"
                    )?.value || "";

                const from =
                    headers.find(
                        (header) =>
                            header.name.toLowerCase() === "from"
                    )?.value || "";

                emailPayloads.push({
                    id: data.id,
                    date: new Date(
                        Number(data.internalDate)
                    ).toISOString(),
                    subject,
                    from,
                    body: body.slice(0, 1500),
                });
            } catch (err) {
                console.error(
                    `Failed to fetch email ${message.id}:`,
                    err.message
                );
            }
        }

        if (emailPayloads.length === 0) {
            const stored = await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                synced: true,
                newCount: 0,
                transactions: stored,
            });
        }

        if (!process.env.GROQ_API_KEY) {
            const stored = await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                synced: false,
                message: "Groq AI is not configured.",
                transactions: stored,
            });
        }

        let parsedTransactions = [];

        try {
            parsedTransactions =
                await extractTransactionsWithAI(
                    emailPayloads
                );
        } catch (err) {
            console.error(
                "LangChain Groq error:",
                err.message
            );

            const stored = await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                synced: false,
                message: "AI transaction processing failed.",
                transactions: stored,
            });
        }

        const emailIdMap = new Map(
            emailPayloads.map((email) => [
                email.id,
                email,
            ])
        );

        let savedCount = 0;

        for (const item of parsedTransactions) {
            if (
                !item.emailId ||
                !item.merchant ||
                item.amount === undefined ||
                item.amount === null
            ) {
                continue;
            }

            const numericAmount = parseFloat(
                String(item.amount).replace(/,/g, "")
            );

            if (
                isNaN(numericAmount) ||
                numericAmount < 0
            ) {
                continue;
            }

            const sourceEmail = emailIdMap.get(
                item.emailId
            );

            if (!sourceEmail) {
                continue;
            }

            const txDate = new Date(
                item.date || sourceEmail.date
            );

            if (isNaN(txDate.getTime())) {
                continue;
            }

            const allowedCategories = [
                "Food",
                "Grocery",
                "Shopping",
                "Transport",
                "Travel",
                "Entertainment",
                "Health",
                "Education",
                "Recharge",
                "Bills",
                "Fuel",
                "Investment",
                "Salary",
                "Transfer",
                "Rent",
                "Utilities",
                "Others",
            ];

            const category = allowedCategories.includes(
                item.category
            )
                ? item.category
                : "Others";

            const transactionType =
                item.type === "Income"
                    ? "Income"
                    : "Expense";

            try {
                const result =
                    await Transaction.updateOne(
                        {
                            userId: user._id,
                            gmailMessageId: item.emailId,
                        },
                        {
                            $setOnInsert: {
                                userId: user._id,
                                merchantName: String(
                                    item.merchant
                                )
                                    .trim()
                                    .slice(0, 200),
                                amount: numericAmount,
                                transactionDate: txDate,
                                transactionType,
                                categoryType: category,
                                source: "Gmail",
                                gmailMessageId:
                                    item.emailId,
                            },
                        },
                        {
                            upsert: true,
                        }
                    );

                if (result.upsertedCount > 0) {
                    savedCount++;
                }
            } catch (err) {
                console.error(
                    "Transaction save error:",
                    err.message
                );
            }
        }

        const allTransactions =
            await Transaction.find({
                userId: user._id,
            })
                .sort({ transactionDate: -1 })
                .lean();

        return res.status(200).json({
            success: true,
            synced: true,
            newCount: savedCount,
            transactions: allTransactions,
        });
    } catch (err) {
        console.error(
            "getEmail fatal error:",
            err.message
        );

        return res.status(500).json({
            success: false,
            message:
                err.message ||
                "Gmail sync failed",
        });
    }
};

exports.getTransactions = async (req, res) => {
    try {
        const userId = req.user._id;

        const {
            search,
            category,
            type,
            month,
            year,
            page = 1,
            limit = 15,
            all,
        } = req.query;

        const filter = {
            userId,
        };

        if (category) {
            filter.categoryType = category;
        }

        if (
            type &&
            ["Expense", "Income"].includes(type)
        ) {
            filter.transactionType = type;
        }

        if (
            month !== undefined &&
            year !== undefined
        ) {
            const m = Number(month);
            const y = Number(year);

            filter.transactionDate = {
                $gte: new Date(y, m, 1),
                $lte: new Date(
                    y,
                    m + 1,
                    0,
                    23,
                    59,
                    59,
                    999
                ),
            };
        }

        if (search && search.trim()) {
            const regex = new RegExp(
                search.trim(),
                "i"
            );

            filter.$or = [
                {
                    merchantName: regex,
                },
                {
                    categoryType: regex,
                },
                {
                    description: regex,
                },
            ];
        }

        if (all === "true") {
            const transactions =
                await Transaction.find(filter)
                    .sort({
                        transactionDate: -1,
                    })
                    .lean();

            return res.status(200).json({
                success: true,
                transactions,
                pagination: {
                    page: 1,
                    limit: transactions.length,
                    total: transactions.length,
                    totalPages: 1,
                },
            });
        }

        const pageNum = Math.max(
            1,
            Number(page) || 1
        );

        const limitNum = Math.min(
            100,
            Math.max(1, Number(limit) || 15)
        );

        const [transactions, total] =
            await Promise.all([
                Transaction.find(filter)
                    .sort({
                        transactionDate: -1,
                    })
                    .skip(
                        (pageNum - 1) *
                            limitNum
                    )
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
                totalPages:
                    Math.ceil(
                        total / limitNum
                    ) || 1,
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

exports.createTransaction = async (req, res) => {
    try {
        const {
            merchantName,
            amount,
            transactionDate,
            transactionType,
            categoryType,
            description,
        } = req.body;

        if (
            !merchantName ||
            !merchantName.trim()
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Merchant Name is required",
            });
        }

        const numericAmount =
            parseFloat(amount);

        if (
            !amount ||
            isNaN(numericAmount) ||
            numericAmount <= 0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Amount must be a valid positive number",
            });
        }

        const tx =
            await Transaction.create({
                userId: req.user._id,
                merchantName:
                    merchantName.trim(),
                amount: numericAmount,
                transactionDate:
                    transactionDate
                        ? new Date(
                              transactionDate
                          )
                        : new Date(),
                transactionType:
                    transactionType ||
                    "Expense",
                categoryType:
                    categoryType ||
                    "Others",
                description:
                    description?.trim() ||
                    null,
                source: "Manual",
            });

        return res.status(201).json({
            success: true,
            message:
                "Transaction added successfully",
            transaction: tx,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

exports.updateTransaction = async (
    req,
    res
) => {
    try {
        const { id } = req.params;

        const updates = {};

        const allowed = [
            "merchantName",
            "amount",
            "transactionDate",
            "transactionType",
            "categoryType",
            "description",
        ];

        for (const field of allowed) {
            if (
                req.body[field] !==
                undefined
            ) {
                updates[field] =
                    req.body[field];
            }
        }

        if (
            Object.keys(updates).length ===
            0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "No valid fields to update",
            });
        }

        if (
            updates.amount !== undefined
        ) {
            updates.amount =
                parseFloat(
                    updates.amount
                );

            if (
                isNaN(updates.amount) ||
                updates.amount < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Amount must be a valid positive number",
                });
            }
        }

        if (updates.transactionDate) {
            updates.transactionDate =
                new Date(
                    updates.transactionDate
                );
        }

        if (
            updates.transactionType &&
            ![
                "Expense",
                "Income",
            ].includes(
                updates.transactionType
            )
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Transaction type must be Expense or Income",
            });
        }

        const updated =
            await Transaction.findOneAndUpdate(
                {
                    _id: id,
                    userId: req.user._id,
                },
                updates,
                {
                    returnDocument: "after",
                    runValidators: true,
                }
            );

        if (!updated) {
            return res.status(404).json({
                success: false,
                message:
                    "Transaction not found",
            });
        }

        return res.status(200).json({
            success: true,
            message:
                "Transaction updated",
            transaction: updated,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

exports.deleteTransaction = async (
    req,
    res
) => {
    try {
        const deleted =
            await Transaction.findOneAndDelete(
                {
                    _id: req.params.id,
                    userId: req.user._id,
                }
            );

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message:
                    "Transaction not found",
            });
        }

        return res.status(200).json({
            success: true,
            message:
                "Transaction deleted",
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

exports.updateIncome = async (
    req,
    res
) => {
    try {
        const { monthlySalary } =
            req.body;

        if (
            monthlySalary ===
                undefined ||
            monthlySalary === null
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Please specify an income value",
            });
        }

        const updated =
            await User.findByIdAndUpdate(
                req.user._id,
                {
                    income:
                        Number(
                            monthlySalary
                        ),
                },
                {
                    returnDocument:
                        "after",
                }
            );

        return res.status(200).json({
            success: true,
            message:
                "Income updated successfully",
            income: updated.income,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

exports.getIncome = async (
    req,
    res
) => {
    try {
        const user =
            await User.findById(
                req.user._id,
                "income"
            ).lean();

        return res.status(200).json({
            success: true,
            income:
                user?.income || 0,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};