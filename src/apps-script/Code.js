/**
 * Apps Script glue for the weekly report autopilot.
 *
 * This file is intentionally thin: it reads the bound Sheet, hands plain
 * objects to the pure core (validate / computeMetrics / buildDeckSpec,
 * loaded globally from src/core/*.js in the same Apps Script project), and
 * writes the result back to Sheets and Slides. No business logic lives here.
 *
 * Sheet tabs expected on the bound spreadsheet:
 *   Config               - B1: this week (e.g. "2026-W42"), B2: prior week
 *   Stores                - store_id | store_name | region
 *   Sellout                - week | store_id | sellout_usd | region   (region is a sync-time join column, dropped before it reaches core)
 *   Goals                  - week | store_id | goal_usd | region
 *   Inventory              - week | store_id | units_on_hand | avg_weekly_units_sold | region
 *   StoreVisits             - week | store_id | visits_scheduled | visits_completed | region
 *   TrainingCompletion      - week | store_id | staff_total | staff_trained | region
 *   Staffing                - week | store_id | positions_required | positions_filled | region
 *   Runs                    - week | deckFileId | deckUrl | lastBuiltAt | builtBy        (one row per week, upserted - keeps rebuilds idempotent)
 *   AuditLog                - timestamp | week | mode | result | errorCount | warningCount | user | deckUrl | note   (append-only; result is one of passed, built, blocked)
 *
 * Replace the placeholders below with real ids once this is deployed; they
 * are intentionally not real so this repo stays reviewable without any
 * live account attached to it.
 */

var TEMPLATE_DECK_ID = 'REPLACE_WITH_TEMPLATE_DECK_ID';
var OUTPUT_FOLDER_ID = 'REPLACE_WITH_OUTPUT_FOLDER_ID';
var LOCK_WAIT_MS = 30 * 1000;

var SOURCE_SHEETS = {
  sellout: { sheet: 'Sellout', columns: ['week', 'store_id', 'sellout_usd'] },
  goals: { sheet: 'Goals', columns: ['week', 'store_id', 'goal_usd'] },
  inventory: { sheet: 'Inventory', columns: ['week', 'store_id', 'units_on_hand', 'avg_weekly_units_sold'] },
  storeVisits: { sheet: 'StoreVisits', columns: ['week', 'store_id', 'visits_scheduled', 'visits_completed'] },
  trainingCompletion: { sheet: 'TrainingCompletion', columns: ['week', 'store_id', 'staff_total', 'staff_trained'] },
  staffing: { sheet: 'Staffing', columns: ['week', 'store_id', 'positions_required', 'positions_filled'] }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Weekly Report')
    .addItem('Build deck', 'menuBuildDeck')
    .addItem('Validate only', 'menuValidateOnly')
    .addToUi();
}

function menuBuildDeck() {
  runWeeklyReport('build');
}

function menuValidateOnly() {
  runWeeklyReport('validate-only');
}

/** Shared entry point for both menu items and any future time-driven trigger. */
function runWeeklyReport(mode) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(LOCK_WAIT_MS);
  if (!acquired) {
    SpreadsheetApp.getUi().alert('Another build is already running for this spreadsheet. Try again shortly.');
    return;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var config = readConfig(ss);
    var bundle = loadBundle(ss, config.week, config.priorWeek);
    var validationResult = validate({
      week: config.week,
      priorWeek: config.priorWeek,
      stores: bundle.stores,
      sources: bundle.sources
    });

    if (!validationResult.ok) {
      showValidationDialog(config.week, validationResult, mode);
      writeAuditRow(ss, config.week, mode, 'blocked', validationResult);
      return;
    }

    if (mode === 'validate-only') {
      showValidationDialog(config.week, validationResult, mode);
      writeAuditRow(ss, config.week, mode, 'passed', validationResult);
      return;
    }

    var metrics = computeMetrics(toMetricsInput(bundle, config));
    var deckSpec = buildDeckSpec(metrics, validationResult, { generatedAt: new Date().toISOString() });

    try {
      writeSummaryTab(ss, bundle.stores, config.week, config.priorWeek);
      var deck = renderDeck(deckSpec, config.week);
      upsertRun(ss, config.week, deck);
      writeAuditRow(ss, config.week, mode, 'built', validationResult, deck.url);
      SpreadsheetApp.getUi().alert('Built the week ' + config.week + ' deck:\n' + deck.url);
    } catch (buildErr) {
      // A template problem (e.g. a missing slide tag) is caught here, before any
      // destructive Drive action - see renderDeck's upfront check. Refuse rather
      // than ship a wrong or partial deck.
      writeAuditRow(ss, config.week, mode, 'blocked', validationResult, '', 'template: ' + buildErr.message);
      SpreadsheetApp.getUi().alert('Build blocked: ' + buildErr.message);
    }
  } finally {
    lock.releaseLock();
  }
}

function readConfig(ss) {
  var sheet = ss.getSheetByName('Config');
  return {
    week: sheet.getRange('B1').getValue(),
    priorWeek: sheet.getRange('B2').getValue()
  };
}

