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

    // Return first 3000 chars so we can see the structure
    res.status(200).json({
      ok: true,
      debug: html.substring(0, 3000)
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
