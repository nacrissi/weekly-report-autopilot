// Pure validation core. No Apps Script globals, no Node globals.
// Data in, verdict out.
//
// Input shape:
// {
//   week: '2026-W42',
//   priorWeek: '2026-W41',       // optional; enables the row-count-swing check
//   stores: [{ store_id, store_name, region }, ...],
//   sources: {
//     sellout:            { rows: [...], priorRows: [...] },
//     goals:              { rows: [...], priorRows: [...] },
//     inventory:          { rows: [...], priorRows: [...] },
//     storeVisits:        { rows: [...], priorRows: [...] },
//     trainingCompletion: { rows: [...], priorRows: [...] },
//     staffing:           { rows: [...], priorRows: [...] }
//   }
// }
//
// Output shape:
// {
//   ok: boolean,               // false if any blocking error exists
//   errors: [{ code, source, message }],
//   warnings: [{ code, source, message }],
//   checks: [{ id, description, passed }]   // one row per rule that ran, for the appendix slide
// }

var REQUIRED_SOURCES = [
  'sellout',
  'goals',
  'inventory',
  'storeVisits',
  'trainingCompletion',
  'staffing'
];

var SCHEMAS = {
  sellout: ['week', 'store_id', 'sellout_usd'],
  goals: ['week', 'store_id', 'goal_usd'],
  inventory: ['week', 'store_id', 'units_on_hand', 'avg_weekly_units_sold'],
  storeVisits: ['week', 'store_id', 'visits_scheduled', 'visits_completed'],
  trainingCompletion: ['week', 'store_id', 'staff_total', 'staff_trained'],
  staffing: ['week', 'store_id', 'positions_required', 'positions_filled']
};

var ROW_COUNT_SWING_ERROR = 0.30;
var ROW_COUNT_SWING_WARNING = 0.10;

