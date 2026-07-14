// api/inbox/_airtable.js
const BASE_URL = 'https://api.airtable.com/v0'
const TOKEN    = process.env.AIRTABLE_API_KEY
const BASE_ID  = process.env.AIRTABLE_BASE_ID
const CONTACTS = process.env.AIRTABLE_CONTACTS_TABLE || 'tbla9UsOMOJmx3cDM'
const CONVOS   = process.env.AIRTABLE_CONVERSATIONS_TABLE || 'tblTtYstViq4WdqN3'

if (!TOKEN) throw new Error('[_airtable] AIRTABLE_API_KEY tidak di-set')
if (!BASE_ID) throw new Error('[_airtable] AIRTABLE_BASE_ID tidak di-set')

function escapeFormula(val) {
  return String(val || '').replace(/'/g, "\\'")
}

async function airtableFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}/${BASE_ID}/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Airtable ${res.status}: ${err}`)
  }
  return res.json()
}

async function getInboxContacts() {
  const data = await airtableFetch(
    `${CONTACTS}?sort[0][field]=Terakhir%20Dihubungi&sort[0][direction]=desc&maxRecords=100`
  )
  return (data.records || []).map(r => ({
    id: r.id,
    nama: r.fields['Nama'] || '',
    noWA: r.fields['No WA'] || '',
    email: r.fields['Email Kontak'] || '',
    perusahaan: r.fields['Perusahaan / Bisnis'] || '',
    status: r.fields['Status'] || 'Baru',
    kota: r.fields['Kota'] || '',
    catatan: r.fields['Catatan'] || '',
    lastContact: r.fields['Terakhir Dihubungi'] || '',
    autoReply: r.fields['auto_reply'] || false,
    kategori: r.fields['Kategori Blast'] || r.fields['Segmen'] || r.fields['Industri'] || 'Lainnya',
  }))
}

async function getMessages(identifier, type = 'wa') {
  const field = type === 'wa' ? 'No WA' : 'Email Kontak'
  const formula = encodeURIComponent(`{${field}} = '${escapeFormula(identifier)}'`)
  const data = await airtableFetch(
    `${CONVOS}?filterByFormula=${formula}&sort[0][field]=Tanggal&sort[0][direction]=asc&maxRecords=100`
  )
  return (data.records || []).map(r => ({
    id: r.id,
    namaKontak: r.fields['Nama Kontak'] || '',
    noWA: r.fields['No WA'] || '',
    email: r.fields['Email Kontak'] || '',
    tanggal: r.fields['Tanggal'] || '',
    channel: r.fields['Channel'] || 'WA',
    arah: r.fields['Arah'] || 'Masuk',
    isiPesan: r.fields['Isi Pesan'] || '',
    statusKirim: r.fields['Status Kirim'] || '-',
  }))
}

async function saveMessage({ noWA, email, namaKontak, channel, arah, isiPesan, statusKirim = '-' }) {
  const idPercakapan = `${noWA || email}-${Date.now()}`
  return await airtableFetch(CONVOS, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'ID Percakapan': idPercakapan,
        'Nama Kontak': namaKontak || noWA || email,
        'No WA': noWA || '',
        'Email Kontak': email || '',
        'Tanggal': new Date().toISOString(),
        'Channel': channel,
        'Arah': arah,
        'Isi Pesan': isiPesan,
        'Status Kirim': statusKirim,
      }
    })
  })
}

async function findContactByWA(noWA) {
  const formula = encodeURIComponent(`{No WA} = '${escapeFormula(noWA)}'`)
  const data = await airtableFetch(`${CONTACTS}?filterByFormula=${formula}&maxRecords=1`)
  const r = (data.records || [])[0]
  if (!r) return null
  return {
    id: r.id,
    nama: r.fields['Nama'] || '',
    noWA: r.fields['No WA'] || '',
    email: r.fields['Email Kontak'] || '',
    perusahaan: r.fields['Perusahaan / Bisnis'] || '',
    status: r.fields['Status'] || 'Baru',
    kota: r.fields['Kota'] || '',
    catatan: r.fields['Catatan'] || '',
    autoReply: r.fields['auto_reply'] || false,
  }
}

async function findContactByEmail(email) {
  const formula = encodeURIComponent(`{Email Kontak} = '${escapeFormula(email)}'`)
  const data = await airtableFetch(`${CONTACTS}?filterByFormula=${formula}&maxRecords=1`)
  const r = (data.records || [])[0]
  if (!r) return null
  return {
    id: r.id,
    nama: r.fields['Nama'] || '',
    noWA: r.fields['No WA'] || '',
    email: r.fields['Email Kontak'] || '',
    perusahaan: r.fields['Perusahaan / Bisnis'] || '',
    status: r.fields['Status'] || 'Baru',
    kota: r.fields['Kota'] || '',
    catatan: r.fields['Catatan'] || '',
    autoReply: r.fields['auto_reply'] || false,
  }
}

async function updateContact(contactId, { status, catatan } = {}) {
  const fields = { 'Terakhir Dihubungi': new Date().toISOString().split('T')[0] }
  if (status) fields['Status'] = status
  if (catatan) fields['Catatan'] = catatan
  await airtableFetch(`${CONTACTS}/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  })
}

module.exports = { getInboxContacts, getMessages, saveMessage, findContactByWA, findContactByEmail, updateContact }
