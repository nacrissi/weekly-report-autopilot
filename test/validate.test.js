const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../src/core/validate');

const WEEK = '2026-W10';
const PRIOR = '2026-W09';

function baseStores() {
  return [
    { store_id: 'ST-01', store_name: 'Alpha', region: 'North' },
    { store_id: 'ST-02', store_name: 'Beta', region: 'North' },
    { store_id: 'ST-03', store_name: 'Gamma', region: 'South' }
  ];
}

function baseSource(columns, weekValue) {
  // 3 rows, one per store, matching the base store list.
  return ['ST-01', 'ST-02', 'ST-03'].map((storeId) => {
    const row = { week: weekValue, store_id: storeId };
    for (let i = 2; i < columns.length; i++) row[columns[i]] = 10;
    return row;
  });
}

function baseInput() {
  const schemas = require('../src/core/validate').SCHEMAS;
  const sources = {};
  for (const name of Object.keys(schemas)) {
    sources[name] = {
      rows: baseSource(schemas[name], WEEK),
      priorRows: baseSource(schemas[name], PRIOR)
    };
  }
  return { week: WEEK, priorWeek: PRIOR, stores: baseStores(), sources };
}

test('a clean input passes with no errors and all checks true', () => {
  const result = validate(baseInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.checks.length, 7);
  assert.ok(result.checks.every((c) => c.passed === true));
});

test('missing source: rule fails when a required source has no rows', () => {
  const input = baseInput();
  input.sources.goals.rows = [];
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'missing-source' && e.source === 'goals'));
  const check = result.checks.find((c) => c.id === 'no-missing-sources');
  assert.equal(check.passed, false);
});

test('missing source: rule fails when a required source is undefined', () => {
  const input = baseInput();
  delete input.sources.staffing;
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'missing-source' && e.source === 'staffing'));
});

test('wrong week: rule fails when a row is stamped with a different week', () => {
  const input = baseInput();
  input.sources.sellout.rows[0].week = PRIOR;
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'wrong-week' && e.source === 'sellout'));
});

test('wrong week: rule passes when every row matches the report week', () => {
  const result = validate(baseInput());
  const check = result.checks.find((c) => c.id === 'correct-week-in-sources');
  assert.equal(check.passed, true);
});

test('schema drift: rule fails when a column is renamed', () => {
  const input = baseInput();
  input.sources.inventory.rows = input.sources.inventory.rows.map((r) => {
    const copy = Object.assign({}, r);
    copy.units_in_stock = copy.units_on_hand;
    delete copy.units_on_hand;
    return copy;
  });
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema-drift' && e.source === 'inventory'));
});

test('schema drift: rule fails when a column is added', () => {
  const input = baseInput();
  input.sources.staffing.rows = input.sources.staffing.rows.map((r) => Object.assign({}, r, { bonus_pool: 1 }));
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema-drift' && e.source === 'staffing'));
});

test('schema drift: rule passes when columns match exactly', () => {
  const result = validate(baseInput());
  const check = result.checks.find((c) => c.id === 'no-schema-drift');
  assert.equal(check.passed, true);
});

test('duplicate rows: rule fails when the same store-week appears twice', () => {
  const input = baseInput();
  input.sources.trainingCompletion.rows.push(Object.assign({}, input.sources.trainingCompletion.rows[0]));
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'duplicate-row' && e.source === 'trainingCompletion'));
});

test('duplicate rows: rule passes when every store-week is unique', () => {
  const result = validate(baseInput());
  const check = result.checks.find((c) => c.id === 'no-duplicate-store-week-rows');
  assert.equal(check.passed, true);
});

test('null key columns: rule fails on a blank store_id', () => {
  const input = baseInput();
  input.sources.storeVisits.rows[1].store_id = '';
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'null-key-column' && e.source === 'storeVisits'));
});

test('null key columns: rule fails on a blank week', () => {
  const input = baseInput();
  input.sources.goals.rows[0].week = null;
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'null-key-column' && e.source === 'goals'));
});

test('row count swing: rule fails when current rows swing more than 30% vs prior', () => {
  const input = baseInput();
  input.sources.sellout.priorRows = baseSource(['week', 'store_id', 'sellout_usd'], PRIOR).concat(
    Array.from({ length: 7 }, (_, i) => ({ week: PRIOR, store_id: 'ST-0' + (i + 4), sellout_usd: 10 }))
  ); // prior has 10 rows, current has 3 -> 70% drop
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'row-count-swing' && e.source === 'sellout'));
});

test('row count swing: a swing between 10% and 30% is a warning, not an error', () => {
  const input = baseInput();
  // prior has 4 rows, current has 3 -> 25% drop: warning band.
  input.sources.sellout.priorRows = baseSource(['week', 'store_id', 'sellout_usd'], PRIOR).concat([
    { week: PRIOR, store_id: 'ST-04', sellout_usd: 10 }
  ]);
  const result = validate(input);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.code === 'row-count-swing-warning' && w.source === 'sellout'));
});

test('row count swing: rule passes when counts match prior week', () => {
  const result = validate(baseInput());
  const check = result.checks.find((c) => c.id === 'row-count-stable');
  assert.equal(check.passed, true);
});

test('unknown store id: rule fails when a row references a store not in the store list', () => {
  const input = baseInput();
  input.sources.sellout.rows[2].store_id = 'ST-99';
  const result = validate(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'unknown-store-id' && e.source === 'sellout'));
});

test('unknown store id: rule passes when every store id is recognized', () => {
  const result = validate(baseInput());
  const check = result.checks.find((c) => c.id === 'store-ids-recognized');
  assert.equal(check.passed, true);
});

test('validate() tolerates a completely empty input without throwing', () => {
  const result = validate({});
  assert.equal(result.ok, false);
  assert.equal(result.errors.length > 0, true);
});
