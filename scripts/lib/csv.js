// Minimal CSV reader for the demo/test harness. Node-only (uses fs), not part
// of the pure core. No quoting support needed: every generated field here is
// a plain id, word, or number.

const fs = require('fs');

const NUMERIC_COLUMNS = new Set([
  'sellout_usd',
  'goal_usd',
  'units_on_hand',
  'avg_weekly_units_sold',
  'visits_scheduled',
  'visits_completed',
  'staff_total',
  'staff_trained',
  'positions_required',
  'positions_filled'
]);

function parseCsvText(text) {
  const lines = text.trim().split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const columns = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    for (let c = 0; c < columns.length; c++) {
      const key = columns[c];
      const raw = values[c];
      row[key] = NUMERIC_COLUMNS.has(key) && raw !== '' ? Number(raw) : raw;
    }
    rows.push(row);
  }
  return rows;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseCsvText(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { parseCsvText, readCsv };
