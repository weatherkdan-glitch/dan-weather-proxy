export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  
  try {
    const response = await fetch('https://s01.flagcounter.com/detail30/il/Kyq', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();
    
    const re = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4}[^<]*<\/[^>]+><\/td><td>[^>]+>(\d+)<\/td>/g;
    let sum = 0, m;
    while ((m = re.exec(html)) !== null) sum += parseInt(m[1], 10);
    
    res.json({ il_30day: sum, ok: true, updated: new Date().toISOString() });
  } catch(e) {
    res.json({ il_30day: 0, ok: false, error: e.message });
  }
}
