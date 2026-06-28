const http = require('http');
const { TextDecoder } = require('util');

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function fetchStation() {
  return new Promise((resolve) => {
    const options = {
      hostname: '62.128.42.5',
      port: 80,
      path: '/~dan/ALL-dan-s.htm',
      method: 'GET',
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Host': '62.128.42.5' }
    };
    const chunks = [];
    const req = http.get(options, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(new TextDecoder('windows-1255').decode(Buffer.concat(chunks))));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function extractNum(s) {
  if (!s) return null;
  const m = s.match(/-?\d+\.?\d*/);
  return m ? parseFloat(m[0]) : null;
}

function parseStation(html) {
  const t = html.replace(/<[^>]+>/g, '§').replace(/&nbsp;/g, ' ');
  const cells = t.split('§').map(s => s.trim()).filter(Boolean);

  function after(label) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].includes(label) && cells[i+1]) {
        return extractNum(cells[i+1]);
      }
    }
    return null;
  }

  function afterStr(label) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].includes(label) && cells[i+1]) return cells[i+1].trim();
    }
    return '';
  }

  function before(label) {
    // value appears BEFORE label
    for (let i = 1; i < cells.length; i++) {
      if (cells[i].includes(label)) return cells[i-1].trim();
    }
    return '';
  }

  // heatIndex: "עומס" + "חום" + value — find "Heat Index" English label
  function heatIndexVal() {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 'Heat' && cells[i+1] === 'Index' && cells[i+2]) {
        return extractNum(cells[i+2]);
      }
      // also try "Heat Index" as one cell
      if (cells[i].includes('Heat Index') && cells[i+1]) {
        return extractNum(cells[i+1]);
      }
    }
    return null;
  }

  // windStr: after "כוון ומהירות הרוח"
  const windStr = afterStr('כוון ומהירות הרוח');

  // pressStr: "Rising Slowly" appears BEFORE "Barometer and trend"
  const pressStr = before('Barometer and trend');

  // sunrise/sunset
  const sunrise = afterStr('Sunrise Time') || afterStr('זמן \r\n\t\t\t\t\tזריחה');
  const sunset  = afterStr('Sunset Time')  || afterStr('זמן שקיעה');

  return {
    temp:        after('טמפרטורה'),
    tempHigh:    after('High Temperature'),
    tempLow:     after('Low Temperature'),
    dew:         after('נקודת הטל'),
    dewHigh:     after('High Dew Point'),
    dewLow:      after('Low Dew Point'),
    humidity:    after('לחות יחסית'),
    humHigh:     after('High Humidity'),
    humLow:      after('Low Humidity'),
    pressure:    after('לחץ אויר'),
    pressHigh:   after('High Barometer'),
    pressLow:    after('Low Barometer'),
    rainToday:   after('משקעים היום'),
    rainStorm:   after('משקעים בפרק'),
    rainMonth:   after('משקעים החודש'),
    rainSeason:  after('משקעים מתחילת העונה'),
    windChill:   after('השפעת הצינון של הרוח'),
    windHigh:    after('High Wind Speed'),
    heatIndex:   heatIndexVal(),
    windStr:     windStr,
    pressStr:    pressStr,
    stationTime: afterStr('Station Time'),
    sunrise:     sunrise,
    sunset:      sunset,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) {
    return res.json({ ok: true, data: cache, cached: true, age: Math.round((now-cacheTime)/1000) });
  }

  const html = await fetchStation();
  if (!html) {
    if (cache) return res.json({ ok: true, data: cache, cached: true, stale: true });
    return res.status(503).json({ ok: false, error: 'station unreachable' });
  }

  cache = parseStation(html);
  cacheTime = now;
  res.json({ ok: true, data: cache, cached: false, updated: new Date().toISOString() });
};
