const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { generate, BREAK_KINDS } = require('../scripts/generate-data');
const { loadWeekBundle, toValidateInput } = require('../scripts/lib/load-week');
const { validate } = require('../src/core/validate');

const WEEK = '2026-W42';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wra-test-'));
}

test('generate() is deterministic for the same seed and week', () => {
  const dirA = tmpDir();
  const dirB = tmpDir();
  generate({ seed: 7, week: WEEK, out: dirA, break: null });
  generate({ seed: 7, week: WEEK, out: dirB, break: null });

  const filesA = fs.readdirSync(dirA).sort();
  const filesB = fs.readdirSync(dirB).sort();
  assert.deepEqual(filesA, filesB);

  for (const f of filesA) {
    assert.equal(fs.readFileSync(path.join(dirA, f), 'utf8'), fs.readFileSync(path.join(dirB, f), 'utf8'), f);
  }
});

test('generate() with a different seed produces different sell-out numbers', () => {
  const dirA = tmpDir();
  const dirB = tmpDir();
  generate({ seed: 7, week: WEEK, out: dirA, break: null });
  generate({ seed: 99, week: WEEK, out: dirB, break: null });

  const a = fs.readFileSync(path.join(dirA, 'sellout-' + WEEK + '.csv'), 'utf8');
  const b = fs.readFileSync(path.join(dirB, 'sellout-' + WEEK + '.csv'), 'utf8');
  assert.notEqual(a, b);
});

test('generate() writes 6 weeks of sell-out history and 2 weeks of every other source', () => {
  const dir = tmpDir();
  generate({ seed: 7, week: WEEK, out: dir, break: null });
  const files = fs.readdirSync(dir);
  const selloutFiles = files.filter((f) => f.startsWith('sellout-'));
  const goalsFiles = files.filter((f) => f.startsWith('goals-'));
  assert.equal(selloutFiles.length, 6);
  assert.equal(goalsFiles.length, 2);
});

for (const kind of BREAK_KINDS) {
  test('--break ' + kind + ' produces a dataset that validate() blocks', () => {
    const dir = tmpDir();
    generate({ seed: 7, week: WEEK, out: dir, break: kind });
    const bundle = loadWeekBundle(dir, WEEK);
    const result = validate(toValidateInput(bundle));
    assert.equal(result.ok, false, 'expected --break ' + kind + ' to fail validation');
  });
}

test('an unknown --break kind throws rather than silently producing good data', () => {
  const dir = tmpDir();
  assert.throws(() => generate({ seed: 7, week: WEEK, out: dir, break: 'not-a-real-kind' }));
});
