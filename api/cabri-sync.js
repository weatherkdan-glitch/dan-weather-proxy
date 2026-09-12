

Connection interrupted
The log shows something different than what you described: the 0.4mm was submitted for September 2nd (02/09/2026), not for any August date — no multi-day delay actually occurred, it was submitted next-morning as designed (Sept 3, 1:10 AM, for "yesterday" = Sept 2).

So this is likely trailing residual contamination from the Aug 30 gauge-disturbance incident — the console's daily rain counter didn't fully clear immediately after that event and the manual reset, and bled a small 0.4mm phantom reading into Sept 2nd's total before fully settling. Not a sync-timing bug.

This is hard to catch automatically — 0.4mm is indistinguishable from real light rain, well under the 15mm jump-guard we just added. The only real prevention: after any physical gauge tampering/reset event, keep an eye on the next 2–3 days' Cabri submissions (or pause that cron briefly) before trusting them.

Want me to correct that 0.4mm on Cabri's Sept 2 entry to 0 now, given we've confirmed it wasn't real rain?

What i want is that the cabri sync to also verify the last 2-3 days before.
I assume that if i will make a manual correction it will be on the same day or a day after. This should update retroactively - we have some file logging daily rain anyway right? Make the cabri sync check it for the last 3 days
Two changes: extend the log's retention window so 3 days of raw data exist to check, and make cabri-sync re-verify/re-submit each of the last 3 days (not just yesterday) every run — so a late-settling correction propagates automatically.

Both files ready above.

