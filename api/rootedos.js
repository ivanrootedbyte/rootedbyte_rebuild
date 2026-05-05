const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

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
  "encouragement": "",
  "key_verse": { "reference": "", "text": "" }
}
Rules: spiritual_health_score 0-100, 3-5 areas max, urgency is one of "immediate" / "this week" / "this month", warm tone never condemning, all recommendations reference Scripture, NIV translation.`;

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
    throw new Error('Gemini could not create a growth plan right now.');
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) {
    throw new Error('Gemini returned an empty response.');
  }

  return normalizeResult(safeParse(raw));
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
    const { answers } = req.body || {};
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'All eight assessment answers are required.' });
    }
  
  const requiredKeys = ['stressDefault', 'scriptureRhythm', 'scrollAftereffect', 'pressureVoice', 'safeConversation', 'identitySource', 'purposeClarity', 'generosityPractice'];
    const missing = requiredKeys.filter((key) => answers[key] === undefined || answers[key] === null || answers[key] === '');
    if (missing.length) {
      return res.status(400).json({ error: 'Please complete every assessment question.' });
    }

    const userPrompt = `Create a personalized Christian growth plan from these answers:\n1. Daily prayer minutes: ${answers.prayerMinutes}\n2. Bible reading times per week: ${answers.bibleTimes}\n3. Daily social media hours: ${answers.socialHours}\n4. Attends church regularly: ${answers.churchAttendance}\n5. Feels spiritually dry or disconnected lately: ${answers.spirituallyDry}\n6. Closest friendships are faith-rooted: ${answers.faithFriendships}\n7. Feels clarity and purpose in calling: ${answers.callingClarity}\n8. Tithes or gives regularly: ${answers.givingRegularly}`;

    const plan = await callGemini(userPrompt);
    return res.status(200).json(plan);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to create the RootedOS plan right now.' });
  }
};
