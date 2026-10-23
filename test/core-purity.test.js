// The core must stay pure: data in, results out. No Apps Script globals,
// no Node-specific APIs. The only Node-aware line allowed is the CommonJS
// export footer, guarded by `typeof module !== 'undefined'`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE_DIR = path.join(__dirname, '..', 'src', 'core');

const APPS_SCRIPT_GLOBALS = [
  'SpreadsheetApp',
  'SlidesApp',
  'DriveApp',
  'LockService',
  'Utilities',
  'HtmlService',
  'PropertiesService',
  'GmailApp',
  'FormApp',
  'UrlFetchApp',
  'ScriptApp',
  'Logger'
];

const NODE_SPECIFIC_PATTERNS = ['require(', 'process.', '__dirname', '__filename', 'fs.', 'global.'];

function coreFiles() {
  return fs.readdirSync(CORE_DIR).filter((f) => f.endsWith('.js'));
}

for (const file of coreFiles()) {
  test('core file ' + file + ' has no Apps Script globals', () => {
    const source = fs.readFileSync(path.join(CORE_DIR, file), 'utf8');
    for (const token of APPS_SCRIPT_GLOBALS) {
      assert.equal(source.includes(token), false, 'found Apps Script global "' + token + '" in ' + file);
    }
  });

  test('core file ' + file + ' has no Node-specific API usage outside the export footer', () => {
    const source = fs.readFileSync(path.join(CORE_DIR, file), 'utf8');
    for (const pattern of NODE_SPECIFIC_PATTERNS) {
      assert.equal(source.includes(pattern), false, 'found Node-specific usage "' + pattern + '" in ' + file);
    }
  });

  test('core file ' + file + ' exports via the typeof-guarded CommonJS footer', () => {
    const source = fs.readFileSync(path.join(CORE_DIR, file), 'utf8');
    assert.ok(source.includes("if (typeof module !== 'undefined')"), 'missing guarded export footer in ' + file);
  });
}

test('at least the three expected core files were checked', () => {
  const files = coreFiles();
  assert.ok(files.includes('validate.js'));
  assert.ok(files.includes('metrics.js'));
  assert.ok(files.includes('deck-spec.js'));
});
