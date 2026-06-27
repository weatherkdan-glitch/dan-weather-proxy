const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800');

  return new Promise((resolve) => {
    https.get('https://s01.flagcounter.com/countries/Kyq/csv/', (fcRes) => {
      let data = '';
      fcRes.on('data', chunk => data += chunk);
      fcRes.on('end', () => {
        const monthly = {};
        const lines = data.split('\n').slice(1);
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            const iso = parts[1].toLowerCase().trim().replace(/"/g, '');
            const val = parseInt(parts[2].trim(), 10);
            if (iso && !isNaN(val)) monthly[iso] = val;
          }
        }
        res.status(200).json({ ok: true, monthly, updated: new Date().toISOString() });
        resolve();
      });
    }).on('error', (err) => {
      res.status(500).json({ ok: false, error: err.message });
      resolve();
    });
  });
};
