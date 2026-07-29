const User = require("../models/User");
const axios = require("axios");
const { getFreshGoogleAccessToken } = require("../utils/googleGenerateToken");
const Groq = require("groq-sdk");



exports.getEmail = async (req, res) => {

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  try {
    const user = req.user;

    const existingUser = await User.findOne({
      googleId: user.googleId,
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let googleAccessToken = existingUser.gmailAccessToken;
    

    // Helper function to fetch email ids
    const fetchEmailIds = async (accessToken) => {
      return await axios.get(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            q: "newer_than:30d subject:transaction OR famapp OR bank (alert OR credited OR debited OR bank OR payment OR fampay OR axis" ,
            maxResults: 100,
          },
        }
      );
    };

    let emailIdsResponse;

    try {
      // First try with stored access token
      emailIdsResponse = await fetchEmailIds(googleAccessToken);

    } catch (err) {
      // Access token expired
      if (err.response?.status === 401) {
        

        googleAccessToken = await getFreshGoogleAccessToken(
          existingUser.gmailRefreshToken
        );

        // Save new access token
        existingUser.gmailAccessToken = googleAccessToken;
        await existingUser.save();

        // Retry
        emailIdsResponse = await fetchEmailIds(googleAccessToken);
        
      } else {

        throw err;

      }
    }

    const messages = emailIdsResponse.data.messages;

    if (!messages || messages.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No emails found",
      });
    }

    // Fetch metadata for all emails
    const emailPromises = messages.map((message) =>
      axios.get(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
        {
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
          },
          params: {
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"],
          },
        }
      )
    );

    const emailResponses = await Promise.all(emailPromises);

    const emails = emailResponses.map((email) => email.data.snippet);

    const prompt = `You are an expert financial transaction categorization AI.

      You will receive a financial transaction email.

      Your task is to identify the merchant, understand what the payment was for, and classify it into the most appropriate spending category.

      Categories (choose exactly one):

      Food
      Grocery
      Shopping
      Transport
      Travel
      Entertainment
      Health
      Medical
      Education
      Recharge
      Bills
      Fuel
      Investment
      Salary
      Transfer
      Rent
      EMI
      Insurance
      Subscription
      Taxes
      ATM Withdrawal
      Cash Deposit
      Refund
      Cashback
      Donation
      Utilities
      Others

      Rules:

      1. Choose ONLY one category.
      2. Infer the category using merchant name, transaction description, subject, sender and email body.
      3. If the merchant is unknown, use the transaction description.
      4. Never guess wildly. If uncertain, return "Others".
      5. Return ONLY valid JSON.
      6. Do not include markdown or explanations.

      JSON Format:

      {
        "merchant": "",
        "category": "",
        "confidence": 0-100,
        "reason": ""
    }`

    const transactions = await groq.chat.completions.create({
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    model: "openai/gpt-oss-20b",
  });

    return res.status(200).json({
      success: true,
      count: emails.length,
      email : transactions.choices[0].message.content,
    });

  } catch (err) {
    
    return res.status(500).json({
      success: false,
      message: err.response?.data || err.message,
    });
  }
};