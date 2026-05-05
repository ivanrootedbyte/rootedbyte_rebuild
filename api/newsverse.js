const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a biblical scholar. Analyze the news article and return ONLY raw JSON. Structure:
{
  "article_summary": "",
  "verses": [
    { "reference": "", "text": "", "relevance_percent": 0, "relevance_reason": "" }
  ],
  "exegesis": "",
  "jesus_lens": "",
  "prayer_points": ["", "", ""],
  "overall_theme": ""
}
Rules: 3-5 verses max, NIV translation, relevance_percent is 0-100,
jesus_lens is how Jesus would respond to this news situation.`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeNewsVerse(data) {
  const verses = Array.isArray(data.verses) ? data.verses.slice(0, 5) : [];
  data.verses = verses.map((verse) => ({
    reference: String(verse.reference || ''),
    text: String(verse.text || ''),
    relevance_percent: Math.min(100, Math.max(0, Number(verse.relevance_percent) || 0)),
    relevance_reason: String(verse.relevance_reason || '')
  }));
  data.prayer_points = Array.isArray(data.prayer_points) ? data.prayer_points.slice(0, 3).map(String) : [];
  return data;
}

async function callGemini(userPrompt) {
  if (!process.env.GEMINI_KEY) {
    throw new Error('GEMINI_KEY is not configured.');
  }

  const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }]
    })
  });

  if (!response.ok) {
  const errorText = await response.text().catch(() => '');

  if (response.status === 503 || /high demand|overloaded|try again later/i.test(errorText)) {
    throw new Error('The AI reflection engine is busy right now. Please try again in a minute.');
  }

  if (response.status === 429 || /quota|rate limit/i.test(errorText)) {
    throw new Error('The AI reflection engine is temporarily limited. Please try again later.');
  }

  throw new Error('The AI reflection engine could not analyze this article right now. Please try again.');
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) {
    throw new Error('Gemini returned an empty response.');
  }

  return normalizeNewsVerse(safeParse(raw));
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST for this endpoint.' });
  }

  try {
    const { title, url, text } = req.body || {};
    const articleText = cleanText(text, 4000);

    if (!articleText || articleText.length < 80) {
      return res.status(400).json({ error: 'Readable article text is required before analysis.' });
    }

    const userPrompt = `Article title: ${cleanText(title, 250)}\nArticle URL: ${cleanText(url, 500)}\nArticle text: ${articleText}`;
    const analysis = await callGemini(userPrompt);
    return res.status(200).json(analysis);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to analyze this article right now.' });
  }
};
