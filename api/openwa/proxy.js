/**
 * Nagara — OpenWA Proxy
 * Forward request dari browser ke OpenWA (ngrok/localhost)
 * sehingga CORS tidak jadi masalah
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OpenWA-URL, X-OpenWA-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const targetBase = req.headers['x-openwa-url'] || '';
  const apiKey     = req.headers['x-openwa-key']  || '';
  const path       = req.query.path || '/api/health';

  if (!targetBase) return res.status(400).json({ ok: false, error: 'X-OpenWA-URL header required' });

  try {
    const target = new URL(path, targetBase);
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;

    let bodyStr = '';
    if (req.method === 'POST' && req.body) {
      bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const options = {
      hostname: target.hostname,
      port:     target.port || (isHttps ? 443 : 80),
      path:     target.pathname + target.search,
      method:   req.method,
      headers: {
        'X-API-Key': apiKey,
        'ngrok-skip-browser-warning': '1',
        'Content-Type': 'application/json',
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const data = await new Promise((resolve, reject) => {
      const r = lib.request(options, (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => resolve({ status: resp.statusCode, body: d }));
      });
      r.on('error', reject);
      if (bodyStr) r.write(bodyStr);
      r.end();
    });

    res.status(data.status);
    try { res.json(JSON.parse(data.body)); }
    catch { res.send(data.body); }

  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

// Wajib login (sesi cookie) — lihat api/_lib/session.js
module.exports = require('../../lib/session').withAuth(module.exports);
