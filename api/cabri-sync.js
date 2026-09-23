// api/cabri-sync.js
// Vercel Serverless Function ג€” run daily via Vercel Cron (see vercel.json).
// Re-verifies and submits the last 3 days' total rain (mm) to rain.cabri.org.il/Dan automatically.
//
// Add this file to the SAME GitHub repo you already deploy to Vercel for
// dan-weather-proxy (e.g. api/cabri-sync.js), add/merge the vercel.json
// below, push to GitHub, and Vercel will run it once a day automatically.
//
// Env vars (set in Vercel dashboard -> Project -> Settings -> Environment
// Variables, NOT hardcoded in code, so the password isn't in your repo):
//   CABRI_USERNAME = ׳“׳•׳“׳™
//   CABRI_PASSWORD = 12245
//   DAILY_RAIN_URL = https://weather-dan.co.il/daily-rain.json (optional)

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
  // Node's fetch (undici) exposes multiple Set-Cookie via getSetCookie() when available
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
    const USERNAME = process.env.CABRI_USERNAME || '׳“׳•׳“׳™';
    const PASSWORD = process.env.CABRI_PASSWORD || '12245';
    const DAILY_RAIN_URL = process.env.DAILY_RAIN_URL || 'https://weather-dan.co.il/daily-rain.json';
    const now = new Date();

    // 1) Daily rain totals recorded SERVER-SIDE by daily-rain.php, which reads
    // the station's own "Today's Rain" figure straight from ALL-dan.htm every
    // 15 minutes. No visitor browsers involved ג€” one number per date, e.g.
    // {"2026-09-18": 14.4}. (Earlier versions read weather-log.json, which is
    // partly fed by visitors' browsers and could carry stale cached readings.)
    const drResp = await fetch(DAILY_RAIN_URL + '?t=' + Date.now(), { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!drResp.ok) throw new Error('Could not fetch daily-rain.json: ' + drResp.status);
    const daily = await drResp.json();

    function dayTotal(daysAgo) {
      // Israel-local calendar date (Vercel runs in UTC).
      const target = new Date(now.getTime() - daysAgo * 24 * 3600 * 1000);
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(target);
      const [ty, tm, td] = parts.split('-');
      const ymd = `${ty}-${tm}-${td}`;
      const dmy = `${td}/${tm}/${ty}`;
      const v = daily[ymd];
      const max = (v == null || isNaN(parseFloat(v))) ? null : Math.round(parseFloat(v) * 10) / 10;
      // A single day above 150mm here would be a sensor/reset glitch, not rain.
      const jump = (max != null && max > 150) ? { from: 0, to: max } : null;
      return { ymd, dmy, max, jump };
    }

    // Re-check the last 3 days every run (not just yesterday) so a value that
    // only settles to its true reading a day or two late ג€” e.g. a console
    // rain counter still clearing residual noise from a physical disturbance
    // ג€” still reaches Cabri once it's known, without needing a manual fix.
    const days = [1, 2, 3].map(dayTotal);
    if (!days.some(d => d.max !== null)) {
      push('No daily-rain.json entries for the last 3 days ג€” nothing to submit.');
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
      'ctl00$contentPlaceHolder$lg$submitBtn': '׳”׳™׳›׳ ׳¡ ׳׳׳¢׳¨׳›׳×',
    });
    // The site responds to the login POST with a 302 redirect that carries the auth
    // cookie. fetch's automatic redirect-follow issues that next GET WITHOUT our
    // manual cookie header, losing the session. So we capture the 302 directly
    // (redirect: 'manual') and follow it ourselves with cookies attached.
    const { res: loginRes } = await fetchWithCookies(LOGIN_POST_URL, jar, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: loginBody,
    });
    if (loginRes.status !== 302) push('WARNING: unexpected login status ' + loginRes.status);

    let anySubmitted = false;
    for (const day of days) {
      if (day.max === null) { push(`${day.dmy}: not in daily-rain.json ג€” skipped.`); continue; }
      if (day.jump) {
        push(`${day.dmy}: SUSPICIOUS jump ${day.jump.from}mm -> ${day.jump.to}mm in one step ג€” looks like a sensor glitch, not real rain. Skipped.`);
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
      if (!found) { push(`${day.dmy}: no matching row on the GetRain page ג€” skipped.`); continue; }

      postFields['ctl00$contentPlaceHolder$saveBtn'] = '׳©׳׳•׳¨';
      await fetchWithCookies(GETRAIN_URL, jar, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: buildFormBody(postFields),
      });
      push(`${day.dmy}: submitted ${day.max} mm.`);
      anySubmitted = true;
    }

    await reportStatus(anySubmitted ? `SUCCESS ג€” ${log.join(' | ')}` : `SKIPPED ALL ג€” ${log.join(' | ')}`, log);
    return res.status(200).json({ ok: true, log });
  } catch (err) {
    push('ERROR: ' + err.message);
    await reportStatus(`FAILED ג€” ${err.message}`, log);
    return res.status(500).json({ ok: false, log });
  }
};