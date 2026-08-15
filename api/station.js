const { TextDecoder } = require('util');

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;
const STATION_URL = 'https://weather-dan.co.il/ALL-dan.htm';

function fetchStation() {
  return fetch(STATION_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    .then(r => r.arrayBuffer())
    .then(buf => new TextDecoder('windows-1255').decode(buf))
    .catch(() => null);
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
      if (cells[i] === label || cells[i].includes(label)) {
        if (cells[i+1]) return extractNum(cells[i+1]);
      }
    }
    return null;
  }

  function highLowPair(highLabel, lowLabel) {
    for (let i = 0; i < cells.length - 3; i++) {
      if ((cells[i] === highLabel || cells[i].includes(highLabel)) &&
          (cells[i+1] === lowLabel || cells[i+1].includes(lowLabel))) {
        return {
          high: extractNum(cells[i+2]),
          low:  extractNum(cells[i+3]),
        };
      }
    }
    return { high: null, low: null };
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

  const tempHL   = highLowPair('High Temperature',  'Low Temperature');
  const dewHL    = highLowPair('High Dew Point',    'Low Dew Point');
  const humHL    = highLowPair('High Humidity',     'Low Humidity');
  const pressHL  = highLowPair('High Barometer',    'Low Barometer');

  return {
    temp:        afterNum('טמפרטורה'),
    tempHigh:    tempHL.high,
    tempLow:     tempHL.low,
    dew:         afterNum('נקודת הטל'),
    dewHigh:     dewHL.high,
    dewLow:      dewHL.low,
    humidity:    afterNum('לחות יחסית'),
    humHigh:     humHL.high,
    humLow:      humHL.low,
    pressure:    afterNum('לחץ אויר'),
    pressHigh:   pressHL.high,
    pressLow:    pressHL.low,
    rainToday:   afterNum('משקעים היום'),
    rainStorm:   afterNum('משקעים בפרק'),
    rainMonth:   (function(){ var v = afterNum('משקעים החודש'); var now = new Date(); if (v!=null && now.getFullYear()===2026 && now.getMonth()===7) v = Math.max(0, Math.round((v-0.2)*10)/10); return v; })(),
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