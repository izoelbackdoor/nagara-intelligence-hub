/**
 * Nagara Command Center — OpenWA Webhook Handler
 * Konfigurasi di OpenWA Dashboard:
 *   Webhook URL: https://nagara-intelligence-hub.vercel.app/api/inbox/webhook-openwa
 *   Events: message.any
 */

const https = require('https');

const AIRTABLE_TOKEN    = process.env.AIRTABLE_TOKEN || '';
const AIRTABLE_BASE_ID  = 'apprX0HpneI5lcqOP';   // Nagara CRM base — fixed
const CONVERSATIONS_TBL = 'Conversations';

function airtablePost(path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.airtable.com',
      path,
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'nagara-openwa-webhook' });
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body || {};
    console.log('[webhook-openwa] incoming:', JSON.stringify(body).slice(0, 300));

    // OpenWA event payload format
    // { event: "message.any", session: "default", payload: { id, from, fromMe, body, type, timestamp, ... } }
    const event   = body.event || '';
    const payload = body.payload || body;

    // Hanya proses pesan masuk (bukan dari kita sendiri)
    const fromMe  = payload.fromMe === true;
    if (fromMe) return res.status(200).json({ ok: true, skipped: 'outbound' });

    const from    = (payload.from || payload.sender || '').replace('@c.us', '').replace('@s.whatsapp.net', '');
    const text    = payload.body || payload.text || payload.content?.text || '';
    const name    = payload.notifyName || payload.pushName || from;
    const session = body.session || 'default';
    const msgId   = payload.id || `openwa_${Date.now()}`;

    if (!from) return res.status(200).json({ ok: true, skipped: 'no_sender' });

    // Simpan ke Airtable Conversations
    if (AIRTABLE_TOKEN && AIRTABLE_TOKEN !== '') {
      await airtablePost(`/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(CONVERSATIONS_TBL)}`, {
        fields: {
          'No WA':        from,
          'Nama Kontak':  name,
          'Isi Pesan':    text,
          'Arah':         'Masuk',
          'Tanggal':      new Date().toISOString(),
          'Channel':      'WA',
        }
      });
    }

    return res.status(200).json({ ok: true, from, text: text.slice(0, 50) });
  } catch (e) {
    console.error('[webhook-openwa] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
