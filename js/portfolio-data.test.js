const { test } = require('node:test');
const assert = require('node:assert/strict');
const PortfolioData = require('./portfolio-data.js');

test('parseRecord maps Airtable field names to a flat product object', () => {
  const record = {
    id: 'rec1',
    createdTime: '2026-07-21T02:20:34.000Z',
    fields: {
      'App Name': 'Nagara SmartDocs',
      'Business Unit': 'NADI',
      'Type': 'Exploration/Idea',
      'Status': 'Idea',
      'Validation Status': 'Akan Datang',
      'Features': 'Generate & tandatangani dokumen otomatis',
      'Tech Stack': 'Next.js/TS/Tailwind/shadcn, NestJS, PostgreSQL',
      'Link/URL': 'https://smartdocs.nagara.id',
      'Notes / Next Steps': 'Belum ada pilot customer',
      'Kriteria Naik Status': 'Minimal 1 pilot customer/LOI',
      'Tanggal Review Berikutnya': '2026-11-25',
    },
  };
  const product = PortfolioData.parseRecord(record);
  assert.equal(product.id, 'rec1');
  assert.equal(product.name, 'Nagara SmartDocs');
  assert.equal(product.businessUnit, 'NADI');
  assert.equal(product.status, 'Idea');
  assert.equal(product.validationStatus, 'Akan Datang');
  assert.equal(product.features, 'Generate & tandatangani dokumen otomatis');
  assert.equal(product.techStack, 'Next.js/TS/Tailwind/shadcn, NestJS, PostgreSQL');
  assert.equal(product.link, 'https://smartdocs.nagara.id');
  assert.equal(product.notes, 'Belum ada pilot customer');
  assert.equal(product.tanggalReview, '2026-11-25');
});

test('parseRecord defaults missing fields to empty string, not undefined', () => {
  const product = PortfolioData.parseRecord({ id: 'rec2', createdTime: '2026-07-21T00:00:00.000Z', fields: {} });
  assert.equal(product.businessUnit, '');
  assert.equal(product.status, '');
  assert.equal(product.validationStatus, '');
  assert.equal(product.name, '(Tanpa nama)');
});

test('parseRecords maps a list of Airtable records', () => {
  const records = [
    { id: 'a', createdTime: '2026-01-01T00:00:00.000Z', fields: { 'App Name': 'A' } },
    { id: 'b', createdTime: '2026-01-02T00:00:00.000Z', fields: { 'App Name': 'B' } },
  ];
  const products = PortfolioData.parseRecords(records);
  assert.equal(products.length, 2);
  assert.equal(products[1].name, 'B');
});

test('mergedBusinessUnit folds NADI Client Portfolio into NADI', () => {
  assert.equal(PortfolioData.mergedBusinessUnit('NADI Client Portfolio'), 'NADI');
  assert.equal(PortfolioData.mergedBusinessUnit('NADI'), 'NADI');
  assert.equal(PortfolioData.mergedBusinessUnit('NGI Internal'), 'NGI Internal');
  assert.equal(PortfolioData.mergedBusinessUnit(''), '');
});
