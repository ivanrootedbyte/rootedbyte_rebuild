const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const METADATA_SYSTEM_PROMPT = `You are a music metadata research assistant.
Return ONLY raw JSON with no markdown, no code fences, no explanation text.
Use Google Search grounding to research the song's most likely title, artist, BPM, and musical key from public web sources.
Structure:
{
  "song": "",
  "artist": "",
  "bpm": 0,
  "key": "",
  "metadata_confidence": "",
  "bpm_source": "",
  "key_source": "",
  "source_links": []
}
Rules:
- BPM and key must be based only on the song title/artist, never on guitar gear.
- If multiple sources disagree, choose the most commonly supported result.
- metadata_confidence must be "high", "medium", or "low".
- source_links must contain up to 3 public URLs used for BPM/key research.
- If reliable BPM/key cannot be found, estimate but set metadata_confidence to "low".`;

const TONE_SYSTEM_PROMPT = `You are a guitar tone expert.
Return ONLY raw JSON with no markdown, no code fences, no explanation text.
Structure:
{
  "song": "",
  "artist": "",
  "bpm": 0,
  "key": "",
  "metadata_confidence": "",
  "bpm_source": "",
  "key_source": "",
  "source_links": [],
  "amp_model": "",
  "cab": "",
  "gain": 0,
  "bass": 0,
  "mid": 0,
  "treble": 0,
  "presence": 0,
  "reverb_mix": 0,
  "delay_time_ms": 0,
  "delay_mix": 0,
  "notes": ""
}
Rules:
- Do not change song, artist, BPM, key, metadata_confidence, bpm_source, key_source, or source_links.
- Gear affects only amp_model, cab, gain, bass, mid, treble, presence, reverb_mix, delay_time_ms, delay_mix, and notes.
- All knob values are 0-10.
- delay_time_ms is 0-800.`;

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

function isSpotifyUrl(value) {
  return /open\.spotify\.com\/track\//i.test(String(value || ''));
}

function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)/i.test(String(value || ''));
}

function cleanYouTubeTitle(title) {
  return String(title || '')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .replace(/\s*\|\s*YouTube\s*$/i, '')
    .replace(/\s*\(Official\s*(Music\s*)?Video\)\s*/gi, ' ')
    .replace(/\s*\[Official\s*(Music\s*)?Video\]\s*/gi, ' ')
    .replace(/\s*\(Official\s*Lyric\s*Video\)\s*/gi, ' ')
    .replace(/\s*\[Official\s*Lyric\s*Video\]\s*/gi, ' ')
    .replace(/\s*\(Lyrics?\)\s*/gi, ' ')
    .replace(/\s*\[Lyrics?\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getYouTubeTitle(url) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

  try {
    const oembedResponse = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RootedByteBot/1.0; +https://rootedbyte.vercel.app)'
      }
    });

    if (oembedResponse.ok) {
      const oembedData = await oembedResponse.json();
      if (oembedData?.title) {
        return cleanYouTubeTitle(oembedData.title);
      }
    }
  } catch {
    // Fallback below.
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RootedByteBot/1.0; +https://rootedbyte.vercel.app)'
    }
  });

  if (!response.ok) {
    throw new Error('Could not read that YouTube page. Please type the song name and artist instead.');
  }

  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  if (!titleMatch) {
    throw new Error('Could not find the YouTube video title. Please type the song name and artist instead.');
  }

  return cleanYouTubeTitle(titleMatch[1]);
}

function normalizeSourceLinks(parsed, data) {
  const modelLinks = Array.isArray(parsed.source_links) ? parsed.source_links : [];
  const groundingLinks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((chunk) => chunk?.web?.uri)
    ?.filter(Boolean) || [];

  const uniqueLinks = [...new Set([...modelLinks, ...groundingLinks])].slice(0, 3);
  parsed.source_links = uniqueLinks;
  return parsed;
}

async function callGemini({ systemPrompt, userPrompt, useSearch = false }) {
  if (!process.env.GEMINI_KEY) {
    throw new Error('GEMINI_KEY is not configured.');
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }]
  };

  if (useSearch) {
    body.tools = [{ google_search: {} }];
  }

  const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
  const errorText = await response.text().catch(() => '');

  if (response.status === 503 || /high demand|overloaded|try again later/i.test(errorText)) {
    throw new Error('The AI Engine is busy right now. Please try again in a minute.');
  }

  if (response.status === 429 || /quota|rate limit/i.test(errorText)) {
    throw new Error('The AI Engine is temporarily limited. Please try again later.');
  }

  throw new Error('The AI Engine could not create this tone right now. Please try again.');
}

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) {
    throw new Error('Gemini returned an empty response.');
  }

  return normalizeSourceLinks(safeParse(raw), data);
}

function clampToneData(data) {
  const knobKeys = ['gain', 'bass', 'mid', 'treble', 'presence', 'reverb_mix', 'delay_mix'];

  knobKeys.forEach((key) => {
    const value = Number(data[key]);
    data[key] = Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0;
  });

  const delay = Number(data.delay_time_ms);
  data.delay_time_ms = Number.isFinite(delay) ? Math.min(800, Math.max(0, Math.round(delay))) : 0;

  const bpm = Number(data.bpm);
  data.bpm = Number.isFinite(bpm) ? Math.min(260, Math.max(40, Math.round(bpm))) : 0;

  data.key = typeof data.key === 'string' && data.key.trim() ? data.key.trim() : 'Unknown';
  data.metadata_confidence = typeof data.metadata_confidence === 'string' && data.metadata_confidence.trim()
    ? data.metadata_confidence.trim()
    : 'low';

  data.source_links = Array.isArray(data.source_links) ? data.source_links.slice(0, 3) : [];

  return data;
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
    const { songInput, gear } = req.body || {};

    if (!songInput || !gear) {
      return res.status(400).json({ error: 'Song input and gear are required.' });
    }

    if (isSpotifyUrl(songInput)) {
      return res.status(400).json({
        error: 'Spotify lookup is unavailable in this version. Please type the song name and artist, or paste a YouTube link.'
      });
    }

    let resolvedSong = String(songInput).trim();

    if (isYouTubeUrl(resolvedSong)) {
      resolvedSong = await getYouTubeTitle(resolvedSong);
    }

    const metadata = await callGemini({
      systemPrompt: METADATA_SYSTEM_PROMPT,
      useSearch: true,
      userPrompt: `Research this song for BPM and key. Song input: ${resolvedSong}`
    });

    const tone = await callGemini({
      systemPrompt: TONE_SYSTEM_PROMPT,
      useSearch: false,
      userPrompt: `Use this locked song metadata:
${JSON.stringify(metadata, null, 2)}

Selected gear:
${gear}

Create practical starting guitar tone settings for this gear, but do not change the locked song metadata.`
    });

    return res.status(200).json(clampToneData(tone));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to build that tone right now.' });
  }
};
