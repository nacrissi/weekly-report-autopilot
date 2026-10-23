#!/usr/bin/env node
// Generates fake, deterministic field-ops CSVs for the demo and the test suite.
// Everything here is invented: no real people, companies, retailers, or places.
//
// Usage:
//   node scripts/generate-data.js --seed 7 --week 2026-W42 [--out data] [--break <kind>]
//
// --break <kind> corrupts the current week's sellout file in exactly one way,
// so each validation rule has a matching reproducible fixture:
//   missing-source | wrong-week | schema-drift | duplicate-rows |
//   null-key | row-count-swing | unknown-store

const fs = require('fs');
const path = require('path');

const REGIONS = ['North', 'South', 'West'];
const STORES_PER_REGION = 20;
const BREAK_KINDS = [
  'missing-source',
  'wrong-week',
  'schema-drift',
  'duplicate-rows',
  'null-key',
  'row-count-swing',
  'unknown-store'
];

function parseArgs(argv) {
  const out = { seed: 7, week: '2026-W42', out: 'data', break: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--week') out.week = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--break') out.break = argv[++i];
  }
  return out;
}

// mulberry32 - small deterministic PRNG, good enough for fake data.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function parseWeek(weekStr) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekStr);
  if (!m) throw new Error('Week must look like 2026-W42, got: ' + weekStr);
  return { year: Number(m[1]), week: Number(m[2]) };
}

function formatWeek(y, w) {
  return y + '-W' + String(w).padStart(2, '0');
}

function priorWeekOf(weekStr, stepsBack) {
  const { year, week } = parseWeek(weekStr);
  let y = year;
  let w = week - stepsBack;
  while (w < 1) {
    w += 52;
    y -= 1;
  }
  return formatWeek(y, w);
}

function buildStores() {
  const stores = [];
  let n = 1;
  for (const region of REGIONS) {
    for (let i = 0; i < STORES_PER_REGION; i++) {
      const id = 'ST-' + String(n).padStart(3, '0');
      stores.push({
        store_id: id,
        store_name: region + ' Store ' + String(i + 1).padStart(2, '0'),
        region: region
      });
      n++;
    }
  }
  return stores;
}

function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => row[c]).join(','));
  }
  return lines.join('\n') + '\n';
}

function writeCsv(outDir, filename, columns, rows) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, filename), toCsv(columns, rows));
}

function buildSellout(rng, stores, week, regionTrendFactor) {
  const baseline = { North: 21000, South: 18500, West: 23500 };
  return stores.map((s) => {
    const base = baseline[s.region] * regionTrendFactor;
    const variance = 1 + (rng() - 0.5) * 0.3;
    return { week, store_id: s.store_id, sellout_usd: Math.round(base * variance) };
  });
}

function buildGoals(rng, stores, week) {
  const baseline = { North: 20000, South: 19000, West: 22000 };
  return stores.map((s) => {
    const base = baseline[s.region];
    const variance = 1 + (rng() - 0.5) * 0.1;
    return { week, store_id: s.store_id, goal_usd: Math.round(base * variance) };
  });
}

function buildInventory(rng, stores, week) {
  return stores.map((s) => ({
    week,
    store_id: s.store_id,
    units_on_hand: randInt(rng, 40, 820),
    avg_weekly_units_sold: randInt(rng, 8, 120)
  }));
}

function buildStoreVisits(rng, stores, week) {
  return stores.map((s) => {
    const completed = rng() < 0.88 ? 1 : 0;
    return { week, store_id: s.store_id, visits_scheduled: 1, visits_completed: completed };
  });
}

function buildTrainingCompletion(rng, stores, week) {
  return stores.map((s) => {
    const total = randInt(rng, 3, 12);
    const rate = 0.65 + rng() * 0.35;
    const trained = Math.min(total, Math.round(total * rate));
    return { week, store_id: s.store_id, staff_total: total, staff_trained: trained };
  });
}

function buildStaffing(rng, stores, week) {
  return stores.map((s) => {
    const required = randInt(rng, 3, 10);
    const rate = 0.6 + rng() * 0.4;
    const filled = Math.min(required, Math.round(required * rate));
    return { week, store_id: s.store_id, positions_required: required, positions_filled: filled };
  });
}

