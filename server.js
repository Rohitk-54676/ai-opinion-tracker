require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = "meta-llama/llama-3-8b-instruct";

// ── Clean markdown formatting from AI response ────────────────────────────────
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")   // remove **bold**
    .replace(/\*(.*?)\*/g, "$1")       // remove *italic*
    .replace(/#{1,6}\s/g, "")          // remove headings
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // remove code blocks
    .replace(/^\s*[-•]\s/gm, "• ")     // normalize bullets
    .replace(/\n{3,}/g, "\n\n")        // max 2 newlines
    .trim();
}

// ── Call OpenRouter AI ────────────────────────────────────────────────────────
async function callAI(messages, temperature = 0.3) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opinion-tracker.onrender.com",
      "X-Title": "AI Opinion Tracker",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature,
      top_p: 0.8,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ── Extract JSON safely ───────────────────────────────────────────────────────
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {}

  const match = text.match(/\{[\s\S]*/);
  if (!match) throw new Error("No JSON found");

  let json = match[0];
  if (!json.trim().endsWith("}")) json = json + "}";

  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error("Still invalid JSON:\n" + json);
  }
}

// ── Analyze endpoint ──────────────────────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim())
    return res.status(400).json({ error: "No text provided." });

  const prompt = `You are an expert public opinion analyst. Analyze the following opinion(s) and Return ONLY raw JSON.
Do NOT include:
- explanations
- text before or after
- markdown
- code blocks

Start with { and end with }, no explanation outside the JSON.

Return this exact structure:
{
  "sentiment": "Positive" | "Negative" | "Neutral",
  "score": <number 0-100 representing sentiment strength>,
  "reason": "<1-2 sentence explanation>",
  "topics": ["topic1", "topic2", "topic3"],
  "insight": "<2-3 sentence overall insight>",
  "trend": "<one word: Rising | Falling | Stable>",
  "emotions": ["emotion1", "emotion2"],
  "recommendation": "<1 sentence actionable recommendation>"
}

Text to analyze:
"""
${text}
"""`;

  try {
    const raw = await callAI([{ role: "user", content: prompt }]);
    const result = extractJSON(raw);
    res.json({ success: true, result });
  } catch (err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Compare endpoint ──────────────────────────────────────────────────────────
app.post("/api/compare", async (req, res) => {
  const { topicA, topicB } = req.body;
  if (!topicA || !topicB)
    return res.status(400).json({ error: "Both topics required." });

  const prompt = `You are an expert opinion analyst. Compare these two opinions/topics and return ONLY valid JSON.

{
  "topicA": {
    "sentiment": "Positive" | "Negative" | "Neutral",
    "score": <0-100>,
    "summary": "<1 sentence>"
  },
  "topicB": {
    "sentiment": "Positive" | "Negative" | "Neutral",
    "score": <0-100>,
    "summary": "<1 sentence>"
  },
  "winner": "A" | "B" | "Tie",
  "winnerLabel": "<which topic name is more positive>",
  "keyDifferences": ["difference1", "difference2", "difference3"],
  "comparison": "<2-3 sentence comparative insight>"
}

Topic A: "${topicA}"
Topic B: "${topicB}"`;

  try {
    const raw = await callAI([{ role: "user", content: prompt }]);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const result = JSON.parse(jsonMatch[0]);
    res.json({ success: true, result });
  } catch (err) {
    console.error("Compare error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat endpoint ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "Messages array required." });

  const systemPrompt = `You are OpinionBot, a focused AI assistant that ONLY discusses topics related to:
- Public opinion analysis
- Sentiment analysis and sentiment trends
- Social discourse and public perception
- Opinion polling and survey insights
- Brand reputation and public image
- Political, social, or market sentiment
- Emotional trends in news, social media, or public statements

STRICT RULES you must always follow:
// 1. If the user asks about ANYTHING outside the above scope (cooking, travel, coding, sports tips, general knowledge, recipes, directions, etc.), you MUST politely decline and redirect. Example: "I'm only able to help with public opinion and sentiment analysis topics. Ask me about sentiment, opinions, or public discourse!"
2. NEVER use markdown formatting. No **bold**, no *italic*, no # headings, no bullet dashes (-), no backticks. Write in plain natural sentences only.
3. Use "•" for bullet points only when listing multiple items, not dashes or asterisks.
4. Keep responses concise — 2 to 4 sentences maximum unless listing items.
5. Be conversational and friendly. One emoji per response maximum.
6. Never give generic advice unrelated to opinion/sentiment analysis.

${context ? `Current analysis context:\n${context}\n` : ""}`;

  try {
    const raw = await callAI(
      [{ role: "system", content: systemPrompt }, ...messages],
      0.7
    );

    // Clean any residual markdown the model sneaks in
    const clean = cleanMarkdown(raw);

    res.json({ success: true, reply: clean });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk analyze endpoint ─────────────────────────────────────────────────────
app.post("/api/bulk", async (req, res) => {
  const { opinions } = req.body;
  if (!opinions || !Array.isArray(opinions))
    return res.status(400).json({ error: "Opinions array required." });

  const prompt = `Analyze these ${opinions.length} opinions and return ONLY valid JSON.

{
  "overall_sentiment": "Positive" | "Negative" | "Neutral" | "Mixed",
  "distribution": {
    "positive": <percentage 0-100>,
    "negative": <percentage 0-100>,
    "neutral": <percentage 0-100>
  },
  "top_topics": ["topic1", "topic2", "topic3", "topic4", "topic5"],
  "collective_insight": "<3-4 sentence summary of all opinions>",
  "dominant_emotion": "<single word>",
  "individual": [
    ${opinions.map((_, i) => `{"index": ${i}, "sentiment": "Positive|Negative|Neutral", "score": 0}`).join(",\n    ")}
  ]
}

Opinions:
${opinions.map((o, i) => `${i + 1}. "${o}"`).join("\n")}`;

  try {
    const raw = await callAI([{ role: "user", content: prompt }], 0.3);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const result = JSON.parse(jsonMatch[0]);
    res.json({ success: true, result });
  } catch (err) {
    console.error("Bulk error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));