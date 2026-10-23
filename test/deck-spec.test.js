const test = require('node:test');
const assert = require('node:assert/strict');
const { computeMetrics } = require('../src/core/metrics');
const { validate } = require('../src/core/validate');
const { buildDeckSpec, SLIDE_TITLES } = require('../src/core/deck-spec');

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

function fixtureMetrics() {
  return computeMetrics({
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
}

function fixtureValidation() {
  return validate({
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
}

test('buildDeckSpec() produces exactly 11 slides with the expected titles in order', () => {
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), { generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(spec.slides.length, 11);
  assert.deepEqual(spec.slides.map((s) => s.title), SLIDE_TITLES);
});

test('buildDeckSpec() is deterministic for the same inputs', () => {
  const a = buildDeckSpec(fixtureMetrics(), fixtureValidation(), { generatedAt: 'X' });
  const b = buildDeckSpec(fixtureMetrics(), fixtureValidation(), { generatedAt: 'X' });
  assert.deepEqual(a, b);
});

test('executive summary has exactly 3 bullets', () => {
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), {});
  const summary = spec.slides.find((s) => s.id === 'executive-summary');
  assert.equal(summary.content.bullets.length, 3);
});

test('appendix slide carries the validation checks for the demo audience', () => {
  const validation = fixtureValidation();
  const spec = buildDeckSpec(fixtureMetrics(), validation, {});
  const appendix = spec.slides.find((s) => s.id === 'data-quality-appendix');
  assert.equal(appendix.content.checks.length, validation.checks.length);
  assert.ok(appendix.content.checks.every((c) => typeof c.passed === 'boolean'));
  assert.equal(appendix.content.passedCount, validation.checks.filter((c) => c.passed).length);
});

test('executive summary pluralizes "store" correctly for a singular count', () => {
  // Fixture has exactly 1 store at stock-out risk (store A: 10 units / 10 per week = 1 week of cover).
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), {});
  const summary = spec.slides.find((s) => s.id === 'executive-summary');
  assert.match(summary.content.bullets[2], /^1 store at stock-out risk/);
  assert.doesNotMatch(summary.content.bullets[2], /store\(s\)/);
});

test('executive summary "Stock-Out Risk" tile agrees with the bullet number, not the broader inventory-risk count', () => {
  const metrics = fixtureMetrics();
  const spec = buildDeckSpec(metrics, fixtureValidation(), {});
  const summary = spec.slides.find((s) => s.id === 'executive-summary');
  const stockOutTile = summary.content.tiles.find((t) => t.label === 'Stock-Out Risk');
  assert.equal(stockOutTile.value, String(metrics.inventory.stockOutRiskCount));
  assert.match(summary.content.bullets[2], new RegExp('^' + metrics.inventory.stockOutRiskCount + ' store'));
  // The broader KPI-tiles count (stock-out + overstock) must be a different, clearly distinct number here.
  assert.notEqual(stockOutTile.value, String(metrics.inventory.atRisk.length));
});

test('KPI tiles and executive summary tiles carry a tone and status, not color alone', () => {
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), {});
  const kpiTiles = spec.slides.find((s) => s.id === 'kpi-tiles');
  const execSummary = spec.slides.find((s) => s.id === 'executive-summary');

  for (const tile of kpiTiles.content.tiles) {
    assert.ok(['good', 'watch', 'bad'].includes(tile.tone), tile.label + ' missing a valid tone');
    assert.ok(tile.status.length > 0, tile.label + ' missing a text status cue');
  }
  assert.equal(typeof kpiTiles.content.onTrackCount, 'number');
  assert.equal(execSummary.content.tiles.length, 4);
  assert.ok(execSummary.content.callout === null || typeof execSummary.content.callout === 'string');
});

