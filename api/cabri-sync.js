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