/** Reads a tab into an array of plain objects keyed by its header row. */
function readTable(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) {
      row[headers[c]] = values[r][c];
    }
    rows.push(row);
  }
  return rows;
}

/** Keeps only the columns the pure core expects, dropping any sync-time extras (e.g. a joined `region`). */
function projectColumns(rows, columns) {
  return rows.map(function (row) {
    var projected = {};
    for (var i = 0; i < columns.length; i++) projected[columns[i]] = row[columns[i]];
    return projected;
  });
}

function loadBundle(ss, week, priorWeek) {
  var stores = projectColumns(readTable(ss, 'Stores'), ['store_id', 'store_name', 'region']);
  var sources = {};

  Object.keys(SOURCE_SHEETS).forEach(function (name) {
    var def = SOURCE_SHEETS[name];
    var all = readTable(ss, def.sheet);
    var current = projectColumns(all.filter(function (r) { return r.week === week; }), def.columns);
    var prior = projectColumns(all.filter(function (r) { return r.week === priorWeek; }), def.columns);
    sources[name] = { rows: current, priorRows: prior, all: all };
  });

  // 6-week sell-out history for the trend slide, derived from the same raw tab.
  var allSellout = sources.sellout.all;
  var weeksSeen = uniqueSorted(allSellout.map(function (r) { return r.week; })).slice(-6);
  var salesHistory = weeksSeen.map(function (w) {
    return { week: w, rows: projectColumns(allSellout.filter(function (r) { return r.week === w; }), ['week', 'store_id', 'sellout_usd']) };
  });

  return { stores: stores, sources: sources, salesHistory: salesHistory };
}

