const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SONG_DIVEIN_SYSTEM_PROMPT = `You are Song DiveIn, a careful worship song research and musician preparation assistant.
Return ONLY raw JSON with no markdown, no code fences, and no explanation text.

Use Google Search grounding when available to research public sources for:
- song identity
- BPM and key
- general song meaning
- useful search queries for lyrics, chords, and instrument tutorials

Structure:
{
  "song": "",
  "artist": "",
  "bpm": 0,
  "key": "",
  "metadata_confidence": "",
  "song_meaning": "",
  "lyrics_search_query": "",
  "chord_search_query": "",
  "tutorial_search_query": "",
  "source_links": [],
  "faith_lens": "",
  "arrangement_feel": "",
  "listening_guide": "",
  "rehearsal_prep": "",
  "spiritual_reflection": "",
  "instrument_guidance": ""
}

Rules:
- Do not include or quote full copyrighted lyrics.
- Do not include chord charts.
- Do not provide exact lyrics, chord, or tutorial URLs.
- Provide search queries instead.
- lyrics_search_query should search for the exact song lyrics.
- chord_search_query should search for the exact song chords or tabs.
- tutorial_search_query should search for the exact song tutorial for the selected instrument.
- Search queries should include the song title, artist, and selected instrument when known.
- song_meaning should be concise and written in original wording based on public context when available.
- If public meaning sources are not available, infer carefully and say it is an interpretation.
- metadata_confidence must be "high", "medium", or "low".
- source_links must contain up to 3 public URLs used for research.
- Do not invent chords, BPM, key, timestamps, arrangement details, instrument layers, or live worship moments.
- If something is unavailable, say "Unable to verify", "Estimated", or "Not detected".
- Do not use the heading or wording "Theology".
- Use "Faith Lens" style language instead.
- Keep all preparation guidance concise, worship-aware, Scripture-connected, practical, and musician-focused.
- Avoid denominational bias.
- Avoid generic phrases like "This song is emotional" or "This song is uplifting".
- The selected instrument should shape instrument_guidance only.
- Do not provide guitar gear, amp, pedal, cab, preset, EQ, or tone settings.`;

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
    .replace(/\s*\(Official\s*Audio\)\s*/gi, ' ')
    .replace(/\s*\[Official\s*Audio\]\s*/gi, ' ')
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
    // Continue to fallback below.
  }
// Backend fallback: reads the YouTube page title if oEmbed does not return a title.
// Do not replace this with the Song DiveIn submit fetch.
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

  const groundingLinks =
    data?.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk) => chunk?.web?.uri)
      ?.filter(Boolean) || [];

  parsed.source_links = [...new Set([...modelLinks, ...groundingLinks])]
    .filter((url) => /^https?:\/\//i.test(String(url || '')))
    .slice(0, 3);

  return parsed;
}

async function callGemini(userPrompt) {
  if (!process.env.GEMINI_KEY) {
    throw new Error('GEMINI_KEY is not configured.');
  }

  const body = {
    system_instruction: {
      parts: [{ text: SONG_DIVEIN_SYSTEM_PROMPT }]
    },
    contents: [
      {
        parts: [{ text: userPrompt }]
      }
    ],
    tools: [{ google_search: {} }]
  };

  const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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

  if (!raw) {
    throw new Error('Gemini returned an empty response.');
  }

  return normalizeSourceLinks(safeParse(raw), data);
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeSongDiveInData(data, instrument) {
  const bpm = Number(data.bpm);

  data.bpm = Number.isFinite(bpm)
    ? Math.min(260, Math.max(40, Math.round(bpm)))
    : 0;

  data.song = String(data.song || '');
  data.artist = String(data.artist || '');

  data.key =
    typeof data.key === 'string' && data.key.trim()
      ? data.key.trim()
      : 'Unable to verify';

  data.metadata_confidence =
    typeof data.metadata_confidence === 'string' && data.metadata_confidence.trim()
      ? data.metadata_confidence.trim()
      : 'low';

  data.song_meaning = String(
    data.song_meaning ||
    data.meaning_summary ||
    'Song meaning is not available yet.'
  );

  const songArtist = `${data.song || ''} ${data.artist || ''}`.trim() || 'song';
  const selectedInstrument = String(instrument || '').trim() || 'instrument';

  data.lyrics_search_query = String(
    data.lyrics_search_query || `${songArtist} lyrics`
  ).trim();

  data.chord_search_query = String(
    data.chord_search_query || `${songArtist} chords`
  ).trim();

  data.tutorial_search_query = String(
    data.tutorial_search_query || `${songArtist} ${selectedInstrument} tutorial`
  ).trim();

  data.source_links = Array.isArray(data.source_links)
    ? data.source_links
        .filter((url) => /^https?:\/\//i.test(String(url || '')))
        .slice(0, 3)
    : [];

  data.faith_lens = String(data.faith_lens || 'Faith Lens is not available yet.');
  data.arrangement_feel = String(data.arrangement_feel || 'Song flow guidance is not available yet.');
  data.listening_guide = String(data.listening_guide || 'Listening guidance is not available yet.');
  data.rehearsal_prep = String(data.rehearsal_prep || 'Rehearsal preparation is not available yet.');
  data.spiritual_reflection = String(data.spiritual_reflection || 'Spiritual reflection is not available yet.');
  data.instrument_guidance = String(data.instrument_guidance || `${selectedInstrument} guidance is not available yet.`);

  return data;
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
 const { songInput, instrument } = req.body || {};

if (!songInput || !instrument) {
  return res.status(400).json({
    error: 'Song input and instrument are required.'
  });
}
    if (isSpotifyUrl(songInput)) {
      return res.status(400).json({
        error: 'Spotify links are not supported. Please type the song name and artist, or paste a YouTube link.'
      });
    }

    let resolvedSong = String(songInput).trim();

    if (isYouTubeUrl(resolvedSong)) {
      resolvedSong = await getYouTubeTitle(resolvedSong);
    }

   const diveIn = await callGemini(`Research and create a Song DiveIn worship preparation result.

Song input:
${resolvedSong}

Selected instrument:
${instrument}

Return:
- song identity
- BPM and key only when verifiable through public sources
- metadata confidence as "high", "medium", or "low"
- concise song meaning
- a search query for lyrics
- a search query for chords or tabs
- a search query for a tutorial for the selected instrument
- Faith Lens: Scripture connections, God-focus, and worship posture
- Song Flow: high-level emotional and congregational movement
- Listen Closely: dynamic lifts, repeated phrases, and places to leave space
- Rehearsal Moves: practical team preparation, transitions, cues, and restraint
- Before You Lead: short reflection, prayer prompt, and worship mindset
- Role Coaching: concise guidance for the selected instrument

Important:
- Do not quote full lyrics.
- Do not include chord charts.
- Do not provide exact lyrics, chord, or tutorial URLs.
- Provide search queries only for lyrics, chords, and tutorial resources.
- Do not create guitar tone settings, gear presets, amp settings, cab settings, pedal settings, or downloadable presets.
- Do not invent chords, BPM, key, timestamps, arrangement details, instrument layers, or live worship moments.
- If a value cannot be verified, say "Unable to verify", "Estimated", or "Not detected".
- Keep the language worship-aware, practical, concise, and modern.
- Avoid denominational bias.
- Do not use the heading or wording "Theology".`);

  
    return res.status(200).json(normalizeSongDiveInData(diveIn, instrument));
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to build that Song DiveIn result right now.'
    });
  }
};
