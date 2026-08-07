// ─────────────────────────────────────────────────────────────
//  FlagCounter proxy for the Kibbutz Dan weather site
//  Deploy path in the "dan-weather-proxy" repo:  /api/flagcounter.js
//  After pasting → commit / Publish → Vercel redeploys automatically.
//
//  Returns:
//    {
//      ok: true,
//      totals:  { il: 187838, us: 2394, ... },   // live all-time visitors per country
//      month30: { il: 268, us: 3, ... },          // REAL last-30-day visitors, top countries
//      week7:   { il: 61, us: 1, ... },           // REAL last-7-day visitors, top countries
//      avg30:   8,                                 // site-wide 30-day average per day
//      updated: "2026-07-02T..."
//    }
//  The per-country 30-day figure is summed from each country's daily-breakdown
//  page (/detail30/<cc>). We only fetch it for the TOP_N countries by all-time
//  total (recent visitors always come from the popular ones), to stay fast.
// ─────────────────────────────────────────────────────────────

const CODE  = 'Kyq';                      // your FlagCounter code
const HOST  = 'https://s01.flagcounter.com';
const TTL   = 30 * 60 * 1000;             // cache 30 minutes
const TOP_N = 30;                          // how many countries to pull 30-day for
const BATCH_SIZE = 10;                     // concurrent per-country requests — too many at once gets rate-limited

let _cache = null, _cacheAt = 0;

async function getText(url, retries) {
  retries = retries == null ? 1 : retries;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DanWeather/1.0)' } });
    return r.text();
  } catch (e) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 800));
      return getText(url, retries - 1);
    }
    throw e;
  }
}

// Per-country all-time totals from the Details pages.
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

// Sum the most recent N daily rows on a /detail30/<cc> page.
function sumDays(html, days) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  const re = /(?:Today|Yesterday|[A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})\s+([\d,]+)/g;
  let m, total = 0, count = 0;
  while ((m = re.exec(text)) && count < days) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) { total += n; count++; }
  }
  return total;
}

// Site-wide 30-day average from the overview page ("30 day average: N").
function parseAvg30(html) {
  const m = html.replace(/<[^>]*>/g, ' ').match(/30\s*day\s*average[:\s]*([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  try {
    const now = Date.now();
    if (_cache && now - _cacheAt < TTL) { res.status(200).json(_cache); return; }

    // 1) totals (both list pages) + site-wide average — each retries once on failure
    const [p1, p2, overview] = await Promise.all([
      getText(`${HOST}/countries/${CODE}`),
      getText(`${HOST}/countries/${CODE}/2`).catch(() => ''),
      getText(`${HOST}/more/${CODE}`).catch(() => ''),
    ]);
    const totals = Object.assign({}, parseTotals(p1), parseTotals(p2));
    const avg30  = parseAvg30(overview);

    // 2) real 30-day per country, for the TOP_N by total — fetched in small
    // batches (not all 30 at once) with a retry each, since firing every
    // request simultaneously was triggering rate-limiting on FlagCounter's
    // side and losing most countries for the whole 30-min cache window.
    // Hard deadline so a slow round still returns whatever it has instead of
    // running past Vercel's function timeout and failing the whole request.
    const DEADLINE_MS = 8000;
    const startedAt = Date.now();
    const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, TOP_N);
    const month30 = {};
    const week7 = {};
    for (let i = 0; i < top.length; i += BATCH_SIZE) {
      if (Date.now() - startedAt > DEADLINE_MS) break;
      const batch = top.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (cc) => {
        try {
          const h = await getText(`${HOST}/detail30/${cc}/${CODE}`, 0);
          month30[cc] = sumDays(h, 30);
          week7[cc]   = sumDays(h, 7);
        } catch (e) { /* skip on error */ }
      }));
    }

    _cache   = { ok: true, totals, month30, week7, avg30, updated: new Date().toISOString() };
    _cacheAt = now;
    res.status(200).json(_cache);
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e), totals: {}, month30: {} });
  }
};
