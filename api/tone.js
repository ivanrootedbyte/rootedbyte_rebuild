const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SOUNDSENSE_SYSTEM_PROMPT = `You are SoundSense, a careful song reflection and musician preparation assistant for RootedByte.

SoundSense helps users understand a song's identity, emotional direction, meaning, musical preparation needs, and grounded reflection without copying lyrics or providing copyrighted material.

Return ONLY raw JSON.
Do not use markdown.
Do not use code fences.
Do not add explanation text outside the JSON.

Use Google Search grounding when available to research public sources for:
- likely song identity
- likely artist
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
  "instrument_guidance": "",
  "mood_summary": "",
  "discernment_note": "",
  "content_caution": "",
  "is_heavy_content": false
}

Rules:
- Do not include or quote full copyrighted lyrics.
- Do not include chord charts.
- Do not provide exact lyrics, chord, or tutorial URLs.
- Provide search queries instead.
- If the user only enters a song title, try to infer the most likely artist from public sources.
- If multiple songs share the same title, choose the most likely match and set metadata_confidence accordingly.
- If you are unsure, still return the best match, but use metadata_confidence="low".
- song_meaning must be 2 to 4 sentences max.
- mood_summary must be 1 to 2 sentences max.
- discernment_note must be 1 to 3 sentences max.
- content_caution must be 1 sentence max.
- faith_lens must be 2 to 4 sentences max.
- arrangement_feel must be 2 to 4 sentences max.
- listening_guide must be 2 to 4 sentences max.
- rehearsal_prep must be 2 to 4 sentences max.
- spiritual_reflection must be 1 to 3 sentences max.
- instrument_guidance must be 2 to 4 sentences max.
- Keep every section concise, specific, and ready to drop into a clean UI card.
- Do not invent chords, BPM, key, timestamps, arrangement details, instrument layers, or live performance moments.
- If something is unavailable, say "Unable to verify", "Estimated", or "Not detected".
- Avoid denominational bias.
- Avoid churchy, preachy, overly religious, clinical, or shame-based wording.
- Do not assume the user is Christian.
- Express truth-rooted wisdom naturally as humility, courage, peace, love, self-control, honesty, and hope.
- Keep the tone age 14+ appropriate and relatable to Gen Z through millennials.
- Do not use the heading or wording "Theology".
- Do not provide guitar gear, amp, pedal, cab, preset, EQ, downloadable preset, or tone settings.

Discernment rules:
- mood_summary should briefly describe the emotional tone.
- If the song leans dark, seductive, despair-heavy, angry, numbing, prideful, revenge-driven, or spiritually draining, say so plainly but calmly.
- is_heavy_content should be true when the song appears to have a heavier or unhealthy emotional pull.
- discernment_note should help the user listen with wisdom, not fear or shame.
- Do not be dramatic. Be sober, grounded, and practical.

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
  } catch {}

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

function extractModelText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];

    const joined = parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();

    if (joined) {
      return joined;
    }
  }

  return '';
}

function normalizeConfidence(value) {
  const confidence = String(value || '').trim().toLowerCase();
  return ['high', 'medium', 'low'].includes(confidence) ? confidence : 'low';
}

function normalizeBpm(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;
  if (number < 40 || number > 260) return 0;

  return Math.round(number);
}

function normalizeBoolean(value) {
  return value === true;
}

function shortenText(value, fallback, maxChars = 320) {
  const text = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}...`;
}

