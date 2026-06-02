const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SOUNDSENSE_SYSTEM_PROMPT = `You are SoundSense, a careful song reflection and musician preparation assistant for RootedByte.

SoundSense helps users understand a song's identity, emotional direction, meaning, musical preparation needs, and truth-rooted reflection without copying lyrics or providing copyrighted material.

Return ONLY raw JSON.
Do not use markdown.
Do not use code fences.
Do not add explanation text outside the JSON.

Use Google Search grounding when available to research public sources for:
- song identity
- BPM and key
- general song meaning
- useful search queries for lyrics, chords, and instrument tutorials

Return this exact JSON structure:
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
- Do not invent chords, BPM, key, timestamps, arrangement details, instrument layers, or live performance moments.
- If something is unavailable, say "Unable to verify", "Estimated", or "Not detected".
- Avoid denominational bias.
- Avoid churchy, preachy, overly religious, clinical, or shame-based wording.
- Do not assume the user is Christian.
- Express Bible-rooted truth naturally as wisdom, humility, courage, peace, love, self-control, honesty, and hope.
- Keep the tone age 14+ appropriate and relatable to Gen Z through millennials.
- Do not use the heading or wording "Theology".
- Use "Reflection" or "Truth Lens" style language instead.
- Keep all preparation guidance concise, practical, musician-aware, and truth-rooted.
- Avoid generic phrases like "This song is emotional" or "This song is uplifting".
- The selected instrument should shape instrument_guidance.
- Do not provide guitar gear, amp, pedal, cab, preset, EQ, downloadable preset, or tone settings.

Field guidance:
- faith_lens should explain the song's truth-rooted or heart-level direction in accessible language. Do not make it sound like a sermon.
- spiritual_reflection should be a short grounding prompt before listening, rehearsing, or leading.
- rehearsal_prep should be practical and concise.
- arrangement_feel should describe high-level movement only when supported or reasonably inferable.
- listening_guide should help the user listen for dynamics, space, repetition, and emotional direction without quoting lyrics.

Instrument guidance rules:
- Acoustic Guitar: strumming dynamics, rhythmic support, simplicity, restraint.
- Electric Guitar: ambient support, rhythmic pocket awareness, avoid overplaying.
- Bass: groove stability, root-note emphasis, dynamic consistency.
- Drums: cymbal restraint, groove consistency, transition control.
- Keys / Piano: pad layering ideas, spacing awareness, atmosphere support.
- Vocals: phrasing, emotional emphasis, harmony opportunities, clear delivery.`;

