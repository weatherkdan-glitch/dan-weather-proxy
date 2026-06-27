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
    const html = await fetchUrl(`https://s01.flagcounter.com/more/${counterId}/`);

    const monthly = {};
    const daily = {};

    // Find all table rows with flag images
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowRegex) || [];

    for (const row of rows) {
      // Look for flagcdn.com flag image
      const flagMatch = row.match(/flagcdn\.com\/[^/]+\/([a-z]{2})\.png/i);
      if (!flagMatch) continue;
      const iso = flagMatch[1].toLowerCase();

      // Extract all numbers from <td> cells
      const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
        .map(td => {
          const text = td.replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
          return parseInt(text, 10);
        });

      // FlagCounter details page columns: Flag | Country | Today | Yesterday | This Week | This Month | Total
      // Index:                                0       1        2         3           4            5       6
      if (cells.length >= 6) {
        if (!isNaN(cells[2]) && cells[2] > 0) daily[iso]   = cells[2];
        if (!isNaN(cells[5]) && cells[5] > 0) monthly[iso] = cells[5];
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