function cleanText(value, maxLength = 2000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function titleCaseLoose(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildSearchQueries(song, artist, instrumentLabel) {
  const base = [song, artist].filter(Boolean).join(' ').trim() || song || 'song';

  return {
    lyrics_search_query: `${base} lyrics`,
    chord_search_query: `${base} chords`,
    tutorial_search_query: `${base} ${instrumentLabel} tutorial`
  };
}

function buildFallbackSoundSenseData(resolvedSong, instrumentLabel) {
  const cleanSong = titleCaseLoose(resolvedSong || 'This Song');
  const queries = buildSearchQueries(cleanSong, '', instrumentLabel);

  return {
    song: cleanSong || 'Unable to verify',
    artist: 'Unable to verify',
    bpm: 0,
    key: 'Unable to verify',
    metadata_confidence: 'low',
    source_links: [],
    ...queries,
    song_meaning:
      'A fully verified public breakdown was not available yet, so this is a light reflection based on the title or input you gave.',
    faith_lens:
      'Pay attention to what this song keeps pulling your heart toward. Notice whether it stirs peace, honesty, hope, humility, or something more draining.',
    arrangement_feel:
      'Start simple. Listen for repetition, dynamic lifts, and where the song leaves room to breathe before adding complexity.',
    listening_guide:
      'Listen for the emotional center of the song, where it builds, where it softens, and where restraint matters more than filling space.',
    rehearsal_prep:
      'Practice the main structure first, mark repeats, and focus on consistency before trying to add extra texture.',
    spiritual_reflection:
      'Before you play, ask yourself what kind of atmosphere you are helping create and whether your part supports clarity rather than distraction.',
    instrument_guidance:
      instrumentLabel === 'Acoustic Guitar'
        ? 'Hold steady rhythm, keep your strumming intentional, and do not rush to fill every space.'
        : instrumentLabel === 'Electric Guitar'
          ? 'Support the pocket, stay restrained, and add texture only where it actually helps the song breathe.'
          : instrumentLabel === 'Bass'
            ? 'Lock in the foundation, keep the pulse steady, and let consistency carry more than complexity.'
            : instrumentLabel === 'Drums'
              ? 'Keep transitions clean, avoid overplaying, and let the groove serve the song’s shape.'
              : instrumentLabel === 'Keys / Piano'
                ? 'Think in layers, leave room, and use texture to support the atmosphere rather than dominate it.'
                : 'Focus on clear delivery, emotional honesty, and phrasing that supports the song instead of forcing it.',
    mood_summary: 'Reflective and unresolved.',
    discernment_note:
      'If a song leaves you more numb, restless, hopeless, or pulled toward unhealthy patterns, listen with wisdom and limits.',
    content_caution:
      'Pause and check what this song is reinforcing in your mind and mood before looping it.',
    is_heavy_content: true
  };
}

async function resolveSongGuess(songInput) {
  const cleanInput = String(songInput || '').replace(/\s+/g, ' ').trim();
  if (!cleanInput) {
    return {
      resolvedSong: '',
      resolvedArtist: '',
      confidence: 'low'
    };
  }

  return {
    resolvedSong: cleanInput,
    resolvedArtist: '',
    confidence: cleanInput.includes(' - ') || cleanInput.includes(' by ') ? 'medium' : 'low'
  };
}

async function callGemini(userPrompt, resolvedSong, instrumentLabel) {
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

  const responseText = await response.text().catch(() => '');

  if (!response.ok) {
    if (
      response.status === 503 ||
      /high demand|overloaded|try again later/i.test(responseText)
    ) {
      throw new Error('The SoundSense engine is busy right now. Please try again in a minute.');
    }

    if (response.status === 429 || /quota|rate limit/i.test(responseText)) {
      throw new Error('The SoundSense engine is temporarily limited. Please try again later.');
    }

    throw new Error('SoundSense could not create this result right now. Please try again.');
  }

  let data = {};

  try {
    data = JSON.parse(responseText);
  } catch {
    return buildFallbackSoundSenseData(resolvedSong, instrumentLabel);
  }

  const raw = extractModelText(data);

  if (!raw) {
    return buildFallbackSoundSenseData(resolvedSong, instrumentLabel);
  }

  try {
    return normalizeSourceLinks(safeParse(raw), data);
  } catch {
    return buildFallbackSoundSenseData(resolvedSong, instrumentLabel);
  }
}

function normalizeSoundSenseData(data, instrumentLabel, resolutionGuess) {
  const safeData = data && typeof data === 'object' ? data : {};

  const rawSong = String(safeData.song || '').trim() || resolutionGuess.resolvedSong;
  const rawArtist = String(safeData.artist || '').trim() || resolutionGuess.resolvedArtist;

  const song = rawSong ? titleCaseLoose(rawSong) : 'Unable to verify';
  const artist = rawArtist ? titleCaseLoose(rawArtist) : 'Unable to verify';

  const derivedConfidence = normalizeConfidence(
    safeData.metadata_confidence || resolutionGuess.confidence
  );

  const queries = buildSearchQueries(
    song !== 'Unable to verify' ? song : resolutionGuess.resolvedSong,
    artist !== 'Unable to verify' ? artist : resolutionGuess.resolvedArtist,
    instrumentLabel
  );

  return {
    song,
    artist,
    bpm: normalizeBpm(safeData.bpm),
    key:
      typeof safeData.key === 'string' && safeData.key.trim()
        ? safeData.key.trim()
        : 'Unable to verify',
    metadata_confidence: derivedConfidence,

    song_meaning: cleanText(
  safeData.song_meaning || safeData.meaning_summary || 'Song meaning is not available yet.',
  2000
),

lyrics_search_query: String(
  safeData.lyrics_search_query || queries.lyrics_search_query
).trim(),

chord_search_query: String(
  safeData.chord_search_query || queries.chord_search_query
).trim(),

tutorial_search_query: String(
  safeData.tutorial_search_query || queries.tutorial_search_query
).trim(),

source_links: Array.isArray(safeData.source_links)
  ? safeData.source_links
      .filter((url) => /^https?:\/\//i.test(String(url || '')))
      .slice(0, 3)
  : [],

faith_lens: cleanText(
  safeData.faith_lens || 'Reflection is not available yet.',
  2000
),

arrangement_feel: cleanText(
  safeData.arrangement_feel || 'Song flow guidance is not available yet.',
  1600
),

listening_guide: cleanText(
  safeData.listening_guide || 'Listening guidance is not available yet.',
  1600
),

rehearsal_prep: cleanText(
  safeData.rehearsal_prep || 'Rehearsal preparation is not available yet.',
  1600
),

spiritual_reflection: cleanText(
  safeData.spiritual_reflection || 'Reflection prompt is not available yet.',
  1200
),

instrument_guidance: cleanText(
  safeData.instrument_guidance || `${instrumentLabel} guidance is not available yet.`,
  1800
),

mood_summary: cleanText(
  safeData.mood_summary || 'Mood not clearly detected.',
  800
),

discernment_note: cleanText(
  safeData.discernment_note || 'Listen with wisdom. Notice what the song strengthens in your thoughts and mood.',
  1200
),

content_caution: cleanText(
  safeData.content_caution || '',
  800
),

    is_heavy_content: normalizeBoolean(safeData.is_heavy_content)
  };
}

function buildSoundSensePrompt({
  resolvedSong,
  originalSongInput,
  instrumentLabel,
  resolutionGuess
}) {
  return `Research and create a SoundSense song reflection and musician preparation result.

Original user input:
${originalSongInput}

Working match guess:
Song: ${resolutionGuess.resolvedSong || resolvedSong || 'Unknown'}
Artist: ${resolutionGuess.resolvedArtist || 'Unknown'}
Confidence: ${resolutionGuess.confidence || 'low'}

Resolved song input:
${resolvedSong}

Selected instrument:
${instrumentLabel}

Return:
- likely song identity
- likely artist, even if the user only entered the title
- BPM and key only when verifiable through public sources
- metadata confidence as "high", "medium", or "low"
- concise song meaning
- a search query for lyrics
- a search query for chords or tabs
- a search query for a tutorial for the selected instrument
- mood summary
- discernment note
- content caution
- whether the content is heavier or unhealthy to sit under for long periods
- Truth Lens: the song's heart-level direction, values, tensions, or grounding points
- Song Flow: high-level emotional and musical movement
- Listen Closely: dynamic lifts, repeated phrases, restraint, and places to leave space
- Rehearsal Moves: practical preparation, transitions, cues, and restraint
- Before You Play: short reflection prompt and grounded mindset
- Role Guidance: concise guidance for the selected instrument

Important:
- Treat title-only input seriously and try to identify the most likely artist from public search.
- If multiple songs share the same title, pick the most likely one and lower confidence when needed.
- Keep every field concise and UI-ready.
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
- Be honest if the content seems emotionally heavy, dark, seductive, prideful, hopeless, or spiritually draining.
- Do not be dramatic about caution. Be grounded and practical.
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

    const resolutionGuess = await resolveSongGuess(resolvedSong);

    const soundSense = await callGemini(
      buildSoundSensePrompt({
        resolvedSong,
        originalSongInput,
        instrumentLabel,
        resolutionGuess
      }),
      resolvedSong,
      instrumentLabel
    );

    return res.status(200).json(
      normalizeSoundSenseData(soundSense, instrumentLabel, resolutionGuess)
    );
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to build that SoundSense result right now.'
    });
  }
};
