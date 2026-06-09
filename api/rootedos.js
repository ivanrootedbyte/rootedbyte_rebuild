const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a warm, truth-rooted reflection guide for RootedByte's Inner Work tool.

All moral and spiritual reasoning must be grounded only in the Bible, staying consistent with truth reflected in NIV, NASB, and GNB wording. The biblical foundation should remain strong, but the wording should stay natural, calm, clear, and accessible for people who may or may not identify as Christian.

Return ONLY raw JSON with no markdown, no code fences. Structure:
{
  "spiritual_health_score": 0,
  "summary": "",
  "areas": [
    { "area": "", "current_state": "", "recommendation": "", "scripture": "", "action_step": "", "urgency": "" }
  ],
  "daily_plan": {
    "prayer_minutes": 0,
    "bible_reading_minutes": 0,
    "social_media_limit_minutes": 0,
    "fasting_recommendation": "",
    "community_action": ""
  },
  "reflection_verses": [
    { "reference": "", "text": "", "reflection_prompt": "" }
  ],
  "encouragement": ""
}

FOUNDATION RULES:
- Ground all moral and spiritual insight only in biblical truth.
- Do not rely on vague spirituality, denominational assumptions, or extra-biblical claims.
- Do not fabricate Bible verses, references, or quotations.
- Bible truth is the foundation, but the response should not sound like a sermon.

STYLE RULES:
- Keep the tone warm, practical, honest, emotionally intelligent, and never condemning.
- Write for ages 14+ in language relatable to Gen Z through millennials.
- Avoid churchy, preachy, overly religious, clinical, shame-based, or vague wording.
- Do not assume the user is Christian.
- Do not pressure the user to believe something.
- Avoid generic spiritual language, generic therapy language, and generic church language.
- Use the word "God" only when it genuinely adds truthful clarity, not by default.
- Make the output feel like a calm, premium reflection app, not a sermon.

CONTENT RULES:
- spiritual_health_score must be 0-100.
- Include 3-5 areas max.
- urgency must be one of "immediate" / "this week" / "this month".
- Avoid direct Bible verse references unless the field specifically asks for them.
- In the "scripture" field, do not quote a verse reference by default. Summarize the biblical truth behind the recommendation in plain language.
- In "reflection_verses", provide exactly 3 short truth anchors clearly rooted in biblical truth and expressed in natural language.
- Use the "reference" field only if clearly helpful; otherwise use labels like "Truth Anchor 1", "Truth Anchor 2", "Truth Anchor 3".
- In "reflection_verses.text", do not use long direct Bible quotations.
- Keep all recommendations rooted in truth, peace, wisdom, humility, self-control, courage, forgiveness, responsibility, honesty, and hope.

