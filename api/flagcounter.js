const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800');

  const counterId = 'Kyq';

  try {
    // Fetch monthly CSV from FlagCounter
    const csvData = await fetchUrl(`https://s01.flagcounter.com/countries/${counterId}/csv/`);

    const monthly = {};
    const lines = csvData.split('\n').slice(1);
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 3) {
        const iso = parts[1].toLowerCase().trim().replace(/"/g, '');
        const visitors = parseInt(parts[2].trim(), 10);
        if (iso && !isNaN(visitors) && visitors > 0) {
          monthly[iso] = visitors;
        }
      }
    }

    // Fetch today's stats from FlagCounter details page
    const detailHtml = await fetchUrl(`https://s01.flagcounter.com/more/${counterId}/`);

    const daily = {};
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    const rows = detailHtml.match(rowRegex) || [];
    for (const row of rows) {
      const flagMatch = row.match(/flagcdn\.com\/[^/]+\/([a-z]{2})\.png/i);
      if (!flagMatch) continue;
      const iso = flagMatch[1].toLowerCase();
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length >= 2) {
        const todayText = cells[1].replace(/<[^>]+>/g, '').trim();
        const val = parseInt(todayText, 10);
        if (!isNaN(val) && val > 0) {
          daily[iso] = val;
        }
      }
    }

    res.status(200).json({
      ok: true,
      monthly,
      daily,
      updated: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
