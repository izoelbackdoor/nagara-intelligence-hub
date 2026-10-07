// api/inbox/send.js — kirim WA via Fonnte + simpan ke Airtable
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

function httpsPostMultipart(hostname, path, authToken, fields, fileBuffer, fileName, fileMime) {
  return new Promise((resolve, reject) => {
    const boundary = '----NagaraBoundary' + Date.now().toString(36)
    const parts = []
    for (const [key, val] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}`))
    }
    const fileHeader = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${fileMime}\r\n\r\n`)
    const closing = Buffer.from(`\r\n--${boundary}--`)
    const bodyBuf = Buffer.concat([...parts.map((p, i) => i === 0 ? p : Buffer.concat([Buffer.from('\r\n'), p])), fileHeader, fileBuffer, closing])

    const req = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      }
    }, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: { raw: data } }) }
      })
    })
    req.on('error', reject)
    req.write(bodyBuf)
    req.end()
  })
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { noWA, pesan, namaKontak, fileData, fileName, fileMime } = req.body || {}
    if (!noWA) return res.status(400).json({ error: 'noWA wajib diisi' })
    if (!pesan && !fileData) return res.status(400).json({ error: 'pesan atau file wajib diisi' })

    const FONNTE_TOKEN = process.env.FONNTE_TOKEN || ''
    const AIRTABLE_TOKEN = process.env.AIRTABLE_API_KEY || ''
    const BASE_ID = process.env.AIRTABLE_BASE_ID || ''
    const CONVOS = process.env.AIRTABLE_CONVERSATIONS_TABLE || ''

    let statusKirim = 'Terkirim'
    let fonnteError = null

    try {
      let result
      if (fileData && fileName) {
        const fileBuffer = Buffer.from(fileData, 'base64')
        const fields = { target: noWA, countryCode: '62' }
        if (pesan) fields.message = pesan
        result = await httpsPostMultipart('api.fonnte.com', '/send', FONNTE_TOKEN, fields, fileBuffer, fileName, fileMime || 'application/octet-stream')
      } else {
        result = await httpsPost(
          'api.fonnte.com', '/send',
          { 'Authorization': FONNTE_TOKEN, 'Content-Type': 'application/json' },
          { target: noWA, message: pesan, countryCode: '62' }
        )
      }
      console.log('[send] fonnte response:', JSON.stringify(result.body))
      if (!result.body.status) {
        statusKirim = 'Gagal'
        fonnteError = result.body.reason || result.body.message || 'Fonnte error'
      }
    } catch (e) {
      statusKirim = 'Gagal'
      fonnteError = e.message
      console.error('[send] fonnte error:', e.message)
    }

    if (BASE_ID && CONVOS && AIRTABLE_TOKEN) {
      try {
        const isiPesan = pesan || (fileName ? `[File: ${fileName}]` : '')
        const atRes = await httpsPost(
          'api.airtable.com',
          `/v0/${BASE_ID}/${CONVOS}`,
          { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          {
            records: [{
              fields: {
                'ID Percakapan': `${noWA}-${Date.now()}`,
                'Nama Kontak': namaKontak || noWA,
                'No WA': noWA,
                'Tanggal': new Date().toISOString(),
                'Channel': 'WA',
                'Arah': 'Keluar',
                'Isi Pesan': isiPesan,
                'Status Kirim': statusKirim,
              }
            }],
            typecast: true
          }
        )
        if (atRes.status !== 200) {
          console.error('[send] airtable save error:', atRes.status, JSON.stringify(atRes.body))
        } else {
          console.log('[send] airtable saved ok, id:', atRes.body?.records?.[0]?.id)
        }
      } catch (e) {
        console.error('[send] airtable save failed:', e.message)
      }
    }

    return res.json({ ok: statusKirim === 'Terkirim', status: statusKirim, error: fonnteError })

  } catch (err) {
    console.error('[send] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// Wajib login (sesi cookie) — lihat api/_lib/session.js
module.exports = require('../_lib/session').withAuth(module.exports);