function sameColumnSet(actualCols, expectedCols) {
  if (actualCols.length !== expectedCols.length) return false;
  var a = actualCols.slice().sort();
  var b = expectedCols.slice().sort();
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function validate(input) {
  input = input || {};
  var week = input.week;
  var stores = Array.isArray(input.stores) ? input.stores : [];
  var sources = input.sources || {};

  var errors = [];
  var warnings = [];
  var checks = [];

  function addCheck(id, description, passed) {
    checks.push({ id: id, description: description, passed: passed });
  }

  var storeIds = {};
  for (var s = 0; s < stores.length; s++) {
    storeIds[stores[s].store_id] = true;
  }

  // 1. Missing source
  var anyMissing = false;
  for (var i = 0; i < REQUIRED_SOURCES.length; i++) {
    var name = REQUIRED_SOURCES[i];
    var entry = sources[name];
    var rows = entry && Array.isArray(entry.rows) ? entry.rows : null;
    var missing = !rows || rows.length === 0;
    if (missing) {
      anyMissing = true;
      errors.push({
        code: 'missing-source',
        source: name,
        message: 'Source "' + name + '" is missing or empty for week ' + week + '.'
      });
    }
  }
  addCheck('no-missing-sources', 'Every required source is present for the report week', !anyMissing);

  // 2. Wrong week in a source
  var anyWrongWeek = false;
  for (var j = 0; j < REQUIRED_SOURCES.length; j++) {
    var sn = REQUIRED_SOURCES[j];
    var se = sources[sn];
    var srows = se && Array.isArray(se.rows) ? se.rows : [];
    for (var r = 0; r < srows.length; r++) {
      if (srows[r].week !== week) {
        anyWrongWeek = true;
        errors.push({
          code: 'wrong-week',
          source: sn,
          message: 'Source "' + sn + '" contains a row stamped "' + srows[r].week + '" instead of "' + week + '".'
        });
        break;
      }
    }
  }
  addCheck('correct-week-in-sources', 'Every row in every source is stamped with the report week', !anyWrongWeek);

  // 3. Schema drift
  var anyDrift = false;
  for (var k = 0; k < REQUIRED_SOURCES.length; k++) {
    var dn = REQUIRED_SOURCES[k];
    var de = sources[dn];
    var drows = de && Array.isArray(de.rows) ? de.rows : [];
    if (drows.length === 0) continue; // already flagged as missing
    var expected = SCHEMAS[dn];
    var actual = Object.keys(drows[0]);
    if (!sameColumnSet(actual, expected)) {
      anyDrift = true;
      errors.push({
        code: 'schema-drift',
        source: dn,
        message: 'Source "' + dn + '" has columns [' + actual.join(', ') + '] but expected [' + expected.join(', ') + '].'
      });
    }
  }
  addCheck('no-schema-drift', 'No source added, removed, or renamed a column', !anyDrift);

  // 4. Duplicate store-week rows
  var anyDup = false;
  for (var m = 0; m < REQUIRED_SOURCES.length; m++) {
    var un = REQUIRED_SOURCES[m];
    var ue = sources[un];
    var urows = ue && Array.isArray(ue.rows) ? ue.rows : [];
    var seen = {};
    var dupIds = [];
    for (var x = 0; x < urows.length; x++) {
      var key = urows[x].week + '|' + urows[x].store_id;
      if (seen[key]) {
        dupIds.push(urows[x].store_id);
      } else {
        seen[key] = true;
      }
    }
    if (dupIds.length > 0) {
      anyDup = true;
      errors.push({
        code: 'duplicate-row',
        source: un,
        message: 'Source "' + un + '" has duplicate store-week rows for: ' + dupIds.join(', ') + '.'
      });
    }
  }
  addCheck('no-duplicate-store-week-rows', 'No source repeats the same store in the same week', !anyDup);

  // 5. Nulls in key columns
  var anyNullKey = false;
  for (var n = 0; n < REQUIRED_SOURCES.length; n++) {
    var nn = REQUIRED_SOURCES[n];
    var ne = sources[nn];
    var nrows = ne && Array.isArray(ne.rows) ? ne.rows : [];
    var badRows = 0;
    for (var y = 0; y < nrows.length; y++) {
      if (isBlank(nrows[y].week) || isBlank(nrows[y].store_id)) {
        badRows++;
      }
    }
    if (badRows > 0) {
      anyNullKey = true;
      errors.push({
        code: 'null-key-column',
        source: nn,
        message: 'Source "' + nn + '" has ' + badRows + (badRows === 1 ? ' row' : ' rows') + ' with a blank week or store_id.'
      });
    }
  }
  addCheck('no-null-key-columns', 'No source has a blank week or store_id', !anyNullKey);

  // 6. Row count swing vs prior week
  var anySwingError = false;
  var anySwingWarning = false;
  for (var p = 0; p < REQUIRED_SOURCES.length; p++) {
    var pn = REQUIRED_SOURCES[p];
    var pe = sources[pn];
    var prows = pe && Array.isArray(pe.rows) ? pe.rows : [];
    var priorRows = pe && Array.isArray(pe.priorRows) ? pe.priorRows : null;
    if (!priorRows || priorRows.length === 0) continue;
    var swing = Math.abs(prows.length - priorRows.length) / priorRows.length;
    if (swing > ROW_COUNT_SWING_ERROR) {
      anySwingError = true;
      errors.push({
        code: 'row-count-swing',
        source: pn,
        message: 'Source "' + pn + '" row count swung ' + (swing * 100).toFixed(1) + '% vs prior week (' +
          priorRows.length + ' -> ' + prows.length + ').'
      });
    } else if (swing > ROW_COUNT_SWING_WARNING) {
      anySwingWarning = true;
      warnings.push({
        code: 'row-count-swing-warning',
        source: pn,
        message: 'Source "' + pn + '" row count moved ' + (swing * 100).toFixed(1) + '% vs prior week (' +
          priorRows.length + ' -> ' + prows.length + ').'
      });
    }
  }
  addCheck('row-count-stable', 'No source row count swung more than 30% vs prior week', !anySwingError);

  // 7. Store ids not in the store list
  var anyUnknownStore = false;
  for (var q = 0; q < REQUIRED_SOURCES.length; q++) {
    var qn = REQUIRED_SOURCES[q];
    var qe = sources[qn];
    var qrows = qe && Array.isArray(qe.rows) ? qe.rows : [];
    var unknown = {};
    for (var z = 0; z < qrows.length; z++) {
      var sid = qrows[z].store_id;
      if (!isBlank(sid) && !storeIds[sid]) {
        unknown[sid] = true;
      }
    }
    var unknownList = Object.keys(unknown);
    if (unknownList.length > 0) {
      anyUnknownStore = true;
      errors.push({
        code: 'unknown-store-id',
        source: qn,
        message: 'Source "' + qn + '" references store ' + (unknownList.length === 1 ? 'id' : 'ids') +
          ' not in the store list: ' + unknownList.join(', ') + '.'
      });
    }
  }
  addCheck('store-ids-recognized', 'Every store id referenced exists in the store list', !anyUnknownStore);

  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    checks: checks
  };
}

if (typeof module !== 'undefined') {
  module.exports = { validate: validate, REQUIRED_SOURCES: REQUIRED_SOURCES, SCHEMAS: SCHEMAS };
}
