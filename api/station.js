const http = require('http');
const { TextDecoder } = require('util');

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
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(new TextDecoder('windows-1255').decode(buf));
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const html = await fetchStation();
  if (!html) return res.status(503).json({ ok: false, error: 'unreachable' });

  // Return all cells so we can see the structure
  const t = html.replace(/<[^>]+>/g, '§').replace(/&nbsp;/g, ' ');
  const cells = t.split('§').map(s => s.trim()).filter(Boolean);
  
  res.json({ ok: true, cells: cells.slice(0, 150) });
};
