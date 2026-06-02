const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a warm, truth-rooted reflection guide for RootedByte's Signal tool.

Signal helps people pause before reacting to posts, headlines, reels, trends, threads, and news. Your role is to help the user notice what the content may be doing to their thinking, emotions, assumptions, attention, and response.

Your wisdom is grounded in the moral and spiritual truth of the Bible, especially the kind of truth expressed in NIV, NASB, and KJV wording, but your output should be accessible to people who may not identify as Christian.

Return ONLY raw JSON with no markdown, no code fences. Structure:
{
  "article_summary": "",
  "thinking_impact": "",
  "emotional_temperature_score": 0,
  "truth_check": "",
  "verses": [
    { "reference": "", "text": "", "relevance_percent": 0, "relevance_reason": "", "application": "" }
  ],
  "exegesis": "",
  "jesus_lens": "",
  "prayer_points": ["", "", ""],
  "overall_theme": "",
  "source_mode": ""
}

Content rules:
- Keep the tone warm, grounded, practical, and never condemning.
- Write for ages 14+ in language relatable to Gen Z through millennials.
- Do not sound churchy, preachy, sensational, political, or fear-driven.
- Do not assume the user is Christian.
- Do not pressure the user to believe something.
- Express biblical truth naturally as timeless truth, wisdom, discernment, humility, courage, peace, love, patience, self-control, justice, and hope.
- Avoid direct Bible verse references unless truly necessary.
- In "verses", provide 3-5 short truth anchors inspired by NIV/NASB/KJV biblical truth. Use labels like "Truth Anchor 1" unless a direct reference is genuinely helpful.
- In "verses.text", avoid long direct Bible quotations. Use natural, paraphrased, Bible-rooted truth.
- In "exegesis", explain the deeper truth principle in plain language. Do not make it academic.
- In "jesus_lens", do not write "Jesus would..." unless it naturally fits. Prefer a grounded response like: "A grounded response would be..."
- In "prayer_points", provide practical reflection steps. They can be quiet reflection, journaling prompts, relational repair, checking sources, slowing down, or choosing a wise response.
- emotional_temperature_score must be 0-100.
- If only a headline, short post, or URL fallback was available, clearly say the reflection is limited and based only on available information.
- Do not pretend the full article/post was read if only a headline, pasted text, or URL was provided.
- Make the output feel like a calm, premium reflection app, not a sermon.`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = String(raw || '')
      .replace(/```json|```/g, '')
      .trim();

    return JSON.parse(cleaned);
  }
}

function cleanText(value, maxLength = 4000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function clampPercent(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? Math.min(100, Math.max(0, Math.round(number)))
    : 0;
}

function getBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';

  return `${protocol}://${host}`;
}

function cleanUrlHeadline(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => part.replace(/\.[a-z0-9]+$/i, ''));

    let candidate = parts[parts.length - 1] || parsed.hostname;

    candidate = candidate
      .replace(/^article[-_]/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b[a-f0-9]{8,}\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!candidate || candidate.length < 8) {
      candidate = parsed.hostname.replace(/^www\./, '');
    }

    return candidate
      .split(' ')
      .map((word) => {
        if (/^(ai|us|uk|un|nato|nasa|cbc|ctv|cnn|bbc|nyt|ap)$/i.test(word)) {
          return word.toUpperCase();
        }

        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  } catch {
    return '';
  }
}

