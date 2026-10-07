/**
 * Nagara — Airtable Proxy
 * Semua request Airtable dari frontend lewat sini,
 * sehingga token tidak perlu ada di HTML/localStorage.
 *
 * GET  /api/airtable/proxy?table=Contacts&...params
 * POST /api/airtable/proxy?table=Contacts
 * PATCH/DELETE juga didukung
 */

const https = require('https');

const TOKEN   = process.env.AIRTABLE_TOKEN   || '';
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appvbSejYUoQODvDT';

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type':  'application/json',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request({
      hostname: 'api.airtable.com',
      path,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not configured' });

  const table    = req.query.table;
  const recordId = req.query.recordId || '';
  const baseId   = req.query.baseId   || BASE_ID;
  if (!table) return res.status(400).json({ error: 'table param required' });

  // Build Airtable URL path
  let basePath = `/v0/${baseId}/${encodeURIComponent(table)}`;
  if (recordId) basePath += `/${recordId}`;

  // Forward raw query string — exclude proxy-only params (table, recordId, baseId)
  // Use raw query string from URL to preserve bracket notation (sort[0][field]) intact
  const rawUrl = new URL(req.url, 'http://localhost');
  const fwd = new URLSearchParams();
  const skip = new Set(['table', 'recordId', 'baseId']);
  rawUrl.searchParams.forEach((v, k) => { if (!skip.has(k)) fwd.append(k, v); });
  const qs = fwd.toString();
  const fullPath = qs ? `${basePath}?${qs}` : basePath;

  // Prevent Vercel CDN from caching proxy responses (avoids stale 304s)
  res.setHeader('Cache-Control', 'no-store');

  try {
    const result = await airtableRequest(req.method, fullPath, req.body || null);
    res.status(result.status).json(result.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

// Wajib login (sesi cookie) — lihat api/_lib/session.js
module.exports = require('../_lib/session').withAuth(module.exports);
