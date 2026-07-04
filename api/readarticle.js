const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function decodeText(value) {
  return cleanText(value)
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getMeta(document, selector) {
  const element = document.querySelector(selector);
  return decodeText(element?.getAttribute('content') || element?.textContent || '');
}

function cleanUrlHeadline(url) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => part.replace(/\.[a-z0-9]+$/i, ''));

    let candidate = pathParts[pathParts.length - 1] || parsed.hostname;

    candidate = candidate
      .replace(/^article[-_]/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b[a-f0-9]{8,}\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!candidate || candidate.length < 8) {
      candidate = parsed.hostname.replace(/^www\./, '');
    }

    return candidate
      .split(' ')
      .map((word) => {
        if (/^(pm|ai|us|uk|un|nato|nasa|rcmp|cbc|ctv)$/i.test(word)) {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  } catch {
    return 'News article headline unavailable';
  }
}

function buildFallbackPayload({ url, title = '', description = '', h1 = '', articleText = '' }) {
  const cleanTitle = decodeText(title);
  const cleanDescription = decodeText(description);
  const cleanH1 = decodeText(h1);
  const urlHeadline = cleanUrlHeadline(url);

  const bestHeadline = cleanH1 || cleanTitle || urlHeadline;
  const bestDescription = cleanDescription || '';

  const usableText = cleanText(articleText).slice(0, 4000);

  if (usableText && usableText.length >= 180) {
    return {
      title: bestHeadline,
      text: usableText,
      summaryBasis: 'full_article',
      fallbackUsed: false,
      sourceUrl: url
    };
  }

  const fallbackText = [
    `Headline: ${bestHeadline}`,
    bestDescription ? `Available page summary: ${bestDescription}` : '',
    usableText ? `Available article text: ${usableText}` : '',
    `Source URL: ${url}`
  ].filter(Boolean).join('\n\n');

  return {
    title: bestHeadline,
    text: fallbackText,
    summaryBasis: usableText
      ? 'headline_and_description'
      : bestDescription
        ? 'headline_and_description'
        : 'headline_from_url',
    fallbackUsed: true,
    sourceUrl: url
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RootedByteNewsVerse/1.0; +https://rootedbyte.vercel.app)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Article fetch failed with status ${response.status}.`);
  }

  return response.text();
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST for this endpoint.' });
  }

  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'Article URL is required.' });
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Please enter a valid article URL.' });
  }

  try {
    const html = await fetchHtml(parsedUrl.toString());
    const dom = new JSDOM(html, { url: parsedUrl.toString() });
    const { document } = dom.window;

    document.querySelectorAll('script, style, nav, footer, iframe, noscript, form, aside').forEach((el) => el.remove());

    const metaTitle =
      getMeta(document, 'meta[property="og:title"]') ||
      getMeta(document, 'meta[name="twitter:title"]') ||
      decodeText(document.querySelector('title')?.textContent || '');

    const metaDescription =
      getMeta(document, 'meta[property="og:description"]') ||
      getMeta(document, 'meta[name="description"]') ||
      getMeta(document, 'meta[name="twitter:description"]');

    const h1 = decodeText(document.querySelector('h1')?.textContent || '');

    let readableText = '';

    try {
      const reader = new Readability(document.cloneNode(true));
      const article = reader.parse();
      readableText = cleanText(article?.textContent || '');
    } catch {
      readableText = '';
    }

    if (!readableText || readableText.length < 180) {
      const paragraphs = [
        ...document.querySelectorAll(
          'article p, main p, [role="main"] p, .article-body p, .story-body p, .entry-content p, .post-content p, .article-content p, p'
        )
      ]
        .map((p) => cleanText(p.textContent))
        .filter((text) => text.length > 40);

      readableText = cleanText(paragraphs.join(' '));
    }

    return res.status(200).json(buildFallbackPayload({
      url: parsedUrl.toString(),
      title: metaTitle,
      description: metaDescription,
      h1,
      articleText: readableText
    }));
  } catch (error) {
    console.error('readarticle failed:', error);

    return res.status(200).json(buildFallbackPayload({
      url: parsedUrl.toString(),
      title: '',
      description: '',
      h1: '',
      articleText: ''
    }));
  }
};