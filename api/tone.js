const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a guitar tone expert. When given a song and gear type, return ONLY raw JSON with no markdown, no code fences, no explanation text. Structure: { "song": "", "artist": "", "amp_model": "", "cab": "", "gain": 0, "bass": 0, "mid": 0, "treble": 0, "presence": 0, "reverb_mix": 0, "delay_time_ms": 0, "delay_mix": 0, "notes": "" }
All knob values 0-10. delay_time_ms is 0-800.`;

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

function extractSpotifyTrackId(value) {
  const match = String(value || '').match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/i);
  return match ? match[1] : null;
}

function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)/i.test(String(value || ''));
}

function cleanYouTubeTitle(title) {
  return String(title || '')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .replace(/\s*\(Official\s*(Music\s*)?Video\)\s*/gi, ' ')
    .replace(/\s*\[Official\s*(Music\s*)?Video\]\s*/gi, ' ')
    .replace(/\s*\(Lyrics?\)\s*/gi, ' ')
    .replace(/\s*\[Lyrics?\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getSpotifyTrack(trackId) {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify credentials are not configured.');
  }

  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`
    },
    body: 'grant_type=client_credentials'
  });

  if (!tokenResponse.ok) {
    throw new Error('Could not authenticate with Spotify.');
  }

  const tokenData = await tokenResponse.json();
  const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });

  if (!trackResponse.ok) {
    throw new Error('Could not read that Spotify track.');
  }

  const trackData = await trackResponse.json();
  const artists = Array.isArray(trackData.artists) ? trackData.artists.map((artist) => artist.name).join(', ') : '';
  return `${trackData.name} - ${artists}`.trim();
}

async function getYouTubeTitle(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RootedByteBot/1.0; +https://rootedbyte.vercel.app)'
    }
  });

  if (!response.ok) {
    throw new Error('Could not read that YouTube page.');
  }

  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!titleMatch) {
    throw new Error('Could not find the YouTube video title.');
  }

  return cleanYouTubeTitle(titleMatch[1]);
}

function clampToneData(data) {
  const knobKeys = ['gain', 'bass', 'mid', 'treble', 'presence', 'reverb_mix', 'delay_mix'];
  knobKeys.forEach((key) => {
    const value = Number(data[key]);
    data[key] = Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0;
  });
  const delay = Number(data.delay_time_ms);
  data.delay_time_ms = Number.isFinite(delay) ? Math.min(800, Math.max(0, Math.round(delay))) : 0;
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
    throw new Error('Gemini could not create a tone right now.');
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) {
    throw new Error('Gemini returned an empty response.');
  }

  return clampToneData(safeParse(raw));
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

    let resolvedSong = String(songInput).trim();
    const spotifyTrackId = extractSpotifyTrackId(resolvedSong);

    if (spotifyTrackId) {
      resolvedSong = await getSpotifyTrack(spotifyTrackId);
    } else if (isYouTubeUrl(resolvedSong)) {
      resolvedSong = await getYouTubeTitle(resolvedSong);
    }

    const userPrompt = `Song: ${resolvedSong}\nGear: ${gear}\nReturn a practical starting tone for this exact gear.`;
    const tone = await callGemini(userPrompt);
    return res.status(200).json(tone);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to build that tone right now.' });
  }
};
