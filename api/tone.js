const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SONG_DIVEIN_SYSTEM_PROMPT = `You are Song DiveIn, a careful music research and guitar tone assistant.
Return ONLY raw JSON with no markdown, no code fences, and no explanation text.
Use Google Search grounding when available to research public sources for song identity, BPM, key, general meaning, chord source links, and lyric source links.
Structure:
{
  "song": "",
  "artist": "",
  "bpm": 0,
  "key": "",
  "metadata_confidence": "",
  "meaning_title": "",
  "meaning_summary": "",
  "meaning_basis": "",
  "chords_available": false,
  "chords_source_url": "",
  "chords_note": "",
  "lyrics_available": false,
  "lyrics_source_url": "",
  "lyrics_note": "",
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
- Do not include or quote full copyrighted lyrics.
- Do not include a full chord chart inside the JSON.
- For lyrics, provide a public lyrics source URL if available; otherwise set lyrics_available false and leave lyrics_source_url empty.
- For chords, provide a public chord source URL if available; otherwise set chords_available false and leave chords_source_url empty.
- The meaning_summary should explain the song's broad message, themes, and emotional/spiritual tone in original wording.
- If reliable public meaning sources are not available, infer carefully from commonly known lyric themes and set meaning_basis accordingly.
- metadata_confidence must be "high", "medium", or "low".
- source_links must contain up to 3 public URLs used for research.
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RootedByteBot/1.0; +https://rootedbyte.vercel.app)' }
    });
    if (oembedResponse.ok) {
      const oembedData = await oembedResponse.json();
      if (oembedData?.title) return cleanYouTubeTitle(oembedData.title);
    }
  } catch {
    // Fallback below.
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RootedByteBot/1.0; +https://rootedbyte.vercel.app)' }
  });

  if (!response.ok) throw new Error('Could not read that YouTube page. Please type the song name and artist instead.');
  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!titleMatch) throw new Error('Could not find the YouTube video title. Please type the song name and artist instead.');
  return cleanYouTubeTitle(titleMatch[1]);
}

function normalizeLinks(parsed, data) {
  const modelLinks = Array.isArray(parsed.source_links) ? parsed.source_links : [];
  const groundingLinks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((chunk) => chunk?.web?.uri)
    ?.filter(Boolean) || [];
  parsed.source_links = [...new Set([...modelLinks, ...groundingLinks])].slice(0, 3);
  return parsed;
}

async function callGemini(userPrompt) {
  if (!process.env.GEMINI_KEY) throw new Error('GEMINI_KEY is not configured.');

  const body = {
    system_instruction: { parts: [{ text: SONG_DIVEIN_SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    tools: [{ google_search: {} }]
  };

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
    throw new Error('The AI Engine could not create this Song DiveIn result right now. Please try again.');
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned an empty response.');
  return normalizeLinks(safeParse(raw), data);
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
  data.metadata_confidence = typeof data.metadata_confidence === 'string' && data.metadata_confidence.trim() ? data.metadata_confidence.trim() : 'low';
  data.chords_available = Boolean(data.chords_available && data.chords_source_url);
  data.lyrics_available = Boolean(data.lyrics_available && data.lyrics_source_url);
  data.chords_source_url = data.chords_available ? String(data.chords_source_url || '') : '';
  data.lyrics_source_url = data.lyrics_available ? String(data.lyrics_source_url || '') : '';
  data.source_links = Array.isArray(data.source_links) ? data.source_links.slice(0, 3) : [];
  data.meaning_summary = String(data.meaning_summary || 'No meaning summary was available.');
  data.meaning_title = String(data.meaning_title || 'Song meaning');
  data.notes = String(data.notes || '');
  return data;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST for this endpoint.' });

  try {
    const { songInput, gear } = req.body || {};
    if (!songInput || !gear) return res.status(400).json({ error: 'Song input and gear are required.' });
    if (isSpotifyUrl(songInput)) {
      return res.status(400).json({ error: 'Spotify links are not supported. Please type the song name and artist, or paste a YouTube link.' });
    }

    let resolvedSong = String(songInput).trim();
    if (isYouTubeUrl(resolvedSong)) resolvedSong = await getYouTubeTitle(resolvedSong);

    const diveIn = await callGemini(`Research and create a Song DiveIn result.

Song input:
${resolvedSong}

Selected guitar gear:
${gear}

Return song meaning, public chord source link if available, public lyrics source link if available, BPM/key, and practical starting guitar tone settings for the selected gear. Do not quote full lyrics and do not print a full chord chart.`);

    return res.status(200).json(clampToneData(diveIn));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to build that Song DiveIn result right now.' });
  }
};
