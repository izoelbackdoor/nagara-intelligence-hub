// api/inbox/ai-draft.js
const fs   = require('fs')
const path = require('path')

const KB_DIR = path.join(process.cwd(), 'kb')

function readKBFile(filename) {
  try { return fs.readFileSync(path.join(KB_DIR, filename), 'utf8') } catch { return '' }
}

function selectKBContext(pesan) {
  const lower = (pesan || '').toLowerCase()
  const parts = []
  const isHarga    = /harga|biaya|tarif|paket|bayar|berapa/.test(lower)
  const isFitur    = /fitur|bisa|integrasi|sistem|fungsi|cara/.test(lower)
  const isProposal = /proposal|penawaran|kerjasama/.test(lower)
  if (isHarga)               parts.push(`## Pricing\n${readKBFile('pricing.md')}`)
  if (isFitur || isProposal) parts.push(`## Product Brief\n${readKBFile('product-brief.md')}`)
  if (!isHarga && !isFitur && !isProposal) parts.push(`## FAQ\n${readKBFile('faq.md')}`)
  parts.push(`## SOP Balasan\n${readKBFile('sop-reply.md')}`)
  return parts.join('\n\n---\n\n')
}

const CATEGORY_CONTEXT = {
  'Bank & Keuangan': 'BPR atau lembaga keuangan yang butuh solusi digital: sistem perbankan, laporan OJK, website profesional untuk meningkatkan kepercayaan nasabah.',
  'Klinik & Kesehatan': 'Klinik atau fasilitas kesehatan yang butuh sistem antrian online, rekam medis digital, dan website untuk menjangkau pasien lebih luas.',
  'Travel Umroh & Haji': 'Agen travel umroh/haji yang butuh website booking jamaah, sistem manajemen paket, dan kehadiran digital yang profesional.',
  'Coffee Shop': 'Kedai kopi yang butuh website menu digital, sistem pre-order, dan kehadiran online untuk menarik pelanggan baru.',
  'Restoran': 'Restoran/kuliner yang butuh website, sistem reservasi online, dan katalog menu digital.',
  'Olahraga & Fitness': 'Fasilitas olahraga/gym yang butuh sistem booking lapangan, membership online, dan jadwal kelas digital.',
  'Salon & Barber': 'Salon atau barbershop yang butuh booking online, portofolio karya, dan profil bisnis digital.',
  'Spa & Massage': 'Spa yang butuh website profesional, booking treatment online, dan paket promo digital.',
  'Hotel & Penginapan': 'Hotel/penginapan yang butuh sistem reservasi online, galeri kamar, dan integrasi ulasan tamu.',
  'Kost & Apartemen': 'Bisnis kost/apartemen yang butuh listing properti digital dan sistem booking kamar.',
  'Pendidikan': 'Lembaga pendidikan yang butuh website profil, PPDB online, portal siswa, dan sistem informasi akademik.',
  'Perkantoran': 'Perusahaan/kantor yang butuh website profesional dan company profile digital.',
  'Lainnya': 'Bisnis yang butuh solusi digital untuk meningkatkan kehadiran online dan operasional.',
}

function getCategoryContext(kategori) {
  if (!kategori) return CATEGORY_CONTEXT['Lainnya']
  const key = Object.keys(CATEGORY_CONTEXT).find(k =>
    kategori.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(kategori.toLowerCase())
  )
  return CATEGORY_CONTEXT[key] || CATEGORY_CONTEXT['Lainnya']
}

async function callClaude(systemPrompt, userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.content[0].text
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { pesan, mode = 'reply', contactData = {}, channel = 'WA' } = req.body || {}

    const kategori = contactData.kategori || ''
    const catContext = getCategoryContext(kategori)
    const contactContext = contactData.nama
      ? `Nama: ${contactData.nama}\nKategori Bisnis: ${kategori}\nKota: ${contactData.kota || '-'}`
      : 'Kontak baru.'

    // ── Mode SAPAAN: buat 3 variasi pesan pembuka ──
    if (mode === 'sapaan') {
      const systemPrompt = `Kamu adalah tim sales profesional dari Nagara Digital Indonesia (NADI), perusahaan jasa pembuatan website dan aplikasi digital untuk bisnis di Indonesia.

## Profil Kontak
${contactContext}

## Konteks Bisnis Mereka
${catContext}

Buat 3 variasi pesan WhatsApp pembuka/sapaan pertama kali ke calon klien ini.
Format WAJIB:
Variasi 1:
[isi pesan gaya formal]

Variasi 2:
[isi pesan gaya semi-formal]

Variasi 3:
[isi pesan gaya santai/hangat]

Aturan:
- Sebutkan nama bisnis/kontak mereka
- Perkenalkan Nagara Digital Indonesia secara singkat
- Jelaskan value yang relevan dengan kategori bisnis mereka
- Maksimal 4-5 kalimat per variasi
- Bahasa Indonesia natural, tidak kaku
- Akhiri dengan pertanyaan atau ajakan singkat`

      const draft = await callClaude(systemPrompt, `Buat 3 variasi sapaan WA untuk: ${contactData.nama || 'bisnis'} (${kategori}, ${contactData.kota || 'Indonesia'})`)
      return res.json({ draft, mode: 'sapaan' })
    }

    // ── Mode REPLY: balas pesan masuk ──
    if (!pesan) return res.status(400).json({ error: 'Missing pesan' })

    const kbContext = selectKBContext(pesan)
    const systemPrompt = `Kamu adalah asisten bisnis profesional dari Nagara Digital Indonesia (NADI).

## Profil Kontak
${contactContext}

## Konteks Bisnis Mereka
${catContext}

## Knowledge Base Nagara
${kbContext}

Instruksi:
- Balas dalam Bahasa Indonesia yang profesional namun hangat
- Jawab langsung pertanyaan/kebutuhan mereka
- Maksimal 3-4 paragraf pendek
- Sebutkan nama bisnis mereka jika ada
- Jangan buat janji di luar knowledge base
- Akhiri dengan ajakan tindakan spesifik`

    const draft = await callClaude(systemPrompt, `Pesan dari kontak (${channel}):\n"${pesan}"`)
    return res.json({ draft, mode: 'reply' })

  } catch (err) {
    console.error('[ai-draft] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// Wajib login (sesi cookie) — lihat api/_lib/session.js
module.exports = require('../../lib/session').withAuth(module.exports);
