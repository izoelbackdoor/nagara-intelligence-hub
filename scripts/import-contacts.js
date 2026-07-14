#!/usr/bin/env node
// Import semua kontak dari per_kategori/*.csv ke Airtable Nagara CRM
// Usage: node scripts/import-contacts.js

const fs = require('fs')
const path = require('path')

const AIRTABLE_TOKEN = 'AIRTABLE_PAT_ISI_DI_ENV'
const BASE_ID = 'apprX0HpneI5lcqOP'
const TABLE_ID = 'tbl7HTgx2LtFt6j9V'
const DATA_DIR = path.join(__dirname, '../../Data/per_kategori')

const BATCH_SIZE = 10
const DELAY_MS = 300

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i])
    if (vals.length < 2) continue
    const row = {}
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] || '').replace(/^"|"$/g, '').trim()
    })
    rows.push(row)
  }
  return rows
}

function splitCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQuotes = !inQuotes }
    else if (c === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += c }
  }
  result.push(current)
  return result
}

function normalizeWA(noWA) {
  if (!noWA) return ''
  let n = noWA.replace(/\D/g, '')
  if (n.startsWith('0')) n = '62' + n.slice(1)
  if (!n.startsWith('62')) n = '62' + n
  return n
}

function mapRecord(row) {
  const noWA = normalizeWA(row['No WA'] || '')
  if (!noWA || noWA.length < 8) return null

  const catatan = [
    row['Website'] ? `Website: ${row['Website']}` : '',
    row['Rating'] ? `Rating: ${row['Rating']}` : '',
    row['Prospek'] ? `Prospek: ${row['Prospek']}` : '',
  ].filter(Boolean).join(' | ')

  return {
    fields: {
      'Nama': row['Nama'] || row['nama'] || '',
      'No WA': noWA,
      'Kota': row['Kota'] || row['kota'] || '',
      'Kategori Blast': row['Kategori'] || row['kategori'] || '',
      'Catatan': catatan,
    }
  }
}

async function createBatch(records) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records, typecast: true }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data.error || data))
  return data.records
}

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'))
  console.log(`Membaca ${files.length} file CSV dari ${DATA_DIR}`)

  const allRecords = []
  const seenWA = new Set()

  for (const file of files) {
    const rows = parseCSV(path.join(DATA_DIR, file))
    console.log(`  ${file}: ${rows.length} baris`)

    for (const row of rows) {
      const rec = mapRecord(row)
      if (!rec) continue
      const wa = rec.fields['No WA']
      if (seenWA.has(wa)) continue
      seenWA.add(wa)
      allRecords.push(rec)
    }
  }

  console.log(`\nTotal unik setelah deduplikasi: ${allRecords.length} kontak`)
  console.log(`Estimasi batch: ${Math.ceil(allRecords.length / BATCH_SIZE)}`)

  let imported = 0
  let errors = 0

  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE)
    try {
      await createBatch(batch)
      imported += batch.length
      process.stdout.write(`\r[${imported}/${allRecords.length}] imported...`)
    } catch (err) {
      errors++
      console.error(`\nError batch ${i/BATCH_SIZE + 1}:`, err.message)
    }
    await sleep(DELAY_MS)
  }

  console.log(`\n\nSelesai! Imported: ${imported}, Error: ${errors}`)
}

main().catch(console.error)
