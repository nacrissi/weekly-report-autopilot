const test = require('node:test');
const assert = require('node:assert/strict');
const { computeMetrics } = require('../src/core/metrics');

// Small, hand-checked fixture: 2 stores, 2 regions, numbers chosen so every
// ratio below can be verified with a calculator.
const stores = [
  { store_id: 'A', store_name: 'Store A', region: 'North' },
  { store_id: 'B', store_name: 'Store B', region: 'South' }
];

const sellout = [
  { week: 'W2', store_id: 'A', sellout_usd: 100 },
  { week: 'W2', store_id: 'B', sellout_usd: 200 }
];
const priorSellout = [
  { week: 'W1', store_id: 'A', sellout_usd: 80 },
  { week: 'W1', store_id: 'B', sellout_usd: 220 }
];
const goals = [
  { week: 'W2', store_id: 'A', goal_usd: 100 },
  { week: 'W2', store_id: 'B', goal_usd: 250 }
];
const inventory = [
  { week: 'W2', store_id: 'A', units_on_hand: 10, avg_weekly_units_sold: 10 },
  { week: 'W2', store_id: 'B', units_on_hand: 100, avg_weekly_units_sold: 5 }
];
const storeVisits = [
  { week: 'W2', store_id: 'A', visits_scheduled: 1, visits_completed: 1 },
  { week: 'W2', store_id: 'B', visits_scheduled: 1, visits_completed: 0 }
];
const trainingCompletion = [
  { week: 'W2', store_id: 'A', staff_total: 10, staff_trained: 8 },
  { week: 'W2', store_id: 'B', staff_total: 10, staff_trained: 10 }
];
const staffing = [
  { week: 'W2', store_id: 'A', positions_required: 10, positions_filled: 5 },
  { week: 'W2', store_id: 'B', positions_required: 10, positions_filled: 10 }
];

function fixtureInput() {
  return {
    week: 'W2',
    priorWeek: 'W1',
    stores,
    sellout,
    priorSellout,
    goals,
    inventory,
    storeVisits,
    trainingCompletion,
    staffing,
    salesHistory: [
      { week: 'W1', rows: priorSellout },
      { week: 'W2', rows: sellout }
    ]
  };
}

test('totals: sell-out, goal, attainment, and WoW match hand calculation', () => {
  const m = computeMetrics(fixtureInput());
  assert.equal(m.totals.sellout, 300);
  assert.equal(m.totals.goal, 350);
  assert.equal(m.totals.attainmentPct, 85.7); // 300/350*100
  assert.equal(m.totals.priorSellout, 300);
  assert.equal(m.totals.wowChangePct, 0);
});

test('byRegion: North and South compute independently', () => {
  const m = computeMetrics(fixtureInput());
  const north = m.byRegion.find((r) => r.region === 'North');
  const south = m.byRegion.find((r) => r.region === 'South');
  assert.equal(north.sellout, 100);
  assert.equal(north.attainmentPct, 100);
  assert.equal(north.wowChangePct, 25); // (100-80)/80*100
  assert.equal(south.sellout, 200);
  assert.equal(south.attainmentPct, 80);
  assert.equal(south.wowChangePct, -9.1); // (200-220)/220*100, rounded
});

test('top and bottom stores rank by attainment, worst first in bottom', () => {
  const m = computeMetrics(fixtureInput());
  assert.deepEqual(m.topStores.map((s) => s.store_id), ['A', 'B']);
  assert.deepEqual(m.bottomStores.map((s) => s.store_id), ['B', 'A']);
});

test('inventory: weeks-of-cover and risk categories match hand calculation', () => {
  const m = computeMetrics(fixtureInput());
  const a = m.inventory.stores.find((s) => s.store_id === 'A');
  const b = m.inventory.stores.find((s) => s.store_id === 'B');
  assert.equal(a.weeksOfCover, 1);
  assert.equal(a.category, 'stock-out-risk');
  assert.equal(b.weeksOfCover, 20);
  assert.equal(b.category, 'overstock');
  assert.equal(m.inventory.stockOutRiskCount, 1);
  assert.equal(m.inventory.overstockCount, 1);
});

test('visit compliance, training completion, and staffing coverage match hand calculation', () => {
  const m = computeMetrics(fixtureInput());
  assert.equal(m.visitCompliance.compliancePct, 50); // 1/2*100
  assert.equal(m.training.completionPct, 90); // 18/20*100
  assert.equal(m.staffing.coveragePct, 75); // 15/20*100
  assert.deepEqual(m.staffing.understaffed.map((s) => s.store_id), ['A']);
});

test('visit compliance and training completion break out by region', () => {
  const m = computeMetrics(fixtureInput());
  const northVisits = m.visitCompliance.byRegion.find((r) => r.region === 'North');
  const southVisits = m.visitCompliance.byRegion.find((r) => r.region === 'South');
  assert.equal(northVisits.pct, 100); // store A: 1/1
  assert.equal(southVisits.pct, 0); // store B: 0/1

  const northTraining = m.training.byRegion.find((r) => r.region === 'North');
  const southTraining = m.training.byRegion.find((r) => r.region === 'South');
  assert.equal(northTraining.pct, 80); // store A: 8/10
  assert.equal(southTraining.pct, 100); // store B: 10/10
});

test('6-week trend sums sell-out per week from salesHistory', () => {
  const m = computeMetrics(fixtureInput());
  assert.deepEqual(m.trend, [
    { week: 'W1', total: 300 },
    { week: 'W2', total: 300 }
  ]);
});

test('computeMetrics() tolerates missing optional fields without throwing', () => {
  const m = computeMetrics({ week: 'W2', stores: [] });
  assert.equal(m.totals.sellout, 0);
  assert.deepEqual(m.trend, []);
});
