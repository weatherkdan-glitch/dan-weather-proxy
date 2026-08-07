// ─────────────────────────────────────────────────────────────
//  FlagCounter proxy for the Kibbutz Dan weather site
//  Deploy path in the "dan-weather-proxy" repo:  /api/flagcounter.js
//  After pasting → commit / Publish → Vercel redeploys automatically.
//
//  Scrapes FlagCounter (only Vercel's network can reach it reliably — the
//  site's own web host times out on outbound requests to flagcounter.com)
//  and pushes the result to flagcounter-cache-save.php on the site's own
//  server, so visitors always read an instant local static file instead of
//  hitting this function directly. Trigger this on a schedule via
//  cron-job.org (e.g. every 15 min) to keep that file fresh.
// ─────────────────────────────────────────────────────────────

const CODE  = 'Kyq';
const HOST  = 'https://s01.flagcounter.com';
const TOP_N = 30;
const BATCH_SIZE = 10;
const DEADLINE_MS = 25000; // generous — this runs on a background schedule, never blocking a visitor

async function getText(url, retries) {
  retries = retries == null ? 2 : retries;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DanWeather/1.0)' } });
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

function parseAvg30(html) {
  const m = html.replace(/<[^>]*>/g, ' ').match(/30\s*day\s*average[:\s]*([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const [p1, p2, overview] = await Promise.all([
      getText(`${HOST}/countries/${CODE}`),
      getText(`${HOST}/countries/${CODE}/2`).catch(() => ''),
      getText(`${HOST}/more/${CODE}`).catch(() => ''),
    ]);
    const totals = Object.assign({}, parseTotals(p1), parseTotals(p2));
    const avg30  = parseAvg30(overview);

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

    const result = { ok: true, totals, month30, week7, avg30, updated: new Date().toISOString() };
    res.status(200).json(result);

    fetch('https://weather-dan.co.il/flagcounter-cache-save.php', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    }).catch(() => {});
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e), totals: {}, month30: {} });
  }
};
