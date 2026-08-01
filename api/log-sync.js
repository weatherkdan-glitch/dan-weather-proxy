// api/log-sync.js
// Vercel Serverless Function — run every 5 minutes via Vercel Cron (see vercel.json).
// Pulls the station's current reading (same proxy charts.js already uses) and
// appends a real sample to weather-log.json server-side, independent of site visits.

const PROXY_URL = 'https://dan-weather-proxy.vercel.app/api/station';
const LOG_SAVE_URL = 'https://weather-dan.co.il/weather-log-save.php'; // TEST — points at Demo. Change back to the live URL (remove /Demo) once confirmed working.

module.exports = async (req, res) => {
  const log = [];
  const push = (msg) => { log.push(msg); console.log(msg); };

  try {
    const r = await fetch(PROXY_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('station proxy fetch failed: ' + r.status);
    const wrap = await r.json();
    const d = wrap && wrap.data;
    if (d == null || d.temp == null) throw new Error('station data missing temp — nothing to log. Raw response: ' + JSON.stringify(wrap).slice(0,500));

    const wm = (d.windStr || '').match(/(\d+\.?\d*)\s*km/);
    const windSpd = wm ? parseFloat(wm[1]) : null;

    const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
    const point = {
      t: Date.now(),
      temp: round1(d.temp),
      hum: round1(d.humidity),
      pres: round1(d.pressure),
      dew: round1(d.dew),
      rain: round1(d.rainToday),
      wind: round1(windSpd),
    };
    push('Sample: ' + JSON.stringify(point));

    const saveResp = await fetch(LOG_SAVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([point]),
    });
    const saveText = await saveResp.text().catch(() => '');
    if (!saveResp.ok) throw new Error('weather-log-save.php failed: ' + saveResp.status + ' ' + saveText);
    push('Saved OK: ' + saveText);

    return res.status(200).json({ ok: true, log });
  } catch (err) {
    push('ERROR: ' + err.message);
    return res.status(500).json({ ok: false, log });
  }
};
