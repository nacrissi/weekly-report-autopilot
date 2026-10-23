// Loads a week's worth of generated CSVs into the shape validate.js and
// metrics.js expect. Node-only glue; the core stays pure.

const path = require('path');
const { readCsv } = require('./csv');
const { priorWeekOf } = require('../generate-data');

const SOURCE_FILES = {
  sellout: 'sellout',
  goals: 'goals',
  inventory: 'inventory',
  storeVisits: 'store-visits',
  trainingCompletion: 'training-completion',
  staffing: 'staffing'
};

function loadWeekBundle(dataDir, week) {
  const priorWeek = priorWeekOf(week, 1);
  const stores = readCsv(path.join(dataDir, 'stores.csv')) || [];

  const sources = {};
  for (const [name, prefix] of Object.entries(SOURCE_FILES)) {
    sources[name] = {
      rows: readCsv(path.join(dataDir, prefix + '-' + week + '.csv')),
      priorRows: readCsv(path.join(dataDir, prefix + '-' + priorWeek + '.csv'))
    };
  }

  const salesHistory = [];
  for (let back = 5; back >= 0; back--) {
    const w = priorWeekOf(week, back);
    salesHistory.push({ week: w, rows: readCsv(path.join(dataDir, 'sellout-' + w + '.csv')) || [] });
  }

  return { week, priorWeek, stores, sources, salesHistory };
}

function toValidateInput(bundle) {
  return { week: bundle.week, priorWeek: bundle.priorWeek, stores: bundle.stores, sources: bundle.sources };
}

function toMetricsInput(bundle) {
  const s = bundle.sources;
  return {
    week: bundle.week,
    priorWeek: bundle.priorWeek,
    stores: bundle.stores,
    sellout: s.sellout.rows || [],
    priorSellout: s.sellout.priorRows || [],
    goals: s.goals.rows || [],
    inventory: s.inventory.rows || [],
    storeVisits: s.storeVisits.rows || [],
    trainingCompletion: s.trainingCompletion.rows || [],
    staffing: s.staffing.rows || [],
    salesHistory: bundle.salesHistory
  };
}

module.exports = { loadWeekBundle, toValidateInput, toMetricsInput, SOURCE_FILES };
