// api/inbox/webhook-wa.js — terima pesan masuk dari Fonnte, simpan ke Airtable
const https = require('https')

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) }
    }, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: { raw: data } }) }
      })
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'GET') {
    // Health check / Fonnte verification
    return res.status(200).json({ status: 'ok', service: 'nagara-wa-webhook' })
  }
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const body = req.body || {}
    console.log('[webhook-wa] incoming:', JSON.stringify(body))

    // Fonnte webhook payload fields
    const sender  = body.sender  || body.from || ''
    const message = body.message || body.text || body.pesan || ''
    const name    = body.name    || body.pushname || sender
    const device  = body.device  || ''

    if (!sender || !message) {
      return res.status(200).json({ status: 'ignored', reason: 'no sender or message' })
    }

    // Normalize nomor: pastikan format 628x
    const noWA = sender.replace(/[^0-9]/g, '').replace(/^0/, '62')

    const AIRTABLE_TOKEN = process.env.AIRTABLE_API_KEY || ''
    const BASE_ID        = process.env.AIRTABLE_BASE_ID || ''
    const CONVOS         = process.env.AIRTABLE_CONVERSATIONS_TABLE || ''

    if (BASE_ID && CONVOS && AIRTABLE_TOKEN) {
      const atRes = await httpsPost(
        'api.airtable.com',
        `/v0/${BASE_ID}/${CONVOS}`,
        { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        {
          records: [{
            fields: {
              'ID Percakapan': `${noWA}-${Date.now()}`,
              'Nama Kontak': name || noWA,
              'No WA': noWA,
              'Tanggal': new Date().toISOString(),
              'Channel': 'WA',
              'Arah': 'Masuk',
              'Isi Pesan': message,
              'Status Kirim': 'Diterima',
            }
          }],
          typecast: true
        }
      )
      if (atRes.status !== 200) {
        console.error('[webhook-wa] airtable error:', atRes.status, JSON.stringify(atRes.body))
      } else {
        console.log('[webhook-wa] saved, id:', atRes.body?.records?.[0]?.id, 'from:', noWA)
      }
    }

    // Teruskan ke CRM Command Center: riwayat percakapan, status "membalas", STOP → jangan hubungi
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try { await require('../../lib/inbound').handleInbound({ wa: noWA, text: message, channel: 'fonnte', meta: { source: 'fonnte', device } }) }
      catch (e) { console.error('[webhook-wa] crm error:', e.message) }
    }

    return res.status(200).json({ status: 'ok' })
  } catch (err) {
    console.error('[webhook-wa] error:', err.message)
    return res.status(200).json({ status: 'error', message: err.message })
  }
}
