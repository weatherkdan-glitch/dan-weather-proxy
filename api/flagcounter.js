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
    const [todayHtml, monthHtml] = await Promise.all([
      fetchUrl(`https://s01.flagcounter.com/today/${counterId}/`),
      fetchUrl(`https://s01.flagcounter.com/countries/${counterId}/`)
    ]);

    res.status(200).json({
      ok: true,
      today_sample: todayHtml.substring(0, 2000),
      month_sample: monthHtml.substring(0, 2000)
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
