 Design is moving to Artifacts in the Claude app. You can keep using this version until December 14. Learn more



https://s01.flagcounter.com/countries/Kyq#google_vignette
That's a Google ad page, the #google_vignette at the end: the ad covered the screen before the click got through.

Close the ad (X in the corner), or press back.
Click Israel in the list again.
Send me the address of the page that opens. It should contain il or Israel.
https://s01.flagcounter.com/factbook/il/Kyq
That's a factbook page, not the old detail page: FlagCounter changed its structure. Before I change the code, I need to know whether this page still has a list of daily visits.

Please send me a screenshot of the page https://s01.flagcounter.com/factbook/il/Kyq, scrolled to show:

Is there a table of dates with visitor counts (like "Today", "Yesterday", dates)?
Or a summary of the last 7 or 30 days?
If none of these are there, look for a link on the page such as "Visitors per day" or "Details", and send me its address too.

Screenshot_2026-10-10-16-10-47-240_com.android.chrome.jpg
The factbook page has no daily data at all, just general information about the country. So FlagCounter apparently removed the 7- and 30-day breakdown by country, and there's nowhere left to read it from.

Workaround: the total per country still updates. So once a day the proxy will save a snapshot of the totals, and calculate:

7 days = today's total minus the total from a week ago
30 days = today's total minus the total from 30 days ago
It's exact, and doesn't depend on FlagCounter pages that might change again.

The catch: history starts from today. 7 days will appear in another week, 30 days in another month. Until then the cells will be empty, not 0.

Paste into GitHub as api/flagcounter.js and commit:

// ─────────────────────────────────────────────────────────────
//  FlagCounter proxy for the Kibbutz Dan weather site
//  Deploy path in the "dan-weather-proxy" repo:  /api/flagcounter.js
//
//  FlagCounter removed its per-country daily pages (Oct 2026), so 7/30-day
//  figures are now computed here: once a day we store a snapshot of every
//  country's running total, and
//     7 days  = total now − total 7 days ago
//     30 days = total now − total 30 days ago
//  Until enough history exists the value is null (shown as an empty cell).
//  Result is pushed to flagcounter-cache-save.php for fast static reads.
// ─────────────────────────────────────────────────────────────

const CODE  = 'Kyq';
const HOST  = 'https://s01.flagcounter.com';
const TOP_N = 30;
const KEEP_DAYS = 32;
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
  // Country links point at /factbook/xx/Kyq now (were /detail30/xx/Kyq).
  const re = new RegExp('([\\d,]+)\\s*(?:<[^>]*>\\s*)*<a[^>]*/(?:detail30|factbook)/([a-z]{2})/' + CODE, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const cc = m[2].toLowerCase();
    const n  = parseInt(m[1].replace(/,/g, ''), 10);
    if (!isNaN(n) && (totals[cc] == null || n > totals[cc])) totals[cc] = n;
  }
  return totals;
}

function parseAvg30(html) {
  const m = html.replace(/<[^>]*>/g, ' ').match(/30\s*day\s*average[:\s]*([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

const ilDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const prev = await getPrevCache();

    const [p1, p2, overview] = await Promise.all([
      getText(`${HOST}/countries/${CODE}`),
      getText(`${HOST}/countries/${CODE}/2`).catch(() => ''),
      getText(`${HOST}/more/${CODE}`).catch(() => ''),
    ]);
    const totals = Object.assign({}, parseTotals(p1), parseTotals(p2));
    if (!Object.keys(totals).length) throw new Error('could not read totals from FlagCounter');
    const avg30 = parseAvg30(overview);

    // ── Daily snapshots of the running totals ──
    const now = Date.now();
    const today = ilDate(now);
    const snapshots = Object.assign({}, prev && prev.snapshots);
    if (!snapshots[today]) snapshots[today] = totals;          // first run of the day
    const cutoff = ilDate(now - KEEP_DAYS * 86400000);
    for (const d of Object.keys(snapshots)) if (d < cutoff) delete snapshots[d];

    const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, TOP_N);
    function since(daysAgo) {
      const snap = snapshots[ilDate(now - daysAgo * 86400000)];
      const out = {};
      for (const cc of top) {
        // No snapshot that old yet → null (empty cell), never a fake 0.
        out[cc] = snap ? Math.max(0, totals[cc] - (snap[cc] || 0)) : null;
      }
      return out;
    }
    const week7   = since(7);
    const month30 = since(30);

    const result = {
      ok: true, totals, month30, week7, avg30, snapshots,
      historyDays: Object.keys(snapshots).length,
      updated: new Date().toISOString(),
    };

    // Respond without the bulky snapshot history; the cache keeps it.
    const { snapshots: _s, ...publicResult } = result;
    res.status(200).json(publicResult);

    fetch(CACHE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    }).catch(() => {});
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e), totals: {}, month30: {} });
  }
};