async function readArticleFromUrl(req, articleUrl) {
  if (!articleUrl) {
    return null;
  }

  try {
    const response = await fetch(`${getBaseUrl(req)}/api/readarticle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: articleUrl
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function normalizeNewsVerse(data) {
  const result = data && typeof data === 'object' ? data : {};

  result.article_summary = String(result.article_summary || '');
  result.thinking_impact = String(result.thinking_impact || '');
  result.truth_check = String(result.truth_check || '');
  result.exegesis = String(result.exegesis || '');
  result.jesus_lens = String(result.jesus_lens || '');
  result.overall_theme = String(result.overall_theme || '');
  result.source_mode = String(result.source_mode || '');

  result.emotional_temperature_score = clampPercent(
    result.emotional_temperature_score
  );

  const anchors = Array.isArray(result.verses)
    ? result.verses.slice(0, 5)
    : [];

  result.verses = anchors.map((anchor, index) => ({
    reference: String(anchor.reference || `Truth Anchor ${index + 1}`),
    text: String(anchor.text || ''),
    relevance_percent: clampPercent(anchor.relevance_percent),
    relevance_reason: String(anchor.relevance_reason || ''),
    application: String(anchor.application || '')
  }));

  result.prayer_points = Array.isArray(result.prayer_points)
    ? result.prayer_points.slice(0, 3).map(String)
    : [];

  return result;
}

async function callGemini(userPrompt) {
  if (!process.env.GEMINI_KEY) {
    throw new Error('GEMINI_KEY is not configured.');
  }

  const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          parts: [{ text: userPrompt }]
        }
      ]
    })
  });

  const responseBody = await response.text().catch(() => '');

  if (!response.ok) {
    if (response.status === 503 || /high demand|overloaded|try again later/i.test(responseBody)) {
      throw new Error('The Signal engine is busy right now. Please try again in a minute.');
    }

    if (response.status === 429 || /quota|rate limit/i.test(responseBody)) {
      throw new Error('The Signal engine is temporarily limited. Please try again later.');
    }

    throw new Error('Signal could not analyze this item right now. Please try again.');
  }

  let data = {};

  try {
    data = JSON.parse(responseBody);
  } catch {
    throw new Error('Signal returned an unreadable response.');
  }

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) {
    throw new Error('Signal returned an empty response.');
  }

  return normalizeNewsVerse(safeParse(raw));
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Use POST for this endpoint.'
    });
  }

  try {
    const body = req.body || {};

    const newsType = cleanText(body.newsType || body.contentType || 'post', 80);

    const articleUrl = cleanText(
      body.articleUrl || body.url || body.sourceUrl || '',
      1000
    );

    const pastedText = cleanText(
      body.headline ||
        body.postText ||
        body.threadText ||
        body.text ||
        body.articleText ||
        '',
      4000
    );

    let title = cleanText(body.title || '', 300);
    let sourceUrl = articleUrl;
    let contentToAnalyze = pastedText;
    let summaryBasis = cleanText(body.summaryBasis || '', 80);
    let sourceMode = 'pasted_text';

    if (articleUrl && !contentToAnalyze) {
      const articlePayload = await readArticleFromUrl(req, articleUrl);

      if (articlePayload) {
        title = cleanText(articlePayload.title || title, 300);
        sourceUrl = cleanText(articlePayload.sourceUrl || articleUrl, 1000);
        contentToAnalyze = cleanText(articlePayload.text || '', 4000);
        summaryBasis = cleanText(articlePayload.summaryBasis || '', 80);

        sourceMode =
          articlePayload.summaryBasis === 'full_article'
            ? 'full_article'
            : 'headline_only';
      }
    }

    if (!title && articleUrl) {
      title = cleanUrlHeadline(articleUrl);
    }

    if (!summaryBasis) {
      summaryBasis = contentToAnalyze && contentToAnalyze.length > 220
        ? 'pasted_content'
        : 'headline_or_short_text';
    }

    if (!sourceMode) {
      sourceMode = summaryBasis === 'full_article' ? 'full_article' : 'headline_only';
    }

    if (!contentToAnalyze && title) {
      contentToAnalyze = title;
      sourceMode = 'headline_only';
    }

    if (!contentToAnalyze && !title) {
      return res.status(400).json({
        error: 'Paste a link, headline, post, thread, or short summary before running Signal.'
      });
    }

    const basisLabel =
      summaryBasis === 'full_article'
        ? 'full article text'
        : summaryBasis === 'headline_and_description'
          ? 'headline and available page summary'
          : summaryBasis === 'pasted_content'
            ? 'pasted content'
            : 'headline, short text, or URL fallback';

    const userPrompt = `Analyze this ${newsType} using the ${basisLabel}.

Important:
- If this is based only on a headline, short post, public link preview, or URL fallback, clearly say that the Signal check is limited.
- Do not pretend you read the full article or post if only a headline, short text, or URL was available.
- Help the user pause before reacting.
- Focus on what this content may be doing to attention, fear, anger, comparison, assumptions, compassion, truth, and response.
- Keep the response careful, grounded, practical, and not sensational.
- Use Bible-rooted truth expressed naturally, without making the result feel like a sermon.
- Prefer phrases like "A grounded response..." or "A truth-rooted way to respond..." instead of overtly religious wording.

Content type:
${newsType}

Title or detected headline:
${title || 'Untitled item'}

Source URL:
${sourceUrl || 'Not provided'}

Available content:
${contentToAnalyze}`;

    const analysis = await callGemini(userPrompt);

    analysis.source_mode = analysis.source_mode || sourceMode;

    return res.status(200).json(analysis);
  } catch (error) {
    return res.status(500).json({
      error:
        error.message ||
        'Unable to run Signal right now.'
    });
  }
};