DISCERNMENT RULES:
- Name what is actually shaping the person: fear, comparison, avoidance, self-protection, numbness, pride, pressure, confusion, isolation, distraction, or hopelessness when present.
- Also name what is still healthy or hopeful when present: honesty, courage, hunger for truth, tenderness, humility, resilience, or desire to grow.
- Do not flatten the output into generic encouragement.
- Each recommendation should identify something concrete that needs attention and one concrete step forward.`;

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

function clampScore(value) {
  const score = Number(value);

  return Number.isFinite(score)
    ? Math.min(100, Math.max(0, Math.round(score)))
    : 0;
}

function normalizeUrgency(value) {
  const urgency = String(value || '').toLowerCase().trim();

  if (['immediate', 'this week', 'this month'].includes(urgency)) {
    return urgency;
  }

  return 'this week';
}

function normalizeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.round(number)
    : 0;
}

function cleanText(value, maxLength = 2000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeResult(data) {
  const result = data && typeof data === 'object' ? data : {};

  result.spiritual_health_score = clampScore(result.spiritual_health_score);

  result.areas = Array.isArray(result.areas)
  ? result.areas.slice(0, 5).map((area) => ({
      area: cleanText(area.area, 80),
      current_state: cleanText(area.current_state, 500),
      recommendation: cleanText(area.recommendation, 700),
      scripture: cleanText(area.scripture, 320),
      action_step: cleanText(area.action_step, 320),
      urgency: normalizeUrgency(area.urgency)
    }))
  : [];

  const plan =
    result.daily_plan && typeof result.daily_plan === 'object'
      ? result.daily_plan
      : {};

  result.daily_plan = {
  prayer_minutes: normalizeNumber(plan.prayer_minutes),
  bible_reading_minutes: normalizeNumber(plan.bible_reading_minutes),
  social_media_limit_minutes: normalizeNumber(plan.social_media_limit_minutes),
  fasting_recommendation: cleanText(plan.fasting_recommendation, 240),
  community_action: cleanText(plan.community_action, 240)
};

  result.reflection_verses = Array.isArray(result.reflection_verses)
  ? result.reflection_verses.slice(0, 3).map((verse, index) => ({
      reference: cleanText(verse.reference || `Truth Anchor ${index + 1}`, 60),
      text: cleanText(verse.text, 220),
      reflection_prompt: cleanText(verse.reflection_prompt, 220)
    }))
  : [];

  while (result.reflection_verses.length < 3) {
    const nextNumber = result.reflection_verses.length + 1;

    result.reflection_verses.push({
      reference: `Truth Anchor ${nextNumber}`,
      text: '',
      reflection_prompt: ''
    });
  }

  result.summary = cleanText(result.summary, 1200);
result.encouragement = cleanText(result.encouragement, 500);

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

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
        'The Inner Work engine could not create a reflection right now. Please try again.'
    );
  }

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) {
    throw new Error('The Inner Work engine returned an empty response.');
  }

  return normalizeResult(safeParse(raw));
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
    const { answers } = req.body || {};

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        error: 'All eight Inner Work assessment answers are required.'
      });
    }

    const requiredKeys = [
      'stressDefault',
      'scriptureRhythm',
      'scrollAftereffect',
      'pressureVoice',
      'safeConversation',
      'identitySource',
      'purposeClarity',
      'generosityPractice'
    ];

    const missing = requiredKeys.filter(
      (key) =>
        answers[key] === undefined ||
        answers[key] === null ||
        String(answers[key]).trim() === ''
    );

    if (missing.length) {
      return res.status(400).json({
        error: 'Please complete every assessment question.'
      });
    }

    const userPrompt = `Create a personalized Inner Work reflection for someone based on these answers.

The reflection should be grounded only in biblical truth, but written in natural, accessible language for someone who may simply want to be rooted in truth.

Assessment answers:

1. When life feels loud, stressful, or lonely, they usually reach for:
${answers.stressDefault}

2. Their current rhythm for grounding themselves in truth, wisdom, or Scripture:
${answers.scriptureRhythm}

3. After scrolling, streaming, or short videos, they usually feel:
${answers.scrollAftereffect}

4. The pressure that feels loudest lately:
${answers.pressureVoice}

5. When something is heavy, they could honestly talk to:
${answers.safeConversation}

6. What most often shapes how they see themselves:
${answers.identitySource}

7. When thinking about the future, their heart feels:
${answers.purposeClarity}

8. How often they use time, money, attention, or influence to bless someone else:
${answers.generosityPractice}

Output style:
- Warm, practical, reflective, and never condemning.
- Accessible to non-Christians and people who simply want to be rooted in truth.
- Ground all insight only in biblical truth consistent with NIV, NASB, and GNB wording, but do not make the output feel like a sermon.
- Avoid direct Bible verse references unless genuinely needed.
- Prefer plain-language truth anchors over quoted verses.
- Be specific about what is shaping the person internally, and do not drift into vague encouragement.
- Make it useful for ages 14+ and relatable to Gen Z through millennials.
- Keep the product name as Inner Work, not RootedOS.`;

    const plan = await callGemini(userPrompt);

    return res.status(200).json(plan);
  } catch (error) {
    return res.status(500).json({
      error:
        error.message ||
        'Unable to create the Inner Work reflection right now.'
    });
  }
};
