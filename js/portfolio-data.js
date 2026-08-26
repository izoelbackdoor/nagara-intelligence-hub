// Pure data-transformation layer for the Portfolio Produk / Overview pages.
// No DOM, no fetch — kept isolated so it can run under Node's test runner.
// Loaded into index.html via <script src="/js/portfolio-data.js"> and used
// as `window.PortfolioData`. Field names below must match the Airtable
// "Applications" table exactly (verified against the live schema).
(function (root) {
  'use strict';

  var FIELD = {
    NAME: 'App Name',
    BUSINESS_UNIT: 'Business Unit',
    TYPE: 'Type',
    STATUS: 'Status',
    FEATURES: 'Features',
    TECH_STACK: 'Tech Stack',
    LINK: 'Link/URL',
    NOTES: 'Notes / Next Steps',
    VALIDATION_STATUS: 'Validation Status',
    KRITERIA_NAIK_STATUS: 'Kriteria Naik Status',
    TANGGAL_REVIEW: 'Tanggal Review Berikutnya',
  };

  var VALIDATION_COLUMNS = ['Akan Datang', 'Aktif', 'Arsip', 'Belum Ditentukan'];
  var STATUS_COLUMNS = ['Idea', 'In Progress', 'Live/Deployed', 'On Hold', 'Needs Info'];
  var BUSINESS_UNITS = ['NADI', 'Foam & Fold', 'Tukang Nagara', 'Es Batu Kristal', 'NGI Internal'];

  function parseRecord(record) {
    var f = record.fields || {};
    return {
      id: record.id,
      createdTime: record.createdTime,
      name: f[FIELD.NAME] || '(Tanpa nama)',
      businessUnit: f[FIELD.BUSINESS_UNIT] || '',
      type: f[FIELD.TYPE] || '',
      status: f[FIELD.STATUS] || '',
      features: f[FIELD.FEATURES] || '',
      techStack: f[FIELD.TECH_STACK] || '',
      link: f[FIELD.LINK] || '',
      notes: f[FIELD.NOTES] || '',
      validationStatus: f[FIELD.VALIDATION_STATUS] || '',
      kriteriaNaikStatus: f[FIELD.KRITERIA_NAIK_STATUS] || '',
      tanggalReview: f[FIELD.TANGGAL_REVIEW] || '',
    };
  }

  function parseRecords(records) {
    return (records || []).map(parseRecord);
  }

  // `product.businessUnit` keeps the raw Airtable value (e.g. for display on
  // a card/table). Callers that aggregate/count by unit — Overview's per-unit
  // status, health indicator, etc. — should pass it through mergedBusinessUnit
  // first, since "NADI Client Portfolio" is folded into "NADI" for those views.
  function mergedBusinessUnit(businessUnit) {
    if (businessUnit === 'NADI Client Portfolio') return 'NADI';
    return businessUnit;
  }

  function validationColumn(product) {
    return product.validationStatus || 'Belum Ditentukan';
  }

  function groupByValidationStatus(products) {
    var groups = { 'Akan Datang': [], 'Aktif': [], 'Arsip': [], 'Belum Ditentukan': [] };
    products.forEach(function (p) {
      var col = validationColumn(p);
      if (!groups[col]) groups[col] = [];
      groups[col].push(p);
    });
    return groups;
  }

  function groupByStatus(products) {
    var groups = { 'Idea': [], 'In Progress': [], 'Live/Deployed': [], 'On Hold': [], 'Needs Info': [] };
    products.forEach(function (p) {
      var col = p.status || 'Lainnya';
      if (!groups[col]) groups[col] = [];
      groups[col].push(p);
    });
    return groups;
  }

  function daysSince(isoDate, now) {
    now = now || new Date();
    var then = new Date(isoDate);
    var diffMs = now.getTime() - then.getTime();
    return Math.max(0, Math.floor(diffMs / 86400000));
  }

  function daysUntil(isoDate, now) {
    now = now || new Date();
    var target = new Date(isoDate);
    var diffMs = target.getTime() - now.getTime();
    return Math.ceil(diffMs / 86400000);
  }

  function aggregateOverview(products) {
    var counts = { aktif: 0, akanDatang: 0, liveDeployed: 0, belumDitentukan: 0 };
    products.forEach(function (p) {
      var col = validationColumn(p);
      if (col === 'Aktif') counts.aktif++;
      if (col === 'Akan Datang') counts.akanDatang++;
      if (col === 'Belum Ditentukan') counts.belumDitentukan++;
      if (p.status === 'Live/Deployed') counts.liveDeployed++;
    });
    return counts;
  }

  function unitCounts(products) {
    var counts = {};
    BUSINESS_UNITS.forEach(function (u) { counts[u] = 0; });
    products.forEach(function (p) {
      var unit = mergedBusinessUnit(p.businessUnit);
      if (counts.hasOwnProperty(unit)) counts[unit]++;
    });
    return counts;
  }

  function unitHealth(products, unitName) {
    var unitProducts = products.filter(function (p) {
      return mergedBusinessUnit(p.businessUnit) === unitName;
    });
    if (unitProducts.length === 0) return 'neutral';
    var hasOnHold = unitProducts.some(function (p) { return p.status === 'On Hold'; });
    if (hasOnHold) return 'red';
    var hasNeedsInfo = unitProducts.some(function (p) { return p.status === 'Needs Info'; });
    if (hasNeedsInfo) return 'yellow';
    return 'green';
  }

  function modeDate(products) {
    var counts = {};
    var best = null;
    var bestCount = 0;
    products.forEach(function (p) {
      if (!p.tanggalReview) return;
      counts[p.tanggalReview] = (counts[p.tanggalReview] || 0) + 1;
      if (counts[p.tanggalReview] > bestCount) {
        bestCount = counts[p.tanggalReview];
        best = p.tanggalReview;
      }
    });
    return best;
  }

  var PortfolioData = {
    FIELD: FIELD,
    VALIDATION_COLUMNS: VALIDATION_COLUMNS,
    STATUS_COLUMNS: STATUS_COLUMNS,
    BUSINESS_UNITS: BUSINESS_UNITS,
    parseRecord: parseRecord,
    parseRecords: parseRecords,
    mergedBusinessUnit: mergedBusinessUnit,
    validationColumn: validationColumn,
    groupByValidationStatus: groupByValidationStatus,
    groupByStatus: groupByStatus,
    daysSince: daysSince,
    daysUntil: daysUntil,
    aggregateOverview: aggregateOverview,
    unitCounts: unitCounts,
    unitHealth: unitHealth,
    modeDate: modeDate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PortfolioData;
  } else {
    root.PortfolioData = PortfolioData;
  }
})(typeof window !== 'undefined' ? window : globalThis);
