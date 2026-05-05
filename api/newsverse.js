const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a biblical scholar. Analyze the news item and return ONLY raw JSON. Structure:
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
Rules:
- 3-5 verses max.
- Use NIV translation.
- relevance_percent is 0-100.
- jesus_lens is how Jesus would respond to this news situation.
- If only a headline or short summary was available, clearly state that the reflection is limited and based on available headline/summary information.
- Do not pretend the full article was read if the provided content says it was based on headline or URL fallback.`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

function cleanText(value, maxLength = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeNewsVerse(data) {
  const verses = Array.isArray(data.verses) ? data.verses.slice(0, 5) : [];

  data.article_summary = String(data.article_summary || '');
  data.exegesis = String(data.exegesis || '');
  data.jesus_lens = String(data.jesus_lens || '');
  data.overall_theme = String(data.overall_theme || '');

  data.verses = verses.map((verse) => ({
    reference: String(verse.reference || ''),
    text: String(verse.text || ''),
    relevance_percent: Math.min(100, Math.max(0, Number(verse.relevance_percent) || 0)),
    relevance_reason: String(verse.relevance_reason || '')
  }));

  data.prayer_points = Array.isArray(data.prayer_points)
    ? data.prayer_points.slice(0, 3).map(String)
    : [];

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

    throw new Error('The AI reflection engine could not analyze this news item right now. Please try again.');
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) {
    throw new Error('The AI reflection engine returned an empty response.');
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
    const {
      title = '',
      url = '',
      sourceUrl = '',
      text = '',
      articleText = '',
      summaryBasis = 'headline_from_url'
    } = req.body || {};

    const contentToAnalyze = cleanText(articleText || text, 4000);
    const finalTitle = cleanText(title, 300);
    const finalUrl = sourceUrl || url || 'Not provided';

    if (!contentToAnalyze && !finalTitle) {
      return res.status(400).json({
        error: 'Article text, headline, or summary is required before analysis.'
      });
    }

    const basisLabel = summaryBasis === 'full_article'
      ? 'full article text'
      : summaryBasis === 'headline_and_description'
        ? 'headline and available page summary'
        : 'headline extracted from the URL';

    const userPrompt = `Analyze this news item using the ${basisLabel}.

Important:
- If this is based only on a headline or short page summary, clearly say that the reflection is limited.
- Do not pretend you read the full article if only a headline or summary was available.
- Keep the response helpful, biblical, careful, and not sensational.

Title:
${finalTitle || 'Untitled news item'}

Source URL:
${finalUrl}

Content:
${contentToAnalyze || finalTitle}`;

    const analysis = await callGemini(userPrompt);
    return res.status(200).json(analysis);
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to analyze this news item right now.'
    });
  }
};
