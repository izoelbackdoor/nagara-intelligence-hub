const { test } = require('node:test');
const assert = require('node:assert/strict');
const { triage } = require('./helpdesk.js');

const cases = [
  ['Mas, website kami tidak bisa dibuka sejak pagi', 'teknis', 'urgent'],
  ['web nya down dari tadi', 'teknis', 'urgent'],
  ['Website kami tidak bisa dibuka sejak pagi, pelanggan komplain', 'teknis', 'urgent'],
  ['Form kontak error, pelanggan komplain', 'teknis', 'tinggi'],
  ['Situs toko gak bisa diakses', 'teknis', 'urgent'],
  ['pembayaran di checkout gagal terus', 'teknis', 'urgent'],
  ['website kena hack, isinya berubah', 'pertanyaan', 'urgent'],
  ['Tidak bisa login ke admin', 'teknis', 'tinggi'],
  ['Halaman produk lemot sekali', 'teknis', 'tinggi'],
  ['Saya kecewa, revisinya belum juga dikerjakan', 'keluhan', 'tinggi'],
  ['Minta invoice bulan ini ya', 'tagihan', 'normal'],
  ['Bisa ditambah menu galeri?', 'permintaan_fitur', 'rendah'],
  ['Jam berapa meeting besok?', 'pertanyaan', 'normal'],
  ['Tolong ganti foto banner, segera ya', 'pertanyaan', 'tinggi'],
];
for (const [text, category, priority] of cases) {
  test(`triase: "${text}" → ${category}/${priority}`, () => {
    assert.deepEqual(triage(text), { category, priority });
  });
}