const VALID_INSTRUMENTS = {
  'acoustic-guitar': 'Acoustic Guitar',
  'electric-guitar': 'Electric Guitar',
  bass: 'Bass',
  drums: 'Drums',
  'keys-piano': 'Keys / Piano',
  vocals: 'Vocals'
};

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
    .replace(/\s*\(Live\)\s*/gi, ' ')
    .replace(/\s*\[Live\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getYouTubeTitle(url) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    url
  )}&format=json`;

  try {
    const oembedResponse = await fetch(oembedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; RootedByteBot/1.0; +https://rootedbyte.vercel.app)'
      }
    });

    if (oembedResponse.ok) {
      const oembedData = await oembedResponse.json();

      if (oembedData?.title) {
        return cleanYouTubeTitle(oembedData.title);
      }
    }
  } catch {
    // Continue to fallback.
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; RootedByteBot/1.0; +https://rootedbyte.vercel.app)'
    }
  });

  if (!response.ok) {
    throw new Error(
      'Could not read that YouTube page. Please type the song name and artist instead.'
    );
  }

  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  if (!titleMatch) {
    throw new Error(
      'Could not find the YouTube video title. Please type the song name and artist instead.'
    );
  }

  return cleanYouTubeTitle(titleMatch[1]);
}

function normalizeSourceLinks(parsed, data) {
  const modelLinks = Array.isArray(parsed.source_links)
    ? parsed.source_links
    : [];

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
      parts: [{ text: SOUNDSENSE_SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: 'user',
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

    if (
      response.status === 503 ||
      /high demand|overloaded|try again later/i.test(errorText)
    ) {
      throw new Error('The SoundSense engine is busy right now. Please try again in a minute.');
    }

    if (response.status === 429 || /quota|rate limit/i.test(errorText)) {
      throw new Error('The SoundSense engine is temporarily limited. Please try again later.');
    }

    throw new Error(
      'SoundSense could not create this result right now. Please try again.'
    );
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) {
    throw new Error('SoundSense returned an empty response.');
  }

  return normalizeSourceLinks(safeParse(raw), data);
}

function normalizeConfidence(value) {
  const confidence = String(value || '').trim().toLowerCase();

  if (['high', 'medium', 'low'].includes(confidence)) {
    return confidence;
  }

  return 'low';
}

function normalizeBpm(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  if (number < 40 || number > 260) {
    return 0;
  }

  return Math.round(number);
}

function normalizeSoundSenseData(data, instrumentLabel) {
  const safeData = data && typeof data === 'object' ? data : {};

  const song = String(safeData.song || '').trim();
  const artist = String(safeData.artist || '').trim();
  const songArtist = `${song} ${artist}`.trim() || 'song';

  return {
    song: song || 'Unable to verify',
    artist: artist || 'Unable to verify',
    bpm: normalizeBpm(safeData.bpm),
    key:
      typeof safeData.key === 'string' && safeData.key.trim()
        ? safeData.key.trim()
        : 'Unable to verify',
    metadata_confidence: normalizeConfidence(safeData.metadata_confidence),

    song_meaning: String(
      safeData.song_meaning ||
        safeData.meaning_summary ||
        'Song meaning is not available yet.'
    ).trim(),

    lyrics_search_query: String(
      safeData.lyrics_search_query || `${songArtist} lyrics`
    ).trim(),

    chord_search_query: String(
      safeData.chord_search_query || `${songArtist} chords`
    ).trim(),

    tutorial_search_query: String(
      safeData.tutorial_search_query || `${songArtist} ${instrumentLabel} tutorial`
    ).trim(),

    source_links: Array.isArray(safeData.source_links)
      ? safeData.source_links
          .filter((url) => /^https?:\/\//i.test(String(url || '')))
          .slice(0, 3)
      : [],

    faith_lens: String(
      safeData.faith_lens || 'Truth Lens is not available yet.'
    ).trim(),

    arrangement_feel: String(
      safeData.arrangement_feel || 'Song Flow guidance is not available yet.'
    ).trim(),

    listening_guide: String(
      safeData.listening_guide || 'Listening guidance is not available yet.'
    ).trim(),

    rehearsal_prep: String(
      safeData.rehearsal_prep || 'Preparation guidance is not available yet.'
    ).trim(),

    spiritual_reflection: String(
      safeData.spiritual_reflection || 'Reflection prompt is not available yet.'
    ).trim(),

    instrument_guidance: String(
      safeData.instrument_guidance ||
        `${instrumentLabel} guidance is not available yet.`
    ).trim()
  };
}

function buildSoundSensePrompt({ resolvedSong, originalSongInput, instrumentLabel }) {
  return `Research and create a SoundSense song reflection and musician preparation result.

Original user input:
${originalSongInput}

Resolved song input:
${resolvedSong}

Selected instrument:
${instrumentLabel}

Return:
- song identity
- BPM and key only when verifiable through public sources
- metadata confidence as "high", "medium", or "low"
- concise song meaning
- a search query for lyrics
- a search query for chords or tabs
- a search query for a tutorial for the selected instrument
- Truth Lens: the song's heart-level direction, values, tensions, or grounding points
- Song Flow: high-level emotional and musical movement
- Listen Closely: dynamic lifts, repeated phrases, restraint, and places to leave space
- Rehearsal Moves: practical preparation, transitions, cues, and restraint
- Before You Play: short reflection prompt and grounded mindset
- Role Coaching: concise guidance for the selected instrument

Important:
- Do not quote full lyrics.
- Do not include chord charts.
- Do not provide exact lyrics, chord, or tutorial URLs.
- Provide search queries only for lyrics, chords, and tutorial resources.
- Do not create guitar tone settings, gear presets, amp settings, cab settings, pedal settings, or downloadable presets.
- Do not invent chords, BPM, key, timestamps, arrangement details, instrument layers, or live performance moments.
- If a value cannot be verified, say "Unable to verify", "Estimated", or "Not detected".
- Keep the language practical, concise, modern, reflective, and accessible.
- Make it useful for someone who may simply want to understand the song and stay rooted in truth.
- Avoid denominational bias.
- Avoid churchy, preachy, or overly religious wording.
- Do not use the heading or wording "Theology".
- Return only the required JSON object.`;
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
        error:
          'Spotify links are not supported. Please type the song name and artist, or paste a YouTube link.'
      });
    }

    const instrumentLabel = VALID_INSTRUMENTS[instrument] || String(instrument).trim();

    if (!instrumentLabel) {
      return res.status(400).json({
        error: 'Please choose an instrument.'
      });
    }

    const originalSongInput = String(songInput).trim();
    let resolvedSong = originalSongInput;

    if (isYouTubeUrl(resolvedSong)) {
      resolvedSong = await getYouTubeTitle(resolvedSong);
    }

    const soundSense = await callGemini(
      buildSoundSensePrompt({
        resolvedSong,
        originalSongInput,
        instrumentLabel
      })
    );

    return res
      .status(200)
      .json(normalizeSoundSenseData(soundSense, instrumentLabel));
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to build that SoundSense result right now.'
    });
  }
};
