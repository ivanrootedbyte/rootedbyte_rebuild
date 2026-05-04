const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
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
    const { url } = req.body || {};
    if (!url || !isValidHttpUrl(url)) {
      return res.status(400).json({ error: 'Please enter a valid article URL.' });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 RootedByte/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'The article could not be fetched. Try another public article link.' });
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    document.querySelectorAll('script, style, nav, footer, aside, iframe, form, noscript, svg, canvas, .ad, .ads, .advertisement, [role="navigation"], [aria-label="advertisement"]').forEach((node) => node.remove());

    const reader = new Readability(document);
    const article = reader.parse();

    if (!article || !normalizeText(article.textContent)) {
      return res.status(422).json({ error: 'I could not extract readable article text from that page.' });
    }

    const text = normalizeText(article.textContent).slice(0, 4000);
    return res.status(200).json({
      title: normalizeText(article.title),
      byline: normalizeText(article.byline),
      siteName: normalizeText(article.siteName),
      url,
      text
    });
  } catch {
    return res.status(500).json({ error: 'The article could not be read. Some sites block article extraction.' });
  }
};
