// api/inbox/send-email.js — kirim email via SMTP (nodemailer) + simpan ke Airtable
const nodemailer = require('nodemailer')
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { emailTo, pesan, namaKontak, subject, fileData, fileName, fileMime } = req.body || {}
    if (!emailTo) return res.status(400).json({ error: 'emailTo wajib diisi' })
    if (!pesan && !fileData) return res.status(400).json({ error: 'pesan atau file wajib diisi' })

    const SMTP_HOST = process.env.EMAIL_SMTP_HOST || ''
    const SMTP_PORT = parseInt(process.env.EMAIL_SMTP_PORT || '587')
    const SMTP_USER = process.env.EMAIL_SMTP_USER || ''
    const SMTP_PASS = process.env.EMAIL_SMTP_PASS || ''
    const FROM     = process.env.EMAIL_FROM || SMTP_USER || 'noreply@nagara-digital.id'

    const AIRTABLE_TOKEN = process.env.AIRTABLE_API_KEY || ''
    const BASE_ID  = process.env.AIRTABLE_BASE_ID || ''
    const CONVOS   = process.env.AIRTABLE_CONVERSATIONS_TABLE || ''

    let statusKirim = 'Terkirim'
    let sendError = null

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      statusKirim = 'Tersimpan (Email belum dikonfigurasi)'
      sendError = 'SMTP belum dikonfigurasi. Pesan tersimpan di Airtable.'
    } else {
      try {
        const transporter = nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_PORT === 465,
          auth: { user: SMTP_USER, pass: SMTP_PASS },
        })
        const attachments = []
        if (fileData && fileName) {
          attachments.push({ filename: fileName, content: Buffer.from(fileData, 'base64'), contentType: fileMime || 'application/octet-stream' })
        }
        const bodyText = pesan || ''
        await transporter.sendMail({
          from: `Nagara Digital Indonesia <${FROM}>`,
          to: emailTo,
          subject: subject || `Pesan dari Nagara Digital Indonesia`,
          text: bodyText,
          html: `<div style="font-family:sans-serif;max-width:600px;">${bodyText.replace(/\n/g,'<br>')}<br><br><hr style="border:none;border-top:1px solid #eee;"><small style="color:#999;">Nagara Digital Indonesia — nagara-digital.id</small></div>`,
          attachments,
        })
        console.log('[send-email] terkirim ke', emailTo)
      } catch (e) {
        statusKirim = 'Gagal'
        sendError = e.message
        console.error('[send-email] error:', e.message)
      }
    }

    // Simpan ke Airtable Conversations (non-blocking)
    if (BASE_ID && CONVOS && AIRTABLE_TOKEN) {
      try {
        await httpsPost(
          'api.airtable.com',
          `/v0/${BASE_ID}/${CONVOS}`,
          { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          {
            records: [{
              fields: {
                'ID Percakapan': `${emailTo}-${Date.now()}`,
                'Nama Kontak': namaKontak || emailTo,
                'Email Kontak': emailTo,
                'Tanggal': new Date().toISOString(),
                'Channel': 'Email',
                'Arah': 'Keluar',
                'Isi Pesan': pesan || (fileName ? `[File: ${fileName}]` : ''),
                'Status Kirim': statusKirim,
              }
            }],
            typecast: true
          }
        )
      } catch (e) {
        console.error('[send-email] airtable save failed:', e.message)
      }
    }

    const ok = statusKirim === 'Terkirim' || statusKirim.startsWith('Tersimpan')
    return res.json({ ok, status: statusKirim, error: sendError, smtpConfigured: !!(SMTP_HOST && SMTP_USER) })

  } catch (err) {
    console.error('[send-email] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// Wajib login (sesi cookie) — lihat api/_lib/session.js
module.exports = require('../_lib/session').withAuth(module.exports);
