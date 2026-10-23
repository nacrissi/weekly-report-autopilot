const test = require('node:test');
const assert = require('node:assert/strict');
const { fmtUsdShort, renderInventoryFootnote, pluralizeWord, renderDeckHtml } = require('../src/demo/render-html');
const { computeMetrics } = require('../src/core/metrics');
const { validate } = require('../src/core/validate');
const { buildDeckSpec } = require('../src/core/deck-spec');

test('fmtUsdShort formats consistently as thousands with a comma, never mixed with "M"', () => {
  assert.equal(fmtUsdShort(0), '$0');
  assert.equal(fmtUsdShort(343000), '$343K');
  assert.equal(fmtUsdShort(1371000), '$1,371K');
  assert.equal(fmtUsdShort(1228000), '$1,228K');
});

test('renderInventoryFootnote states all stock-out stores are shown, with no em-dash or "(s)"', () => {
  const text = renderInventoryFootnote({
    stockOutRiskCount: 6,
    overstockCount: 17,
    stockOutShown: 6,
    overstockShown: 2,
    shownCount: 8,
    totalFlagged: 23,
    totalStores: 60
  });
  assert.match(text, /all 6 stock-out risk stores/);
  assert.match(text, /2 of 17 overstock stores/);
  assert.match(text, /23 flagged stores out of 60 total/);
  assert.doesNotMatch(text, /—/);
  assert.doesNotMatch(text, /\(s\)/);
});

test('renderInventoryFootnote handles a single flagged store without "all 1 ... stores"', () => {
  const text = renderInventoryFootnote({
    stockOutRiskCount: 1,
    overstockCount: 0,
    stockOutShown: 1,
    overstockShown: 0,
    shownCount: 1,
    totalFlagged: 1,
    totalStores: 60
  });
  assert.match(text, /the 1 stock-out risk store/);
  assert.match(text, /1 flagged store out of 60 total/);
});

test('pluralizeWord picks the singular form only for exactly 1', () => {
  assert.equal(pluralizeWord(1, 'warning'), '1 warning');
  assert.equal(pluralizeWord(2, 'warning'), '2 warnings');
  assert.equal(pluralizeWord(0, 'warning'), '0 warnings');
});

test('the full rendered deck HTML contains no em-dash and no literal "(s)"', () => {
  const stores = [
    { store_id: 'A', store_name: 'Store A', region: 'North' },
    { store_id: 'B', store_name: 'Store B', region: 'South' }
  ];
  const sellout = [
    { week: 'W2', store_id: 'A', sellout_usd: 100 },
    { week: 'W2', store_id: 'B', sellout_usd: 200 }
  ];
  const goals = [
    { week: 'W2', store_id: 'A', goal_usd: 100 },
    { week: 'W2', store_id: 'B', goal_usd: 250 }
  ];
  const metrics = computeMetrics({
    week: 'W2',
    priorWeek: 'W1',
    stores,
    sellout,
    priorSellout: sellout,
    goals,
    inventory: [
      { week: 'W2', store_id: 'A', units_on_hand: 10, avg_weekly_units_sold: 10 },
      { week: 'W2', store_id: 'B', units_on_hand: 100, avg_weekly_units_sold: 5 }
    ],
    storeVisits: [
      { week: 'W2', store_id: 'A', visits_scheduled: 1, visits_completed: 1 },
      { week: 'W2', store_id: 'B', visits_scheduled: 1, visits_completed: 0 }
    ],
    trainingCompletion: [
      { week: 'W2', store_id: 'A', staff_total: 10, staff_trained: 8 },
      { week: 'W2', store_id: 'B', staff_total: 10, staff_trained: 10 }
    ],
    staffing: [
      { week: 'W2', store_id: 'A', positions_required: 10, positions_filled: 5 },
      { week: 'W2', store_id: 'B', positions_required: 10, positions_filled: 10 }
    ],
    salesHistory: [{ week: 'W2', rows: sellout }]
  });
  const validation = validate({
    week: 'W2',
    stores,
    sources: {
      sellout: { rows: sellout, priorRows: sellout },
      goals: { rows: goals, priorRows: goals },
      inventory: { rows: [], priorRows: [] },
      storeVisits: { rows: [], priorRows: [] },
      trainingCompletion: { rows: [], priorRows: [] },
      staffing: { rows: [], priorRows: [] }
    }
  });
  const spec = buildDeckSpec(metrics, validation, { generatedAt: '2026-01-01T00:00:00.000Z' });
  const html = renderDeckHtml(spec);

  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /\(s\)/);
});
