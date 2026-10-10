// ─────────────────────────────────────────────────────────────
//  FlagCounter proxy for the Kibbutz Dan weather site
//  Deploy path in the "dan-weather-proxy" repo:  /api/flagcounter.js
//  After pasting → commit / Publish → Vercel redeploys automatically.
//
//  Scrapes FlagCounter and pushes the result to flagcounter-cache-save.php
//  on the site's own server, so visitors read an instant static file.
//  Diagnostic: /api/flagcounter?debug=il shows what FlagCounter returns
//  for one country's detail page.
// ─────────────────────────────────────────────────────────────

const CODE  = 'Kyq';
const HOST  = 'https://s01.flagcounter.com';
const TOP_N = 30;
const CACHE_URL = 'https://weather-dan.co.il/flagcounter-cache-save.php';

async function getPrevCache() {
  try {
    const r = await fetch(CACHE_URL, { headers: { 'Cache-Control': 'no-cache' } });
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch (e) { return null; }
}

async function getText(url, retries) {
  retries = retries == null ? 2 : retries;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } });
    return r.text();
  } catch (e) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return getText(url, retries - 1);
    }
    throw e;
  }
}

function parseTotals(html) {
  const totals = {};
  const re = new RegExp('([\\d,]+)\\s*(?:<[^>]*>\\s*)*<a[^>]*/detail30/([a-z]{2})/' + CODE, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const cc = m[2].toLowerCase();
    const n  = parseInt(m[1].replace(/,/g, ''), 10);
    if (!isNaN(n) && (totals[cc] == null || n > totals[cc])) totals[cc] = n;
  }
  return totals;
}

// Returns { total, rows } — rows = how many day-lines were found. rows === 0
// means the page didn't look like a detail page at all (format change or a
// block page), which must NOT be treated as "0 visitors".
function sumDays(html, days) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const re = /(?:Today|Yesterday|[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s*\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d,]+)/g;
  let m, total = 0, rows = 0;
  while ((m = re.exec(text)) && rows < days) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) { total += n; rows++; }
  }
  return { total, rows };
}

function parseAvg30(html) {
  const m = html.replace(/<[^>]*>/g, ' ').match(/30\s*day\s*average[:\s]*([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // ── Diagnostic mode ──
  const dbg = req.query && req.query.debug;
  if (dbg) {
    const cc = String(dbg).toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'il';
    const h = await getText(`${HOST}/detail30/${cc}/${CODE}`, 0).catch((e) => 'FETCH ERROR: ' + e);
    const text = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
                  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return res.status(200).json({ country: cc, htmlLength: h.length, parsed30: sumDays(h, 30), textSample: text.slice(0, 1500) });
  }

  try {
    const prev = await getPrevCache();
    const today = new Date().toISOString().slice(0, 10);
    const fetchedOn = (prev && prev.fetchedOn) || {};

    const [p1, p2, overview] = await Promise.all([
      getText(`${HOST}/countries/${CODE}`),
      getText(`${HOST}/countries/${CODE}/2`).catch(() => ''),
      getText(`${HOST}/more/${CODE}`).catch(() => ''),
    ]);
    const totals = Object.assign({}, parseTotals(p1), parseTotals(p2));
    const avg30  = parseAvg30(overview);

    const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, TOP_N);
    const month30 = Object.assign({}, prev && prev.month30);
    const week7   = Object.assign({}, prev && prev.week7);

    // Re-fetch a country if not fetched today, OR if its stored value is 0
    // (0 may be a leftover from a failed parse, so keep retrying it).
    const toFetch = top.filter((cc) => fetchedOn[cc] !== today || !month30[cc]);
    let parsedOk = 0, parseFailed = 0;

    await Promise.all(toFetch.map(async (cc) => {
      try {
        const h = await getText(`${HOST}/detail30/${cc}/${CODE}`, 0);
        const m30 = sumDays(h, 30);
        if (m30.rows === 0) { parseFailed++; return; } // keep previous value, retry next run
        month30[cc] = m30.total;
        week7[cc]   = sumDays(h, 7).total;
        fetchedOn[cc] = today;
        parsedOk++;
      } catch (e) { parseFailed++; }
    }));

    const result = { ok: true, totals, month30, week7, avg30, fetchedOn, parsedOk, parseFailed, updated: new Date().toISOString() };
    res.status(200).json(result);

    fetch(CACHE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    }).catch(() => {});
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e), totals: {}, month30: {} });
  }
};