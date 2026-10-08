// api/cabri-sync.js
// Vercel Serverless Function — run daily via Vercel Cron (see vercel.json).
// Re-verifies the last 3 days' rain (mm) on rain.cabri.org.il/Dan and fixes
// any day that doesn't match the station.
//
// Source of truth: the station's own NOAA monthly reports (NOAAMO = this month,
// NOAAPRMO = last month), written by WeatherLink from the console's archive.
//
// Cabri moved (Oct 2026) from an ASP.NET form site to a Supabase backend.
// The flow is now three plain JSON calls:
//   rpc/login            {p_username, p_password}          -> {token, user}
//   rpc/get_month_page   {p_location, p_year, p_month}     -> {daily: {"YYYY-MM-DD": mm}}
//   rpc/save_entry_days  {p_token, p_location, p_days:[{date, mm}]} -> {changed}
//
// Env vars (Vercel dashboard -> Settings -> Environment Variables):
//   CABRI_USERNAME, CABRI_PASSWORD   (fall back to the values below)
//   NOAA_BASE_URL = https://weather-dan.co.il/meteo/dochot/ (optional)

const SUPABASE = 'https://mhejcldgkwblabqoerwn.supabase.co/rest/v1/rpc/';
// Public "publishable" key the Cabri site itself ships to every browser.
const APIKEY = 'sb_publishable_jBr6mZSQ53_j3bMsJXZTsg_ci7lrzAz';
const LOCATION_ID = 4; // Dan

const STATUS_URL = 'https://weather-dan.co.il/cabri-sync-status.php';

async function rpc(name, body) {
  const r = await fetch(SUPABASE + name, {
    method: 'POST',
    headers: {
      apikey: APIKEY,
      'content-type': 'application/json',
      origin: 'https://rain.cabri.org.il',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name} failed: ${r.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch (e) { throw new Error(`${name}: bad JSON ${text.slice(0, 200)}`); }
}

async function reportStatus(message, log) {
  try {
    const r = await fetch(STATUS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (log) log.push(`DEBUG reportStatus: ${r.status}`);
  } catch (e) {
    if (log) log.push(`DEBUG reportStatus failed: ${e.message}`);
  }
}

const MONTHS = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06',
                 JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };

function parseNoaa(text, label) {
  const h = text.match(/CLIMATOLOGICAL SUMMARY for ([A-Z]{3})\.?\s+(\d{4})/);
  // A blocked request returns an HTML challenge page instead of the report.
  // Fail loudly rather than treat a missing report as zero rain.
  if (!h || !MONTHS[h[1]]) throw new Error(label + ' is not a valid NOAA report (server block page?)');
  const mm = MONTHS[h[1]], yyyy = h[2];
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 9 || !/^\d{1,2}$/.test(p[0])) continue;
    const day = parseInt(p[0], 10);
    const rain = parseFloat(p[8]);
    if (day < 1 || day > 31 || isNaN(rain)) continue;
    out[`${yyyy}-${mm}-${String(day).padStart(2, '0')}`] = Math.round(rain * 10) / 10;
  }
  return out;
}

module.exports = async (req, res) => {
  const log = [];
  const push = (msg) => { log.push(msg); console.log(msg); };

  try {
    const USERNAME = process.env.CABRI_USERNAME || 'דודי';
    const PASSWORD = process.env.CABRI_PASSWORD || '12245';
    const NOAA_BASE_URL = process.env.NOAA_BASE_URL || 'https://weather-dan.co.il/meteo/dochot/';

    // 1) Station's daily rain from its own monthly reports.
    async function getReport(name) {
      const r = await fetch(NOAA_BASE_URL + name + '?t=' + Date.now(), { headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Could not fetch ' + name + ': ' + r.status);
      return parseNoaa(await r.text(), name);
    }
    const station = Object.assign({}, await getReport('NOAAPRMO.TXT'), await getReport('NOAAMO.TXT'));

    // 2) The last 3 finished days, as Israel-local dates (Vercel runs in UTC).
    const now = Date.now();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
    const days = [1, 2, 3].map(n => fmt.format(new Date(now - n * 24 * 3600 * 1000)));

    // 3) What Cabri currently has for those days (one call per month involved).
    const cabri = {};
    const monthsNeeded = [...new Set(days.map(d => d.slice(0, 7)))];
    for (const ym of monthsNeeded) {
      const page = await rpc('get_month_page', { p_location: LOCATION_ID, p_year: +ym.slice(0, 4), p_month: +ym.slice(5, 7) });
      Object.assign(cabri, (page && page.daily) || {});
    }

    // 4) Decide what to send. Cabri only lists rainy days, so a missing day = 0.
    // Only send days that actually differ — that also covers correcting a wrong
    // non-zero value back to 0 (e.g. a sensor glitch that slipped through).
    const toSave = [];
    for (const d of days) {
      const dmy = `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
      if (!(d in station)) { push(`${dmy}: not in the station report yet — skipped.`); continue; }
      const want = station[d];
      const have = cabri[d] != null ? Math.round(parseFloat(cabri[d]) * 10) / 10 : 0;
      // A single day above 150mm here would be a sensor/reset glitch, not rain.
      if (want > 150) { push(`${dmy}: station shows ${want} mm — looks like a sensor glitch. Skipped.`); continue; }
      if (want === have) { push(`${dmy}: already ${have} mm — OK.`); continue; }
      toSave.push({ date: d, mm: want });
      push(`${dmy}: Cabri has ${have} mm, station ${want} mm — will update.`);
    }

    if (toSave.length === 0) {
      await reportStatus(`OK — nothing to change | ${log.join(' | ')}`, log);
      return res.status(200).json({ ok: true, log });
    }

    // 5) Log in and save.
    const login = await rpc('login', { p_username: USERNAME, p_password: PASSWORD });
    if (!login || !login.token) throw new Error('login returned no token: ' + JSON.stringify(login).slice(0, 200));
    const saved = await rpc('save_entry_days', { p_token: login.token, p_location: LOCATION_ID, p_days: toSave });
    push(`Saved ${toSave.length} day(s): ${JSON.stringify(saved)}`);

    await reportStatus(`SUCCESS — ${log.join(' | ')}`, log);
    return res.status(200).json({ ok: true, log });
  } catch (err) {
    push('ERROR: ' + err.message);
    await reportStatus(`FAILED — ${err.message}`, log);
    return res.status(500).json({ ok: false, log });
  }
};
