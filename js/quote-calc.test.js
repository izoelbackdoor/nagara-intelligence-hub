const { test } = require('node:test');
const assert = require('node:assert/strict');
const QC = require('./quote-calc.js');

const S = QC.mergeSettings(null);
const docExample = () => {
  const inp = QC.defaultInputs(S);
  inp.features = { booking: { on: true, complexity: 'menengah' } };
  return inp;
};

test('contoh di panduan: 79 jam termasuk booking 30 jam → harga final Rp 20,5 jt, tier Custom', () => {
  const r = QC.compute(S, docExample());
  assert.equal(r.hours, 79);
  assert.equal(r.featureLines[0].hours, 30); // 20 jam × 1,5
  assert.equal(r.costBase, 79 * 150000 + 800000);
  assert.equal(r.withBuffer, Math.round(12650000 * 1.15));
  assert.equal(r.priceFinal, 20500000);
  assert.equal(r.tier, null);
  assert.equal(r.tierLabel, 'Custom');
  assert.equal(r.offerPrice, 20500000);
  assert.equal(r.belowMinimum, false);
});

test('contoh di panduan: server Shared → tagihan tahunan ±Rp 6,16 jt', () => {
  const r = QC.compute(S, docExample());
  assert.equal(r.recurring.monthlyCost, 50000 + 2 * 150000);
  assert.equal(r.recurring.monthly, 490000);
  assert.equal(r.recurring.annual, 280000);
  assert.equal(r.recurring.totalYearly, 6160000);
});

test('tier = paket terkecil yang harganya ≥ harga final, harga tawar default = harga paket', () => {
  const r = QC.compute(S, QC.defaultInputs(S)); // tanpa fitur: 49 jam + Rp 800 rb
  assert.equal(r.priceFinal, QC.ceilTo((49 * 150000 + 800000) * 1.15 * 1.4, 500000));
  assert.equal(r.priceFinal, 13500000);
  assert.equal(r.tier.key, 'enterprise');
  assert.equal(r.offerPrice, 20000000);
  assert.equal(r.tierRoom, 6500000);
});

test('komponen dimatikan tidak dihitung; jam & biaya tetap bisa diubah per klien', () => {
  const inp = QC.defaultInputs(S);
  Object.keys(inp.components).forEach(k => { inp.components[k].on = false; });
  inp.components.halaman = { on: true, hours: 10, fixed: 0 };
  const r = QC.compute(S, inp);
  assert.equal(r.lines.length, 1);
  assert.equal(r.costBase, 1500000);
  assert.equal(r.priceFinal, QC.ceilTo(1500000 * 1.15 * 1.4, 500000));
  assert.equal(r.tier.key, 'starter');
});

test('harga tawar manual di bawah harga final ditandai belowMinimum', () => {
  const inp = docExample(); inp.offerPrice = 15000000;
  const r = QC.compute(S, inp);
  assert.equal(r.offerPrice, 15000000);
  assert.equal(r.belowMinimum, true);
});

test('tanpa hosting → tidak ada biaya bulanan, domain tetap dihitung', () => {
  const inp = docExample(); inp.server = 'none';
  const r = QC.compute(S, inp);
  assert.equal(r.recurring.monthly, 0);
  assert.equal(r.recurring.totalYearly, 280000);
});

test('clientView tidak membocorkan tarif, jam, biaya dasar, atau margin', () => {
  const inp = docExample();
  const r = QC.compute(S, inp);
  const v = QC.clientView(S, inp, r);
  const json = JSON.stringify(v);
  for (const secret of ['150000', 'hours', 'rate', 'costBase', 'margin', 'buffer', '12650000', 'Meeting', 'Revisi']) {
    assert.ok(!json.includes(secret), `clientView memuat "${secret}"`);
  }
  assert.equal(v.price, 20500000);
  assert.equal(v.packageName, 'Paket Custom');
  assert.ok(v.scope.some(g => g.items.includes('Fitur: Booking / reservasi')));
});

test('mergeSettings menolak nilai rusak dan menjaga urutan tier', () => {
  const s = QC.mergeSettings({ rate: 'abc', buffer: -1, tiers: [{ name: 'B', price: 9e6 }, { name: 'A', price: 3e6 }, { name: 'X', price: 0 }], components: [{ id: 'a b', name: 'Tes', hours: 5000, group: 'Asing' }] });
  assert.equal(s.rate, 150000);
  assert.equal(s.buffer, 0);
  assert.deepEqual(s.tiers.map(t => t.name), ['A', 'B']);
  assert.equal(s.components[0].id, 'a_b');
  assert.equal(s.components[0].hours, 1000);
  assert.equal(s.components[0].group, 'Lainnya');
});

test('formatRp memakai titik ribuan', () => {
  assert.equal(QC.formatRp(20500000), 'Rp 20.500.000');
  assert.equal(QC.formatJt(6160000), 'Rp 6,16 jt');
});