weather-log-save.php → upload to your server (extends the rolling log from 25h to 74h; doesn't affect the 24h charts, which already filter client-side).
cabri-sync.js → paste into GitHub api/cabri-sync.js, commit.
Now each daily run re-verifies and re-submits the last 3 calendar days, not just yesterday — so a value that only settles a day or two late (like the Sept 2 residual) still reaches Cabri correctly without a manual fix, while the suspicious-jump guard still blocks real sensor-glitch spikes.

Edited 2 files
Give me the cabri sync code to paste
// api/cabri-sync.js
// Vercel Serverless Function — run daily via Vercel Cron (see vercel.json).
// Re-verifies and submits the last 3 days' total rain (mm) to rain.cabri.org.il/Dan.
//
// Add this file to the SAME GitHub repo you already deploy to Vercel for
// dan-weather-proxy (e.g. api/cabri-sync.js), add/merge the vercel.json
// below, push to GitHub, and Vercel will run it once a day automatically.
//
// Env vars (set in Vercel dashboard -> Project -> Settings -> Environment
// Variables, NOT hardcoded in code, so the password isn't in your repo):
//   CABRI_USERNAME = דודי
//   CABRI_PASSWORD = 12245
//   WEATHER_LOG_URL = http://weather-dan.co.il/weather-log.json

const LOGIN_URL = 'https://rain.cabri.org.il/Login.aspx?ReturnUrl=%2fDan%2fAdmin%2fGetRain';
const LOGIN_POST_URL = 'https://rain.cabri.org.il/Login/Signout'; // the login <form>'s actual action attribute
const GETRAIN_URL = 'https://rain.cabri.org.il/Dan/Admin/GetRain';

function extractHidden(html, name) {
  const re1 = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
  const re2 = new RegExp(`id="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
}

// NOTE: earlier assumption that submitted form values needed windows-1255 byte
// encoding was WRONG (confirmed by a garbled "????" echoed username + "wrong
// username/password" error). The site serves pages in windows-1255 but its
// ASP.NET form parser reads posted data as plain UTF-8, so we just standard-encode.
function toFormEncoded(str) {
  return encodeURIComponent(str);
}
function buildFormBody(fields) {
  return Object.entries(fields).map(([k, v]) => encodeURIComponent(k) + '=' + toFormEncoded(String(v))).join('&');
}

// A tiny manual cookie jar since fetch() doesn't manage cookies across requests server-side.
function mergeCookies(jar, setCookieHeaders) {
  if (!setCookieHeaders) return jar;
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const sc of list) {
    const pair = sc.split(';')[0];
    const [name] = pair.split('=');
    jar[name.trim()] = pair;
  }
  return jar;
}
function cookieHeader(jar) {
  return Object.values(jar).join('; ');
}

const STATUS_URL = 'http://weather-dan.co.il/cabri-sync-status.php';
async function reportStatus(message, log) {
  try {
    const r = await fetch(STATUS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const t = await r.text().catch(() => '');
    if (log) log.push(`DEBUG reportStatus response: ${r.status} ${t.slice(0, 200)}`);
  } catch (e) {
    if (log) log.push(`DEBUG reportStatus failed: ${e.message}`);
  }
}

async function fetchWithCookies(url, jar, options = {}) {
  const res = await fetch(url, {
    ...options,
    redirect: options.redirect || 'follow',
    headers: {
      ...(options.headers || {}),
      cookie: cookieHeader(jar),
      'user-agent': 'Mozilla/5.0 (compatible; DanWeatherSync/1.0)',
    },
  });
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : res.headers.get('set-cookie');
  mergeCookies(jar, setCookies);
  const body = await res.clone().text().catch(() => '');
  return { res, body };
}

module.exports = async (req, res) => {
  const log = [];
  const push = (msg) => { log.push(msg); console.log(msg); };

  try {
    const USERNAME = process.env.CABRI_USERNAME || 'דודי';
    const PASSWORD = process.env.CABRI_PASSWORD || '12245';
    const WEATHER_LOG_URL = process.env.WEATHER_LOG_URL || 'http://weather-dan.co.il/weather-log.json';
    const now = new Date();

    // 1) This site's own rain log (last ~74h)
    const logResp = await fetch(WEATHER_LOG_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!logResp.ok) throw new Error('Could not fetch weather-log.json: ' + logResp.status);
    const points = await logResp.json();

    function dayTotal(daysAgo) {
      const target = new Date(now.getTime() - daysAgo * 24 * 3600 * 1000);
      const ty = target.getFullYear(), tm = target.getMonth() + 1, td = target.getDate();
      const ymd = `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
      const dmy = `${String(td).padStart(2, '0')}/${String(tm).padStart(2, '0')}/${ty}`;
      let max = null, prev = null, jump = null;
      for (const p of points) {
        if (p.t == null || p.rain == null) continue;
        const pd = new Date(p.t);
        const pYMD = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}-${String(pd.getDate()).padStart(2, '0')}`;
        if (pYMD !== ymd) continue;
        if (max === null || p.rain > max) max = p.rain;
        // A real tipping-bucket gauge can't jump more than a couple mm in one
        // 5-min sample even in a downpour — a bigger jump is a sensor glitch
        // (disconnection/reset artifact), not real rain.
        if (prev != null && p.rain - prev > 15) jump = { from: prev, to: p.rain };
        prev = p.rain;
      }
      return { ymd, dmy, max, jump };
    }

    // Re-check the last 3 days every run (not just yesterday) so a value that
    // only settles to its true reading a day or two late — e.g. a console
    // rain counter still clearing residual noise from a physical disturbance
    // — still reaches Cabri once it's known, without needing a manual fix.
    const days = [1, 2, 3].map(dayTotal);
    if (!days.some(d => d.max !== null)) {
      push('No log samples found for the last 3 days — nothing to submit.');
      return res.status(200).json({ ok: true, log });
    }

    // 2) Login once, then re-load the GetRain page + submit fresh for EACH
    // of the 3 days in turn (tokens are single-use per page load).
    const jar = {};
    const { body: loginPage } = await fetchWithCookies(LOGIN_URL, jar);
    const viewState = extractHidden(loginPage, '__VIEWSTATE');
    const viewStateGen = extractHidden(loginPage, '__VIEWSTATEGENERATOR');
    const eventValidation = extractHidden(loginPage, '__EVENTVALIDATION');

    const loginBody = buildFormBody({
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      __EVENTVALIDATION: eventValidation,
      'ctl00$contentPlaceHolder$lg$username': USERNAME,
      'ctl00$contentPlaceHolder$lg$password': PASSWORD,
      'ctl00$contentPlaceHolder$lg$submitBtn': 'היכנס למערכת',
    });
    const { res: loginRes } = await fetchWithCookies(LOGIN_POST_URL, jar, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: loginBody,
    });
    if (loginRes.status !== 302) push('WARNING: unexpected login status ' + loginRes.status);

    let anySubmitted = false;
    for (const day of days) {
      if (day.max === null) { push(`${day.dmy}: no log samples for this day — skipped.`); continue; }
      if (day.jump) {
        push(`${day.dmy}: SUSPICIOUS jump ${day.jump.from}mm -> ${day.jump.to}mm in one step — looks like a sensor glitch, not real rain. Skipped.`);
        continue;
      }

      const { body: ratePage } = await fetchWithCookies(GETRAIN_URL, jar);
      const viewState2 = extractHidden(ratePage, '__VIEWSTATE');
      const viewStateGen2 = extractHidden(ratePage, '__VIEWSTATEGENERATOR');
      const eventValidation2 = extractHidden(ratePage, '__EVENTVALIDATION');

      const rowRe = /(\d{2}\/\d{2}\/\d{4})\s*<\/td>\s*<td[^>]*>\s*<input name="(ctl00\$contentPlaceHolder\$rainTbl\$ctl\d+\$millimeter)"[^>]*value="([^"]*)"/gs;
      const rows = [...ratePage.matchAll(rowRe)];
      if (rows.length === 0) throw new Error('Could not find any rain rows on the GetRain page (page structure may have changed).');

      const postFields = {
        __VIEWSTATE: viewState2,
        __VIEWSTATEGENERATOR: viewStateGen2,
        __EVENTVALIDATION: eventValidation2,
      };

      let found = false;
      for (const row of rows) {
        const [, rowDate, fieldName, currentValue] = row;
        if (rowDate === day.dmy) {
          postFields[fieldName] = String(day.max);
          found = true;
        } else {
          postFields[fieldName] = currentValue;
        }
      }
      if (!found) { push(`${day.dmy}: no matching row on the GetRain page — skipped.`); continue; }

      postFields['ctl00$contentPlaceHolder$saveBtn'] = 'שמור';
      await fetchWithCookies(GETRAIN_URL, jar, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: buildFormBody(postFields),
      });
      push(`${day.dmy}: submitted ${day.max} mm.`);
      anySubmitted = true;
    }

    await reportStatus(anySubmitted ? `SUCCESS — ${log.join(' | ')}` : `SKIPPED ALL — ${log.join(' | ')}`, log);
    return res.status(200).json({ ok: true, log });
  } catch (err) {
    push('ERROR: ' + err.message);
    await reportStatus(`FAILED — ${err.message}`, log);
    return res.status(500).json({ ok: false, log });
  }
};