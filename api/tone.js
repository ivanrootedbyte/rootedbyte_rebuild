const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SONG_DIVEIN_SYSTEM_PROMPT = `You are Song DiveIn, a careful music research and guitar tone assistant.
Return ONLY raw JSON with no markdown, no code fences, and no explanation text.

Use Google Search grounding when available to research public sources for:
- song identity
- BPM and key
- general song meaning
- one public lyrics source link
- one public chord source link
- one public guitar tutorial link

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
- Do not include chord charts.
- Return only ONE best lyrics_link, ONE best chord_link, and ONE best tutorial_link.
- Only return a URL if it appears to be directly for the requested song and artist.
- For lyrics_link, prefer a public external lyrics page clearly matching the exact song.
- For chord_link, prefer a real chord/tab page for the exact song, not a general search result.
- For tutorial_link, prefer a YouTube or guitar tutorial page clearly matching the exact song.
- Do not provide exact lyrics, chord, or tutorial URLs.
- Provide search queries instead.
- lyrics_search_query should search for the exact song lyrics.
- chord_search_query should search for the exact song chords or tabs.
- tutorial_search_query should search for the exact song guitar tutorial.
- Search queries should include the song title and artist when known.
- Do not include full lyrics.
- Do not include chord charts.
- Do not invent URLs.
- song_meaning should be concise and written in original wording based on public context when available.
- If public meaning sources are not available, infer carefully and say it is an interpretation.
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

  const url = String(item.url || '').trim();
  const isRealUrl = /^https?:\/\//i.test(url);
  const isGenericSearch = /google\.com\/search|bing\.com\/search|duckduckgo\.com|search\.yahoo\.com/i.test(url);

  const cleanedUrl = isRealUrl && !isGenericSearch ? url : '';

  return {
    label: String(item.label || item.source || fallbackLabel),
    source: String(item.source || ''),
    url: cleanedUrl,
    validated_for_song: Boolean(item.validated_for_song && cleanedUrl)
  };
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clampToneData(data) {
  const knobKeys = ['gain', 'bass', 'mid', 'treble', 'presence', 'reverb_mix', 'delay_mix'];

  knobKeys.forEach((key) => {
    data[key] = clampNumber(data[key], 0, 10, 0);
  });

  data.delay_time_ms = Math.round(clampNumber(data.delay_time_ms, 0, 800, 0));

  const bpm = Number(data.bpm);
  data.bpm = Number.isFinite(bpm)
    ? Math.min(260, Math.max(40, Math.round(bpm)))
    : 0;

  data.song = String(data.song || '');
  data.artist = String(data.artist || '');

  data.key =
    typeof data.key === 'string' && data.key.trim()
      ? data.key.trim()
      : 'Unknown';

  data.metadata_confidence =
    typeof data.metadata_confidence === 'string' && data.metadata_confidence.trim()
      ? data.metadata_confidence.trim()
      : 'low';

  data.song_meaning = String(
    data.song_meaning ||
    data.meaning_summary ||
    'Song meaning is not available yet.'
  );

const songArtist = `${data.song || ''} ${data.artist || ''}`.trim();

data.lyrics_search_query = String(
  data.lyrics_search_query || `${songArtist} lyrics`
).trim();

data.chord_search_query = String(
  data.chord_search_query || `${songArtist} chords`
).trim();

data.tutorial_search_query = String(
  data.tutorial_search_query || `${songArtist} guitar tutorial`
).trim();

  data.source_links = Array.isArray(data.source_links)
    ? data.source_links
        .filter((url) => /^https?:\/\//i.test(String(url || '')))
        .slice(0, 3)
    : [];

  data.amp_model = String(data.amp_model || 'Not available');
  data.cab = String(data.cab || 'Not available');
  data.notes = String(data.notes || '');

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
    const { songInput, gear } = req.body || {};

    if (!songInput || !gear) {
      return res.status(400).json({
        error: 'Song input and gear are required.'
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

    const diveIn = await callGemini(`Research and create a Song DiveIn result.

Song input:
${resolvedSong}

Selected guitar gear:
${gear}

Return:
- song identity
- BPM and key
- concise song meaning
- a search query for lyrics
- a search query for chords or tabs
- a search query for a guitar tutorial
- practical starting guitar tone settings for the selected gear

Important:
- Do not quote full lyrics.
- Do not include chord charts.`);

    return res.status(200).json(clampToneData(diveIn));
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to build that Song DiveIn result right now.'
    });
  }
};