test('6-week trend slide carries a goal reference value', () => {
  const metrics = fixtureMetrics();
  const spec = buildDeckSpec(metrics, fixtureValidation(), {});
  const trend = spec.slides.find((s) => s.id === 'six-week-trend');
  assert.equal(trend.content.goal, metrics.totals.goal);
});

test('sell-out by region and top/bottom stores slides carry bar-chart data', () => {
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), {});
  const region = spec.slides.find((s) => s.id === 'sellout-by-region');
  const topBottom = spec.slides.find((s) => s.id === 'top-bottom-stores');
  assert.equal(region.content.bars.length, 2); // North, South
  assert.equal(topBottom.content.topBars.length, 2);
  assert.equal(topBottom.content.bottomBars.length, 2);
});

test('inventory risk slide caps shown rows and reports how many were flagged in total', () => {
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), {});
  const inventory = spec.slides.find((s) => s.id === 'inventory-risk');
  assert.ok(inventory.content.rows.length <= 8);
  assert.equal(inventory.content.summary.shownCount, inventory.content.rows.length);
  assert.equal(typeof inventory.content.summary.totalFlagged, 'number');
});

test('inventory risk slide shows all stock-out rows before filling with overstock, and the footnote count matches the rows shown', () => {
  // 12 stores: 7 stock-out risk, 5 overstock. Cap is 8, so all 7 stock-out rows should
  // show (matching the summary's stockOutShown) plus exactly 1 overstock row.
  const manyStores = Array.from({ length: 12 }, (_, i) => ({
    store_id: 'S' + i,
    store_name: 'Store ' + i,
    region: i % 2 === 0 ? 'North' : 'South'
  }));
  const inventory = manyStores.map((s, i) =>
    i < 7
      ? { week: 'W2', store_id: s.store_id, units_on_hand: 5, avg_weekly_units_sold: 10 } // 0.5 weeks -> stock-out risk
      : { week: 'W2', store_id: s.store_id, units_on_hand: 500, avg_weekly_units_sold: 10 } // 50 weeks -> overstock
  );
  const metrics = computeMetrics({
    week: 'W2',
    priorWeek: 'W1',
    stores: manyStores,
    sellout: [],
    priorSellout: [],
    goals: [],
    inventory,
    storeVisits: [],
    trainingCompletion: [],
    staffing: [],
    salesHistory: []
  });
  const spec = buildDeckSpec(metrics, fixtureValidation(), {});
  const slide = spec.slides.find((s) => s.id === 'inventory-risk');

  assert.equal(slide.content.rows.length, 8);
  assert.equal(slide.content.summary.stockOutShown, 7);
  assert.equal(slide.content.summary.overstockShown, 1);
  // Every stock-out row appears before any overstock row (status is the 4th column).
  const statuses = slide.content.rows.map((r) => r[3]);
  const firstOverstockIndex = statuses.indexOf('overstock');
  assert.ok(statuses.slice(0, firstOverstockIndex).every((s) => s === 'stock-out-risk'));
  // stockOutShown (7) equals the real stockOutRiskCount (7): no 5-vs-6-style mismatch is possible.
  assert.equal(slide.content.summary.stockOutShown, slide.content.summary.stockOutRiskCount);
});

test('visit compliance and training completion slides carry a byRegion breakdown', () => {
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), {});
  const visits = spec.slides.find((s) => s.id === 'visit-compliance');
  const training = spec.slides.find((s) => s.id === 'training-completion');
  assert.equal(visits.content.byRegion.rows.length, 2);
  assert.equal(training.content.byRegion.rows.length, 2);
});

test('no slide text contains an em-dash or a literal "(s)"', () => {
  const spec = buildDeckSpec(fixtureMetrics(), fixtureValidation(), {});
  const strings = [];
  (function collect(value) {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  })(spec);

  for (const s of strings) {
    assert.doesNotMatch(s, /—/, 'em-dash found in: ' + s);
    assert.doesNotMatch(s, /\(s\)/, '"(s)" found in: ' + s);
  }
});
