export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const response = await fetch('https://s01.flagcounter.com/detail30/il/Kyq', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();
    
    res.json({ 
      length: html.length,
      sample: html.substring(0, 3000)
    });
  } catch(e) {
    res.json({ error: e.message });
  }
}
