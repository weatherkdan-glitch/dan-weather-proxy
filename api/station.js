const https = require('https');

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function fetchStation() {
  return new Promise((resolve) => {
    const options = {
      hostname: '62.128.42.5',
      path: '/~dan/ALL-dan-s.htm',
      timeout: 10000,
    };
    const req = https.get(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function parseStation(html) {
  const t = html.replace(/<[^>]+>/g, '§').replace(/&nbsp;/g, ' ');
  const cells = t.split('§').map(s => s.trim()).filter(Boolean);
  
  function after(label) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].includes(label) && cells[i+1]) {
        const m = cells[i+1].match(/-?\d+\.?\d*/);
        return m ? parseFloat(m[0]) : null;
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

  return {
    temp:       after('טמפרטורה'),
    tempHigh:   after('High Temperature'),
    tempLow:    after('Low Temperature'),
    dew:        after('נקודת הטל'),
    humidity:   after('לחות יחסית'),
    humHigh:    after('High Humidity'),
    humLow:     after('Low Humidity'),
    pressure:   after('לחץ אויר'),
    pressHigh:  after('High Barometer'),
    pressLow:   after('Low Barometer'),
    rainToday:  after('משקעים היום'),
    rainStorm:  after('משקעים בפרק'),
    rainMonth:  after('משקעים החודש'),
    rainSeason: after('משקעים מתחילת העונה'),
    windChill:  after('השפעת הצינון'),
    heatIndex:  after('עומס חום'),
    windStr:    afterStr('Wind Direction and Speed'),
    pressStr:   afterStr('Barometer and trend'),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // Vercel CDN cache 5 min

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
