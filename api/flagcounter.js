const CODE = 'Kyq';
const HOST = 'https://s01.flagcounter.com';
const TTL  = 30 * 60 * 1000;
let _cache = null, _cacheAt = 0;

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DanWeather/1.0)' } });
  return r.text();
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
function parseToday(html) {
  const today = {};
  const re = /flags\/([a-z]{2})\.(?:png|gif)[\s\S]{0,240}?([\d,]+)\s*<\/(?:td|b|span|div|a)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cc = m[1].toLowerCase();
    const n  = parseInt(m[2].replace(/,/g, ''), 10);
    if (!isNaN(n) && today[cc] == null) today[cc] = n;
  }
  return today;
}
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
    const [p1, p2, todayHtml, overview] = await Promise.all([
      getText(`${HOST}/countries/${CODE}`),
      getText(`${HOST}/countries/${CODE}/2`).catch(() => ''),
      getText(`${HOST}/today/${CODE}`).catch(() => ''),
      getText(`${HOST}/more/${CODE}`).catch(() => ''),
    ]);
    const totals = Object.assign({}, parseTotals(p1), parseTotals(p2));
    const today  = parseToday(todayHtml);
    const avg30  = parseAvg30(overview);
    _cache = { ok: true, totals, today, avg30, updated: new Date().toISOString() };
    _cacheAt = now;
    res.status(200).json(_cache);
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e), totals: {}, today: {} });
  }
};
