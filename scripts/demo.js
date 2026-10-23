#!/usr/bin/env node
// End-to-end local demo: generate -> validate -> compute -> build spec -> render.
// No cloud account needed; everything lands in out/.
//
//   npm run demo             -> good data, writes out/deck-spec.json + out/deck.html
//   npm run demo:broken      -> corrupt data, shows the validator refusing to build

const fs = require('fs');
const path = require('path');

const { generate } = require('./generate-data');
const { loadWeekBundle, toValidateInput, toMetricsInput } = require('./lib/load-week');
const { validate } = require('../src/core/validate');
const { computeMetrics } = require('../src/core/metrics');
const { buildDeckSpec } = require('../src/core/deck-spec');
const { renderDeckHtml } = require('../src/demo/render-html');

const SEED = 7;
const WEEK = '2026-W42';
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(__dirname, '..', 'out');

function parseArgs(argv) {
  const out = { broken: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--broken') out.broken = argv[++i];
  }
  return out;
}

function main() {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));

  console.log('== Weekly Report Autopilot: local demo ==');
  console.log('Mode: ' + (args.broken ? 'broken (' + args.broken + ')' : 'clean'));

  generate({ seed: SEED, week: WEEK, out: DATA_DIR, break: args.broken });
  console.log('Generated fake field-ops data for week ' + WEEK + (args.broken ? ' with a deliberate "' + args.broken + '" break' : '') + '.');

  const bundle = loadWeekBundle(DATA_DIR, WEEK);
  const validation = validate(toValidateInput(bundle));

  console.log('');
  console.log('Validation: ' + (validation.ok ? 'PASSED' : 'FAILED'));
  for (const check of validation.checks) {
    console.log('  [' + (check.passed ? 'PASS' : 'FAIL') + '] ' + check.description);
  }
  if (validation.errors.length > 0) {
    console.log('');
    console.log('Blocking errors:');
    for (const e of validation.errors) console.log('  - ' + e.message);
  }
  if (validation.warnings.length > 0) {
    console.log('');
    console.log('Warnings (non-blocking):');
    for (const w of validation.warnings) console.log('  - ' + w.message);
  }

  if (!validation.ok) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    console.log('');
    const errorWord = validation.errors.length === 1 ? 'error' : 'errors';
    console.log('Build refused: fix the ' + errorWord + ' above before this week\'s deck can render.');
    console.log('Elapsed: ' + elapsed + 's');
    process.exitCode = args.broken ? 0 : 1; // a refusal is the expected outcome in --broken mode
    return;
  }

  const metrics = computeMetrics(toMetricsInput(bundle));
  const deckSpec = buildDeckSpec(metrics, validation, { generatedAt: new Date().toISOString() });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'deck-spec.json'), JSON.stringify(deckSpec, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'deck.html'), renderDeckHtml(deckSpec));

  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log('');
  console.log('Built ' + deckSpec.slides.length + '-slide deck in ' + elapsed + 's.');
  console.log('  out/deck-spec.json');
  console.log('  out/deck.html');
}

main();
