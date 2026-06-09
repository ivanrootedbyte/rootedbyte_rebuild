const SYSTEM_PROMPT = `You are a warm, grounded reflection guide for RootedByte's Signal tool.

Signal helps people pause before reacting to posts, headlines, reels, trends, threads, and news. Your role is to help the user notice what the content may be doing to their thinking, emotions, assumptions, attention, and response.

All moral and spiritual reasoning must be grounded only in the Bible, staying consistent with truth reflected in NIV, NASB, and GNB wording. The biblical foundation should remain strong, but the wording should stay natural, calm, and accessible for people who may or may not identify as Christian.

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

FOUNDATION RULES:
- Ground all moral and spiritual insight only in biblical truth.
- Do not rely on vague spirituality, political ideology, denominational assumptions, or extra-biblical claims.
- Do not fabricate Bible verses, references, or quotations.
- Bible truth is the foundation, but the response should not sound like a sermon.

STYLE RULES:
- Keep the tone warm, grounded, practical, emotionally intelligent, and never condemning.
- Write for ages 14+ in language relatable to Gen Z through millennials.
- Do not sound churchy, preachy, sensational, political, fear-driven, or vague.
- Do not assume the user is Christian.
- Do not pressure the user to believe something.
- Avoid generic spiritual language, generic therapy language, and generic church language.
- Use the word "God" only when it genuinely adds truthful clarity, not by default.
- Make the output feel like a calm premium reflection app, not a sermon.

FIELD RULES:
- In "verses", provide 3 to 5 short grounding points that are clearly rooted in biblical truth, but expressed naturally unless a direct reference is genuinely necessary.
- Use labels like "Grounding Point 1" unless a direct reference is genuinely helpful.
- In "verses.text", avoid long direct quotations. Keep them short, natural, and calm.
- "article_summary" must be 2 to 4 sentences max.
- "thinking_impact" must be 2 to 4 sentences max.
- "truth_check" must be 2 to 4 sentences max.
- "exegesis" must be 2 to 4 sentences max.
- "jesus_lens" must be 1 to 3 sentences max and should read more like "A grounded response..." than a sermon.
- "prayer_points" should actually function like reflection steps or response steps, not necessarily prayer.
- emotional_temperature_score must be 0 to 100.
- Keep every field concise and UI-ready.

DISCERNMENT RULES:
- If only a headline, short post, or URL fallback was available, clearly say the reflection is limited and based only on available information.
- Do not pretend the full article or post was read if only a headline, pasted text, or URL was provided.
- Help the user notice what the content may be training in attention, fear, anger, comparison, outrage, pride, despair, compassion, wisdom, or response.
- Do not flatten the analysis into "be careful." Identify what the content specifically reinforces, normalizes, distorts, provokes, excuses, or strengthens.
- Be truthful about manipulation, panic, confusion, moral laziness, false urgency, or emotional bait when present.
- Also be truthful when content strengthens compassion, honesty, justice, steadiness, humility, patience, or courage.
- Keep the response careful, concrete, and grounded.`;

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

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }

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

function extractModelText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];

    const joined = parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();

    if (joined) {
      return joined;
    }
  }

  return '';
}

function buildFallbackSignal(contentType, title, sourceMode) {
  return {
    article_summary: `This ${contentType} may be shaping perception quickly, but the available information is limited.`,
    thinking_impact:
      'Fast content can amplify reaction, flatten nuance, and push you toward quick assumptions before careful understanding.',
    emotional_temperature_score: 58,
    truth_check:
      'Pause before reacting. Ask what is verified, what is assumed, and what this content is strengthening in your attention, emotion, and response.',
    verses: [
      {
        reference: 'Grounding Point 1',
        text: 'Slowing down protects clarity when strong emotion is rising.',
        relevance_percent: 88,
        relevance_reason: 'This helps the user resist impulsive reaction.',
        application: 'Wait, breathe, and separate fact from feeling before responding.'
      },
      {
        reference: 'Grounding Point 2',
        text: 'Wisdom pays attention to tone, motive, and truth, not just urgency.',
        relevance_percent: 84,
        relevance_reason: 'This helps the user notice how content may be shaping perspective.',
        application: 'Ask what this content is training you to admire, fear, excuse, or repeat.'
      },
      {
        reference: 'Grounding Point 3',
        text: 'A grounded response values truth, restraint, and compassion together.',
        relevance_percent: 82,
        relevance_reason: 'This keeps the user from swinging between panic and indifference.',
        application: 'Choose a response that is both honest and steady.'
      }
    ],
    exegesis:
      'Quick content often bypasses thoughtful reflection. Clarity grows when you slow down enough to test what is actually true and what response is worth carrying forward.',
    jesus_lens:
      'A grounded response would slow the moment down, refuse panic, and move toward clarity, honesty, and wise restraint.',
    prayer_points: [
      'What is verified here, and what am I assuming?',
      'What is this shaping in my emotions and mindset right now?',
      'What would a wise, steady response look like here?'
    ],
    overall_theme: title || 'Signal reflection',
    source_mode: sourceMode || 'headline_only'
  };
}

