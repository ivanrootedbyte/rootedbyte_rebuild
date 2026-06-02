const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a warm, truth-rooted reflection guide for RootedByte's quick Inner Work tool.

The user has selected one focus area and typed a short honest note. Create a short, calm, practical reflection that feels like a premium reflection app.

Your wisdom is grounded in the moral and spiritual truth of the Bible, especially the kind of truth expressed in NIV, NASB, and KJV wording, but your output should be accessible to people who may not identify as Christian.

Return ONLY raw JSON with no markdown, no code fences. Structure:
{
  "hearing": "",
  "deeper_perspective": "",
  "one_step": "",
  "reflection_prompt": "",
  "encouragement": ""
}

Content rules:
- Write for ages 14+ in language relatable to Gen Z through millennials.
- Do not sound churchy, preachy, clinical, or shame-based.
- Do not assume the user is Christian.
- Do not quote Bible verses or include Bible references.
- Express Bible-rooted truth naturally as wisdom, peace, humility, honesty, courage, self-control, love, patience, forgiveness, and hope.
- Keep each field concise: 2-4 sentences max.
- "hearing" should gently summarize what the user seems to be carrying.
- "deeper_perspective" should reframe the issue with truth and wisdom.
- "one_step" should give one practical action the user can take today.
- "reflection_prompt" should give one thoughtful prompt they can sit with or journal about.
- "encouragement" should be short, grounding, and hopeful.
- Avoid overpromising, diagnosing, or giving professional advice.
- If the user mentions danger, self-harm, abuse, or emergency risk, encourage them to seek immediate support from trusted people or local emergency services.`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeParse(raw) {
  const text = String(raw || '').trim();

  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }

    return JSON.parse(cleaned);
  }
}

function cleanText(value, maxLength = 1200) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeQuickReflection(data) {
  const result = data && typeof data === 'object' ? data : {};

  return {
    hearing: String(result.hearing || '').trim(),
    deeper_perspective: String(result.deeper_perspective || '').trim(),
    one_step: String(result.one_step || '').trim(),
    reflection_prompt: String(result.reflection_prompt || '').trim(),
    encouragement: String(result.encouragement || '').trim()
  };
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
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ]
    })
  });

  const responseBody = await response.text().catch(() => '');

  if (!response.ok) {
    if (response.status === 503 || /high demand|overloaded|try again later/i.test(responseBody)) {
      throw new Error('The Inner Work quick reflection engine is busy right now. Please try again in a minute.');
    }

    if (response.status === 429 || /quota|rate limit/i.test(responseBody)) {
      throw new Error('The Inner Work quick reflection engine is temporarily limited. Please try again later.');
    }

    throw new Error('Inner Work could not create a quick reflection right now. Please try again.');
  }

  let data = {};

  try {
    data = JSON.parse(responseBody);
  } catch {
    throw new Error('Inner Work returned an unreadable response.');
  }

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) {
    throw new Error('Inner Work returned an empty response.');
  }

  return normalizeQuickReflection(safeParse(raw));
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
    const { focus = '', note = '' } = req.body || {};

    const cleanFocus = cleanText(focus, 80);
    const cleanNote = cleanText(note, 1200);

    if (!cleanFocus) {
      return res.status(400).json({
        error: 'Choose what feels loudest first.'
      });
    }

    if (!cleanNote) {
      return res.status(400).json({
        error: 'Write one honest sentence before getting insight.'
      });
    }

    const userPrompt = `Create a quick Inner Work reflection.

Focus area:
${cleanFocus}

User note:
${cleanNote}

Output style:
- Make it feel like a calm reflection card.
- Use headings only through the JSON keys, not inside the field text.
- Be specific to the user's note.
- Keep it honest, grounded, practical, and hopeful.
- Avoid religious jargon.
- Avoid direct Bible references.
- Do not diagnose the user.
- Do not make the response too long.`;

    const reflection = await callGemini(userPrompt);

    return res.status(200).json({
      app_type: 'inner_work',
      focus: cleanFocus,
      note: cleanNote,
      ...reflection
    });
  } catch (error) {
    return res.status(500).json({
      error:
        error.message ||
        'Unable to create a quick Inner Work reflection right now.'
    });
  }
};
