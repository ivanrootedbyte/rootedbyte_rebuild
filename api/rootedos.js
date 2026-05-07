const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a compassionate Christian life coach. Based on the user's answers, return ONLY raw JSON with no markdown, no code fences. Structure:
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
Rules:
- spiritual_health_score 0-100.
- 3-5 areas max.
- urgency is one of "immediate" / "this week" / "this month".
- reflection_verses must contain exactly 3 verses, NIV translation.
- Warm tone, never condemning.
- This is for anyone, not only teenagers.
- All recommendations should reference Scripture where relevant.`;

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

function normalizeResult(data) {
  const score = Number(data.spiritual_health_score);
  data.spiritual_health_score = Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 0;

  data.areas = Array.isArray(data.areas) ? data.areas.slice(0, 5).map((area) => ({
    area: String(area.area || ''),
    current_state: String(area.current_state || ''),
    recommendation: String(area.recommendation || ''),
    scripture: String(area.scripture || ''),
    action_step: String(area.action_step || ''),
    urgency: ['immediate', 'this week', 'this month'].includes(String(area.urgency || '').toLowerCase()) ? String(area.urgency).toLowerCase() : 'this week'
  })) : [];

  data.daily_plan = data.daily_plan && typeof data.daily_plan === 'object' ? data.daily_plan : {};

  data.reflection_verses = Array.isArray(data.reflection_verses) ? data.reflection_verses.slice(0, 3).map((verse) => ({
    reference: String(verse.reference || ''),
    text: String(verse.text || ''),
    reflection_prompt: String(verse.reflection_prompt || '')
  })) : [];

  data.summary = String(data.summary || '');
  data.encouragement = String(data.encouragement || '');

  return data;
}

async function callGemini(userPrompt) {
  if (!process.env.GEMINI_KEY) throw new Error('GEMINI_KEY is not configured.');

  const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }]
    })
  });

  if (!response.ok) throw new Error('The AI growth engine could not create a growth plan right now. Please try again.');

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned an empty response.');

  return normalizeResult(safeParse(raw));
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST for this endpoint.' });

  try {
    const { answers } = req.body || {};
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'All eight assessment answers are required.' });

    const requiredKeys = ['stressDefault', 'scriptureRhythm', 'scrollAftereffect', 'pressureVoice', 'safeConversation', 'identitySource', 'purposeClarity', 'generosityPractice'];
    const missing = requiredKeys.filter((key) => answers[key] === undefined || answers[key] === null || answers[key] === '');
    if (missing.length) return res.status(400).json({ error: 'Please complete every assessment question.' });

    const userPrompt = `Create a personalized Christian growth plan for someone based on these reflection answers:

1. When life feels loud, stressful, or lonely, they usually reach for: ${answers.stressDefault}
2. Scripture rhythm in a normal week: ${answers.scriptureRhythm}
3. After scrolling, streaming, or short videos, they usually feel: ${answers.scrollAftereffect}
4. The pressure that feels loudest lately: ${answers.pressureVoice}
5. When something is heavy, they could honestly talk to: ${answers.safeConversation}
6. What most often shapes how they see themselves: ${answers.identitySource}
7. When thinking about the future, their heart feels: ${answers.purposeClarity}
8. How often they use time, money, attention, or influence to bless someone else: ${answers.generosityPractice}

Keep the tone warm, practical, reflective, Scripture-rooted, and never condemning. Make it useful for anyone, not just teenagers. Include exactly 3 NIV verses to reflect on.`;

    const plan = await callGemini(userPrompt);
    return res.status(200).json(plan);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to create the RootedOS plan right now.' });
  }
};
