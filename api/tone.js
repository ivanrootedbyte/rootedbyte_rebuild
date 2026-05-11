const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SONG_DIVEIN_SYSTEM_PROMPT = `You are Song DiveIn, a careful music research and guitar tone assistant.
Return ONLY raw JSON with no markdown, no code fences, and no explanation text.

Use Google Search grounding when available to research public sources for:
- song identity
- BPM and key
- general song meaning
- public lyric source links
- public chord source links
- public guitar tutorial links

Structure:
{
  "song": "",
  "artist": "",
  "bpm": 0,
  "key": "",
  "metadata_confidence": "",
  "song_meaning": "",
  "lyrics_link": { "label": "", "source": "", "url": "", "validated_for_song": false },
  "chord_link": { "label": "", "source": "", "url": "", "validated_for_song": false },
  "tutorial_link": { "label": "", "source": "", "url": "", "validated_for_song": false },
  },
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
- Do not include full copyrighted lyric text anywhere in the JSON.
- lyrics_links should include external lyric source links only when likely available, such as Genius, AZLyrics, Musixmatch, LyricFind, or official artist pages.
- chord_links should include external chord source links only when likely available, such as Ultimate Guitar, WorshipTogether, PraiseCharts, SongSelect, E-Chords, Chordify, or official artist resources.
- tutorial_links should include public tutorial links or YouTube search/result links when likely available.
- song_meaning should be concise and original wording based on public context when available.
- If public meaning sources are not available, infer carefully from commonly described themes and say it is an interpretation.
- chord_data should provide a practice-friendly chord starting point organized into Verse, Chorus, and Bridge if known.
- If Bridge does not exist or is unknown, omit the Bridge section.
- If chords cannot be reasonably estimated, use an empty sections array.
- Never claim chord links, lyric links, tutorial links, BPM, or key are verified unless a real public URL is provided.
- metadata_confidence must be "high", "medium", or "low".
- source_links must contain up to 3 public URLs used for research.
- Gear affects only amp_model, cab, gain, bass, mid, treble, presence, reverb_mix, delay_time_ms, delay_mix, and notes.
- All knob values are 0-10.
- delay_time_ms is 0-800.
- Return only ONE best lyrics_link, ONE best chord_link, and ONE best tutorial_link.
- Only return a URL if it appears to be directly for the requested song and artist.
- For chord_link, prefer a real chord/tab page for the exact song, not a general search result.
- For tutorial_link, prefer a YouTube or guitar tutorial page clearly matching the exact song.
- For lyrics_link, prefer a public external lyrics page clearly matching the exact song.
- If no direct matching source is found, set url to "" and validated_for_song to false.
- Do not return generic Google search URLs as validated links.
- Do not invent URLs.
- Do not include full lyrics.
- Do not include chord charts.`;

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

function normalizeSingleLink(item, fallbackLabel) {
  if (!item || typeof item !== 'object') {
    return {
      label: fallbackLabel,
      source: '',
      url: '',
      validated_for_song: false
    };
  }

  const url = String(item.url || '').trim();
  const isRealUrl = /^https?:\/\//i.test(url);
  const isGenericSearch = /google\.com\/search|bing\.com\/search|duckduckgo\.com/i.test(url);

  return {
    label: String(item.label || fallbackLabel),
    source: String(item.source || ''),
    url: isRealUrl && !isGenericSearch ? url : '',
    validated_for_song: Boolean(item.validated_for_song && isRealUrl && !isGenericSearch)
  };
}

async function callGemini(userPrompt) {
  if (!process.env.GEMINI_KEY) {
    throw new Error('GEMINI_KEY is not configured.');
  }

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

  if (!raw) {
    throw new Error('Gemini returned an empty response.');
  }

  return normalizeLinks(safeParse(raw), data);
}

function normalizeResourceLinks(items, fallbackLabel, limit = 3) {
  if (!Array.isArray(items)) return [];

  return items
    .slice(0, limit)
    .map((item) => ({
      label: String(item?.label || item?.source || fallbackLabel),
      source: String(item?.source || ''),
      url: String(item?.url || '')
    }))
    .filter((item) => item.url && /^https?:\/\//i.test(item.url));
}

function normalizeTutorialLinks(items) {
  if (!Array.isArray(items)) return [];

  return items
    .slice(0, 5)
    .map((item) => ({
      title: String(item?.title || 'Guitar tutorial'),
      source: String(item?.source || ''),
      url: String(item?.url || '')
    }))
    .filter((item) => item.url && /^https?:\/\//i.test(item.url));
}

function normalizeChordData(data) {
  const chordData = data && typeof data === 'object'
    ? data
    : {
        original_key: '',
        capo: '',
        sections: []
      };

  const sections = Array.isArray(chordData.sections)
    ? chordData.sections
        .slice(0, 3)
        .map((section) => ({
          name: String(section?.name || 'Section'),
          chords: Array.isArray(section?.chords)
            ? section.chords.slice(0, 8).map(String).filter(Boolean)
            : []
        }))
        .filter((section) => section.chords.length)
    : [];

  return {
    original_key: String(chordData.original_key || chordData.key || ''),
    capo: String(chordData.capo || ''),
    sections
  };
}

function clampToneData(data) {
  const knobKeys = ['gain', 'bass', 'mid', 'treble', 'presence', 'reverb_mix', 'delay_mix'];

  knobKeys.forEach((key) => {
    const value = Number(data[key]);
    data[key] = Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0;
  });

  const delay = Number(data.delay_time_ms);
  data.delay_time_ms = Number.isFinite(delay)
    ? Math.min(800, Math.max(0, Math.round(delay)))
    : 0;

  const bpm = Number(data.bpm);
  data.bpm = Number.isFinite(bpm)
    ? Math.min(260, Math.max(40, Math.round(bpm)))
    : 0;

  data.song = String(data.song || '');
  data.artist = String(data.artist || '');
  data.key = typeof data.key === 'string' && data.key.trim() ? data.key.trim() : 'Unknown';

  data.metadata_confidence =
    typeof data.metadata_confidence === 'string' && data.metadata_confidence.trim()
      ? data.metadata_confidence.trim()
      : 'low';

  data.song_meaning = String(data.song_meaning || data.meaning_summary || 'Song meaning is not available yet.');

data.lyrics_link = normalizeSingleLink(data.lyrics_link, 'Lyrics source');
data.chord_link = normalizeSingleLink(data.chord_link, 'Chord source');
data.tutorial_link = normalizeSingleLink(data.tutorial_link, 'Guitar tutorial');

  if (!data.chord_data.original_key || data.chord_data.original_key === 'Unknown') {
    data.chord_data.original_key = data.key || '';
  }

  data.source_links = Array.isArray(data.source_links) ? data.source_links.slice(0, 3) : [];

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
    return res.status(405).json({ error: 'Use POST for this endpoint.' });
  }

  try {
    const { songInput, gear } = req.body || {};

    if (!songInput || !gear) {
      return res.status(400).json({ error: 'Song input and gear are required.' });
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
- public lyric source links when available
- public chord source links when available
- public guitar tutorial links when available
- practice-friendly chord_data organized by Verse, Chorus, and Bridge when possible
- practical starting guitar tone settings for the selected gear

Do not quote full lyrics.
Do not include full copyrighted lyrics.
Do not claim external sources are verified unless real public URLs are provided.`);

    return res.status(200).json(clampToneData(diveIn));
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to build that Song DiveIn result right now.'
    });
  }
};
