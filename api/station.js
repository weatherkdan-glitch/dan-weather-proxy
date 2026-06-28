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
  const m = String(s).match(/-?\d+\.?\d*/);
  return m ? parseFloat(m[0]) : null;
}

function parseStation(html) {
  const t = html.replace(/<[^>]+>/g, '§').replace(/&nbsp;/g, ' ');
  const cells = t.split('§').map(s => s.trim()).filter(Boolean);

  function afterNum(label) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === label && cells[i+1]) return extractNum(cells[i+1]);
      if (cells[i].includes(label) && cells[i+1]) return extractNum(cells[i+1]);
    }
    return null;
  }

  function before(label) {
    for (let i = 1; i < cells.length; i++) {
      if (cells[i] === label || cells[i].includes(label)) return cells[i-1].trim();
    }
    return '';
  }

  function currentHeatIndex() {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 'עומס' && cells[i+1] === 'חום' && cells[i+2]) return extractNum(cells[i+2]);
    }
    return null;
  }

  function highHeatIndex() {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 'High' && cells[i+1] === 'Heat' && cells[i+2] === 'Index' && cells[i+3]) return extractNum(cells[i+3]);
    }
    return null;
  }

  let sunrise = null, sunset = null;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 'Sunrise Time') {
      sunrise = cells[i-2] || null;
      sunset  = cells[i-1] || null;
      break;
    }
  }

  return {
    temp:        afterNum('טמפרטורה'),
    tempHigh:    afterNum('High Temperature'),
    tempLow:     afterNum('Low Temperature'),
    dew:         afterNum('נקודת הטל'),
    dewHigh:     afterNum('High Dew Point'),
    dewLow:      afterNum('Low Dew Point'),
    humidity:    afterNum('לחות יחסית'),
    humHigh:     afterNum('High Humidity'),
    humLow:      afterNum('Low Humidity'),
    pressure:    afterNum('לחץ אויר'),
    pressHigh:   afterNum('High Barometer'),
    pressLow:    afterNum('Low Barometer'),
    rainToday:   afterNum('משקעים היום'),
    rainStorm:   afterNum('משקעים בפרק'),
    rainMonth:   afterNum('משקעים החודש'),
    rainSeason:  afterNum('משקעים מתחילת העונה'),
    windChill:   afterNum('השפעת הצינון של הרוח'),
    windHigh:    afterNum('High Wind Speed'),
    heatIndex:   currentHeatIndex(),
    heatHigh:    highHeatIndex(),
    windStr:     before('Wind Direction and Speed'),
    pressStr:    before('Barometer and trend'),
    stationTime: before('Station Time'),
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
