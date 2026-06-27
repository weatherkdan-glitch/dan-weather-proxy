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

  const counterId = 'Kyq';

  try {
    const html = await fetchUrl(`https://s01.flagcounter.com/more/${counterId}/`);

    // Find lines with "il" (Israel) to see the row structure
    const lines = html.split('\n');
    const relevant = lines.filter(l => 
      l.includes('/il/') || l.includes('Israel') || l.includes('il.png') ||
      l.includes('<td') && l.match(/\d{3,}/)
    ).slice(0, 30);

    res.status(200).json({
      ok: true,
      relevant
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
