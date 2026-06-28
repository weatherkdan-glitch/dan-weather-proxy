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

  // after: value is in cell AFTER label
  function after(label) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === label && cells[i+1]) return extractNum(cells[i+1]);
    }
    return null;
  }

  // afterIncludes: looser match
  function afterIncludes(label) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].includes(label) && cells[i+1]) return extractNum(cells[i+1]);
    }
    return null;
  }

  // before: value is in cell BEFORE label
  function before(label) {
    for (let i = 1; i < cells.length; i++) {
      if (cells[i] === label) return cells[i-1].trim();
      if (cells[i].includes(label)) return cells[i-1].trim();
    }
    return '';
  }

  // afterStr: string value after label
  function afterStr(label) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === label && cells[i+1]) return cells[i+1].trim();
      if (cells[i].includes(label) && cells[i+1]) return cells[i+1].trim();
    }
    return '';
  }

  // Special: heatIndex current — "עומס" then "חום" then value
  function currentHeatIndex() {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 'עומס' && cells[i+1] === 'חום' && cells[i+2]) {
        return extractNum(cells[i+2]);
      }
    }
    return null;
  }

  // Special: heatIndex high — "High" "Heat" "Index" then value
  function highHeatIndex() {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 'High' && cells[i+1] === 'Heat' && cells[i+2] === 'Index' && cells[i+3]) {
        return extractNum(cells[i+3]);
      }
    }
    return null;
  }

  // stationTime: before "Station Time"
  const stationTime = before('Station Time');

  // sunrise: cell[3] = "4:32", cell[4] = "18:52", cell[5] = "Sunrise Time"
  // from cells: "4:32","18:52","Sunrise Time","Sunset Time"
  let sunrise = null, sunset = null;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 'Sunrise Time') {
      sunrise = cells[i-2] || null; // "4:32"
      sunset  = cells[i-1] || null; // "18:52"
      break;
    }
  }

  return {
    temp:        afterIncludes('טמפרטורה'),
    tempHigh:    extractNum(after('High Temperature')),
    tempLow:     extractNum(after('Low Temperature')),
    dew:         afterIncludes('נקודת הטל'),
    dewHigh:     extractNum(after('High Dew Point')),
    dewLow:      extractNum(after('Low Dew Point')),
    humidity:    afterIncludes('לחות יחסית'),
    humHigh:     extractNum(after('High Humidity')),
    humLow:      extractNum(after('Low Humidity')),
    pressure:    afterIncludes('לחץ אויר'),
    pressHigh:   extractNum(after('High Barometer')),
    pressLow:    extractNum(after('Low Barometer')),
    rainToday:   afterIncludes('משקעים היום'),
    rainStorm:   afterIncludes('משקעים בפרק'),
    rainMonth:   afterIncludes('משקעים החודש'),
    rainSeason:  afterIncludes('משקעים מתחילת העונה'),
    windChill:   afterIncludes('השפעת הצינון של הרוח'),
    windHigh:    extractNum(after('High Wind Speed')),
    heatIndex:   currentHeatIndex(),
    heatHigh:    highHeatIndex(),
    windStr:     before('Wind Direction and Speed'),
    pressStr:    before('Barometer and trend'),
    stationTime: stationTime,
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