function normalizeNewsVerse(data, fallback) {
  const result = data && typeof data === 'object' ? data : {};

   result.article_summary = cleanText(
    result.article_summary || fallback.article_summary,
    2000
  );

  result.thinking_impact = cleanText(
    result.thinking_impact || fallback.thinking_impact,
    2000
  );

  result.truth_check = cleanText(
    result.truth_check || fallback.truth_check,
    2000
  );

  result.exegesis = cleanText(
    result.exegesis || fallback.exegesis,
    2000
  );

  result.jesus_lens = cleanText(
    result.jesus_lens || fallback.jesus_lens,
    1200
  );

  result.overall_theme = cleanText(
    result.overall_theme || fallback.overall_theme,
    240
  );

  result.source_mode = String(result.source_mode || fallback.source_mode || '');

  result.emotional_temperature_score = clampPercent(
    result.emotional_temperature_score
  );

  const anchors = Array.isArray(result.verses)
    ? result.verses.slice(0, 5)
    : fallback.verses;

  result.verses = anchors.map((anchor, index) => ({
    reference: shortenText(anchor.reference, `Grounding Point ${index + 1}`, 40),
    text: shortenText(anchor.text, '', 180),
    relevance_percent: clampPercent(anchor.relevance_percent),
    relevance_reason: shortenText(anchor.relevance_reason, '', 140),
    application: shortenText(anchor.application, '', 160)
  }));

  result.prayer_points = Array.isArray(result.prayer_points)
    ? result.prayer_points.slice(0, 3).map((item) => shortenText(item, '', 120))
    : fallback.prayer_points;

  if (!result.verses.length) {
    result.verses = fallback.verses;
  }

  if (!result.prayer_points.length) {
    result.prayer_points = fallback.prayer_points;
  }

  return result;
}

async function callGemini(userPrompt, fallback) {
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
    return fallback;
  }

  const raw = extractModelText(data);

  if (!raw) {
    return fallback;
  }

  try {
    return normalizeNewsVerse(safeParse(raw), fallback);
  } catch {
    return fallback;
  }
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

    const fallback = buildFallbackSignal(newsType, title, sourceMode);

    const userPrompt = `Analyze this ${newsType} using the ${basisLabel}.

Important:
- If this is based only on a headline, short post, public link preview, or URL fallback, clearly say the Signal check is limited.
- Do not pretend you read the full article or post if only a headline, short text, or URL was available.
- Help the user pause before reacting.
- Focus on what this content may be doing to attention, fear, anger, comparison, assumptions, compassion, truth, and response.
- Ground moral and spiritual insight only in biblical truth, while keeping the wording natural and readable for both Christians and non-Christians.
- Keep the response careful, grounded, practical, specific, and not sensational.
- Do not sound vague, preachy, or sermon-like.
- Prefer phrases like "A grounded response..." instead of overtly religious wording.
- For truth_check and exegesis, identify what the content specifically reinforces, normalizes, distorts, provokes, excuses, or strengthens.
- Keep every field concise and UI-ready.

Content type:
${newsType}

Title or detected headline:
${title || 'Untitled item'}

Source URL:
${sourceUrl || 'Not provided'}

Available content:
${contentToAnalyze}`;

    const analysis = await callGemini(userPrompt, fallback);

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