function uniqueSorted(values) {
  var seen = {};
  var out = [];
  values.forEach(function (v) {
    if (!seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  });
  return out.sort();
}

function toMetricsInput(bundle, config) {
  var s = bundle.sources;
  return {
    week: config.week,
    priorWeek: config.priorWeek,
    stores: bundle.stores,
    sellout: s.sellout.rows,
    priorSellout: s.sellout.priorRows,
    goals: s.goals.rows,
    inventory: s.inventory.rows,
    storeVisits: s.storeVisits.rows,
    trainingCompletion: s.trainingCompletion.rows,
    staffing: s.staffing.rows,
    salesHistory: bundle.salesHistory
  };
}

function showValidationDialog(week, validationResult, mode) {
  var lines = [];
  lines.push((mode === 'validate-only' ? 'Validate only' : 'Build deck') + ' - week ' + week);
  var errorWord = validationResult.errors.length === 1 ? 'error' : 'errors';
  lines.push(validationResult.ok ? 'All checks passed.' : 'Blocked: fix the ' + errorWord + ' below before building.');
  lines.push('');
  validationResult.checks.forEach(function (c) {
    lines.push((c.passed ? '[PASS] ' : '[FAIL] ') + c.description);
  });
  if (validationResult.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    validationResult.errors.forEach(function (e) { lines.push('- ' + e.message); });
  }
  if (validationResult.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    validationResult.warnings.forEach(function (w) { lines.push('- ' + w.message); });
  }
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

/**
 * Writes the raw region rollup inputs plus formulas that compute the rollup,
 * so a reviewer can click any number on the Summary tab and see the SUMIFS
 * that produced it rather than a value Apps Script computed off-sheet.
 */
function writeSummaryTab(ss, stores, week, priorWeek) {
  var sheet = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  sheet.clearContents();

  var regions = uniqueSorted(stores.map(function (s) { return s.region; }));
  sheet.getRange('A1:E1').setValues([['Region', 'Sell-Out', 'Goal', 'Attainment %', 'Prior Sell-Out']]);

  regions.forEach(function (region, i) {
    var row = i + 2;
    sheet.getRange('A' + row).setValue(region);
    sheet.getRange('B' + row).setFormula(
      '=SUMIFS(Sellout!C:C, Sellout!A:A, "' + week + '", Sellout!D:D, A' + row + ')'
    );
    sheet.getRange('C' + row).setFormula(
      '=SUMIFS(Goals!C:C, Goals!A:A, "' + week + '", Goals!D:D, A' + row + ')'
    );
    sheet.getRange('D' + row).setFormula('=IF(C' + row + '=0, 0, ROUND(B' + row + '/C' + row + '*100, 1))');
    sheet.getRange('E' + row).setFormula(
      '=SUMIFS(Sellout!C:C, Sellout!A:A, "' + priorWeek + '", Sellout!D:D, A' + row + ')'
    );
  });
}

/**
 * Copies the template deck, fills placeholders from the deck spec, and
 * returns the file so the caller can upsert the Runs tab. Rebuilding the
 * same week replaces that week's deck (see upsertRun) instead of piling up
 * duplicates.
 */
function renderDeck(deckSpec, week) {
  // Refuse rather than ship a wrong or partial deck: check every slide tag
  // exists in the template BEFORE trashing the old deck or copying anything.
  assertTemplateHasAllSlides(deckSpec);

  var existing = findExistingRun(SpreadsheetApp.getActiveSpreadsheet(), week);
  if (existing && existing.deckFileId) {
    try {
      DriveApp.getFileById(existing.deckFileId).setTrashed(true);
    } catch (err) {
      // Already gone (manually deleted) - fine, we're about to replace it anyway.
    }
  }

  var folder = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  var copy = DriveApp.getFileById(TEMPLATE_DECK_ID).makeCopy('Weekly Report - ' + week, folder);
  var presentation = SlidesApp.openById(copy.getId());

  deckSpec.slides.forEach(function (slide) {
    var templateSlide = findSlideByTag(presentation, slide.id);
    fillSlide(templateSlide, slide);
  });

  presentation.saveAndClose();
  return { id: copy.getId(), url: copy.getUrl() };
}

/** Throws a clear error naming every slide id the template has no `{{slide:<id>}}` tag for. */
function assertTemplateHasAllSlides(deckSpec) {
  var presentation = SlidesApp.openById(TEMPLATE_DECK_ID);
  var missing = deckSpec.slides
    .map(function (slide) { return slide.id; })
    .filter(function (id) { return !findSlideByTag(presentation, id); });

  if (missing.length > 0) {
    var tagWord = missing.length === 1 ? 'tag' : 'tags';
    throw new Error('Template is missing the slide ' + tagWord + ' for: ' + missing.join(', ') + '.');
  }
}

/** Template slides are tagged by putting `{{slide:<id>}}` in the speaker notes. */
function findSlideByTag(presentation, slideId) {
  var tag = '{{slide:' + slideId + '}}';
  var slides = presentation.getSlides();
  for (var i = 0; i < slides.length; i++) {
    var notes = slides[i].getNotesPage().getSpeakerNotesShape().getText().asString();
    if (notes.indexOf(tag) !== -1) return slides[i];
  }
  return null;
}

function fillSlide(templateSlide, slide) {
  templateSlide.replaceAllText('{{title}}', slide.title);

  if (slide.type === 'bullets') {
    slide.content.bullets.forEach(function (bullet, i) {
      templateSlide.replaceAllText('{{bullet' + (i + 1) + '}}', bullet);
    });
  } else if (slide.type === 'tiles') {
    slide.content.tiles.forEach(function (tile, i) {
      templateSlide.replaceAllText('{{tile' + (i + 1) + '_label}}', tile.label);
      templateSlide.replaceAllText('{{tile' + (i + 1) + '_value}}', tile.value);
    });
  } else if (slide.type === 'table') {
    var tables = templateSlide.getTables();
    if (tables.length > 0) fillTable(tables[0], slide.content.columns, slide.content.rows || slide.content.top);
  } else if (slide.type === 'actions') {
    var actionTables = templateSlide.getTables();
    if (actionTables.length > 0) {
      fillTable(
        actionTables[0],
        ['Action', 'Owner'],
        slide.content.actions.map(function (a) { return [a.action, a.owner]; })
      );
    }
  } else if (slide.type === 'checklist') {
    var text = slide.content.checks
      .map(function (c) { return (c.passed ? 'PASS' : 'FAIL') + ' - ' + c.description; })
      .join('\n');
    templateSlide.replaceAllText('{{checklist}}', text);
  }
}

function fillTable(table, columns, rows) {
  columns.forEach(function (col, c) {
    table.getCell(0, c).getText().setText(col);
  });
  rows.forEach(function (row, r) {
    row.forEach(function (cell, c) {
      table.getCell(r + 1, c).getText().setText(String(cell));
    });
  });
}

function findExistingRun(ss, week) {
  var rows = readTable(ss, 'Runs');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].week === week) return rows[i];
  }
  return null;
}

/** Upserts the Runs tab so rebuilding a week replaces its row instead of appending a duplicate. */
function upsertRun(ss, week, deck) {
  var sheet = ss.getSheetByName('Runs') || ss.insertSheet('Runs');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['week', 'deckFileId', 'deckUrl', 'lastBuiltAt', 'builtBy']);
  }

  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === week) {
      sheet.getRange(r + 1, 1, 1, 5).setValues([[week, deck.id, deck.url, new Date(), Session.getActiveUser().getEmail()]]);
      return;
    }
  }
  sheet.appendRow([week, deck.id, deck.url, new Date(), Session.getActiveUser().getEmail()]);
}

function writeAuditRow(ss, week, mode, result, validationResult, deckUrl, note) {
  var sheet = ss.getSheetByName('AuditLog') || ss.insertSheet('AuditLog');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'week', 'mode', 'result', 'errorCount', 'warningCount', 'user', 'deckUrl', 'note']);
  }
  sheet.appendRow([
    new Date(),
    week,
    mode,
    result,
    validationResult.errors.length,
    validationResult.warnings.length,
    Session.getActiveUser().getEmail(),
    deckUrl || '',
    note || ''
  ]);
}
