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

  var PortfolioData = {
    FIELD: FIELD,
    VALIDATION_COLUMNS: VALIDATION_COLUMNS,
    STATUS_COLUMNS: STATUS_COLUMNS,
    BUSINESS_UNITS: BUSINESS_UNITS,
    parseRecord: parseRecord,
    parseRecords: parseRecords,
    mergedBusinessUnit: mergedBusinessUnit,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PortfolioData;
  } else {
    root.PortfolioData = PortfolioData;
  }
})(typeof window !== 'undefined' ? window : globalThis);
