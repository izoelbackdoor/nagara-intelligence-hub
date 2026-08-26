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

function product(overrides) {
  return Object.assign({
    id: 'rec', createdTime: '2026-07-21T00:00:00.000Z', name: 'X',
    businessUnit: 'NADI', type: '', status: 'Idea', features: '', techStack: '',
    link: '', notes: '', validationStatus: 'Akan Datang', kriteriaNaikStatus: '',
    tanggalReview: '2026-11-25',
  }, overrides || {});
}

test('groupByValidationStatus buckets blank validationStatus as Belum Ditentukan', () => {
  const groups = PortfolioData.groupByValidationStatus([
    product({ validationStatus: 'Aktif' }),
    product({ validationStatus: '' }),
    product({ validationStatus: 'Akan Datang' }),
  ]);
  assert.equal(groups['Aktif'].length, 1);
  assert.equal(groups['Belum Ditentukan'].length, 1);
  assert.equal(groups['Akan Datang'].length, 1);
  assert.equal(groups['Arsip'].length, 0);
});

test('groupByStatus buckets by the Status field', () => {
  const groups = PortfolioData.groupByStatus([
    product({ status: 'Idea' }),
    product({ status: 'Needs Info' }),
    product({ status: 'Needs Info' }),
  ]);
  assert.equal(groups['Idea'].length, 1);
  assert.equal(groups['Needs Info'].length, 2);
  assert.equal(groups['On Hold'].length, 0);
});

test('daysSince computes whole days between createdTime and now', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const days = PortfolioData.daysSince('2026-07-21T02:20:34.000Z', now);
  assert.equal(days, 35);
});

test('daysSince returns null for a missing or invalid date instead of NaN', () => {
  assert.equal(PortfolioData.daysSince(''), null);
  assert.equal(PortfolioData.daysSince(undefined), null);
  assert.equal(PortfolioData.daysSince('not-a-date'), null);
});

test('daysUntil computes whole days between now and a future date, rounding up', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const days = PortfolioData.daysUntil('2026-11-25', now);
  assert.equal(days, 91);
});

test('daysUntil returns null for a missing or invalid date instead of NaN', () => {
  assert.equal(PortfolioData.daysUntil(''), null);
  assert.equal(PortfolioData.daysUntil(undefined), null);
  assert.equal(PortfolioData.daysUntil('not-a-date'), null);
});

test('aggregateOverview counts aktif, akanDatang, belumDitentukan, and liveDeployed independently', () => {
  const counts = PortfolioData.aggregateOverview([
    product({ validationStatus: 'Aktif', status: 'Live/Deployed' }),
    product({ validationStatus: 'Aktif', status: 'In Progress' }),
    product({ validationStatus: 'Akan Datang', status: 'Idea' }),
    product({ validationStatus: '', status: 'Needs Info' }),
  ]);
  assert.equal(counts.aktif, 2);
  assert.equal(counts.akanDatang, 1);
  assert.equal(counts.belumDitentukan, 1);
  assert.equal(counts.liveDeployed, 1);
});

test('unitCounts merges NADI Client Portfolio into NADI and includes zero-count units', () => {
  const counts = PortfolioData.unitCounts([
    product({ businessUnit: 'NADI' }),
    product({ businessUnit: 'NADI Client Portfolio' }),
    product({ businessUnit: 'NGI Internal' }),
  ]);
  assert.equal(counts['NADI'], 2);
  assert.equal(counts['NGI Internal'], 1);
  assert.equal(counts['Foam & Fold'], 0);
  assert.equal(counts['Tukang Nagara'], 0);
  assert.equal(counts['Es Batu Kristal'], 0);
});

test('unitHealth is neutral when a unit has no products', () => {
  assert.equal(PortfolioData.unitHealth([], 'Foam & Fold'), 'neutral');
});

test('unitHealth ignores products from other business units', () => {
  const products = [product({ businessUnit: 'NGI Internal', status: 'On Hold' }), product({ businessUnit: 'NADI', status: 'Idea' })];
  assert.equal(PortfolioData.unitHealth(products, 'NADI'), 'green');
});

test('unitHealth applies the NADI Client Portfolio merge', () => {
  const products = [product({ businessUnit: 'NADI Client Portfolio', status: 'On Hold' })];
  assert.equal(PortfolioData.unitHealth(products, 'NADI'), 'red');
});

test('unitHealth is red if any product in the unit is On Hold', () => {
  const products = [product({ businessUnit: 'NADI', status: 'On Hold' }), product({ businessUnit: 'NADI', status: 'Idea' })];
  assert.equal(PortfolioData.unitHealth(products, 'NADI'), 'red');
});

test('unitHealth is yellow if any product is Needs Info and none are On Hold', () => {
  const products = [product({ businessUnit: 'NADI', status: 'Needs Info' }), product({ businessUnit: 'NADI', status: 'Idea' })];
  assert.equal(PortfolioData.unitHealth(products, 'NADI'), 'yellow');
});

test('unitHealth is green when all products are Idea/In Progress/Live-Deployed', () => {
  const products = [product({ businessUnit: 'NGI Internal', status: 'Idea' }), product({ businessUnit: 'NGI Internal', status: 'Live/Deployed' })];
  assert.equal(PortfolioData.unitHealth(products, 'NGI Internal'), 'green');
});

test('modeDate returns the most frequent non-empty tanggalReview value', () => {
  const products = [
    product({ tanggalReview: '2026-11-25' }),
    product({ tanggalReview: '2026-11-25' }),
    product({ tanggalReview: '' }),
    product({ tanggalReview: '2027-01-01' }),
  ];
  assert.equal(PortfolioData.modeDate(products), '2026-11-25');
});

test('modeDate returns null when no product has a tanggalReview', () => {
  assert.equal(PortfolioData.modeDate([product({ tanggalReview: '' })]), null);
});

test('modeDate breaks a tie by first-seen order', () => {
  const products = [
    product({ tanggalReview: '2027-01-01' }),
    product({ tanggalReview: '2026-11-25' }),
  ];
  assert.equal(PortfolioData.modeDate(products), '2027-01-01');
});
