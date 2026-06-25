export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  
  const countries = ['il', 'us', 'gb', 'ca', 'de'];
  
  function parseSum(html) {
    const re = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4}[^<]*<\/[^>]+><\/td><td>[^>]+>(\d+)<\/td>/g;
    let sum = 0, m;
    while ((m = re.exec(html)) !== null) sum += parseInt(m[1], 10);
    return sum;
  }
  
  try {
    const results = await Promise.all(
      countries.map(code =>
        fetch(`https://s01.flagcounter.com/detail30/${code}/Kyq`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        .then(r => r.text())
        .then(html => ({ code, sum: parseSum(html) }))
        .catch(() => ({ code, sum: 0 }))
      )
    );
    
    const monthly = {};
    results.forEach(r => { monthly[r.code] = r.sum; });
    
    res.json({ monthly, ok: true, updated: new Date().toISOString() });
  } catch(e) {
    res.json({ monthly: {}, ok: false, error: e.message });
  }
}