function applyBreak(kind, outDir, week, priorWeek) {
  if (!BREAK_KINDS.includes(kind)) {
    throw new Error('Unknown --break kind "' + kind + '". Expected one of: ' + BREAK_KINDS.join(', '));
  }
  const file = path.join(outDir, 'sellout-' + week + '.csv');

  if (kind === 'missing-source') {
    fs.unlinkSync(file);
    return;
  }

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.trim().split('\n');
  const header = lines[0];
  const dataLines = lines.slice(1);

  if (kind === 'wrong-week') {
    const cols = dataLines[0].split(',');
    cols[0] = priorWeek; // week column is first
    dataLines[0] = cols.join(',');
  } else if (kind === 'schema-drift') {
    const renamed = header.replace('sellout_usd', 'sellout_amount');
    fs.writeFileSync(file, [renamed].concat(dataLines).join('\n') + '\n');
    return;
  } else if (kind === 'duplicate-rows') {
    dataLines.push(dataLines[0]);
  } else if (kind === 'null-key') {
    const cols = dataLines[0].split(',');
    cols[1] = ''; // store_id column is second
    dataLines[0] = cols.join(',');
  } else if (kind === 'row-count-swing') {
    const keep = Math.ceil(dataLines.length * 0.5); // drop ~50%, well past the 30% threshold
    dataLines.length = keep;
  } else if (kind === 'unknown-store') {
    const cols = dataLines[0].split(',');
    cols[1] = 'ST-999';
    dataLines[0] = cols.join(',');
  }

  fs.writeFileSync(file, [header].concat(dataLines).join('\n') + '\n');
}

function generate(args) {
  const rng = makeRng(args.seed);
  const stores = buildStores();
  const week = args.week;
  const priorWeek = priorWeekOf(week, 1);
  const outDir = args.out;

  fs.mkdirSync(outDir, { recursive: true });
  writeCsv(outDir, 'stores.csv', ['store_id', 'store_name', 'region'], stores);

  // 6 weeks of sell-out history for the trend slide (oldest -> newest).
  const selloutColumns = ['week', 'store_id', 'sellout_usd'];
  for (let back = 5; back >= 0; back--) {
    const w = priorWeekOf(week, back);
    const trendFactor = 0.9 + (5 - back) * 0.02; // gentle upward drift so the trend chart isn't flat
    writeCsv(outDir, 'sellout-' + w + '.csv', selloutColumns, buildSellout(rng, stores, w, trendFactor));
  }

  // Current + prior week for the other 5 sources, so WoW / row-count-swing checks have data.
  const weeks = [priorWeek, week];
  for (const w of weeks) {
    writeCsv(outDir, 'goals-' + w + '.csv', ['week', 'store_id', 'goal_usd'], buildGoals(rng, stores, w));
    writeCsv(
      outDir,
      'inventory-' + w + '.csv',
      ['week', 'store_id', 'units_on_hand', 'avg_weekly_units_sold'],
      buildInventory(rng, stores, w)
    );
    writeCsv(
      outDir,
      'store-visits-' + w + '.csv',
      ['week', 'store_id', 'visits_scheduled', 'visits_completed'],
      buildStoreVisits(rng, stores, w)
    );
    writeCsv(
      outDir,
      'training-completion-' + w + '.csv',
      ['week', 'store_id', 'staff_total', 'staff_trained'],
      buildTrainingCompletion(rng, stores, w)
    );
    writeCsv(
      outDir,
      'staffing-' + w + '.csv',
      ['week', 'store_id', 'positions_required', 'positions_filled'],
      buildStaffing(rng, stores, w)
    );
  }

  if (args.break) {
    applyBreak(args.break, outDir, week, priorWeek);
  }

  return { stores, week, priorWeek, outDir, regionCount: REGIONS.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = generate(args);
  console.log(
    'Generated fake field-ops data for week ' + result.week + ' (prior week ' + result.priorWeek + ') in ' +
      result.outDir + '/'
  );
  console.log('Stores: ' + result.stores.length + ' across ' + result.regionCount + ' regions');
  if (args.break) console.log('Applied break: ' + args.break);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, makeRng, buildStores, priorWeekOf, BREAK_KINDS, generate };
