// Renders a deck-spec into a single self-contained HTML file: one 16:9 slide
// per section, simple CSS, no external assets, so anyone without a Sheets or
// Slides account can open it straight from disk. Node-only (string
// templating only, no fs here); the caller writes the file.

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtUsdShort(n) {
  // Compact, consistent axis/label format: $1,371K, $343K, $0.
  // (Always thousands with a comma, never mixed with "M", so every label on the
  // same chart reads on one scale.)
  const rounded = Math.round(n);
  if (Math.abs(rounded) >= 1000) {
    return '$' + Math.round(rounded / 1000).toLocaleString('en-US') + 'K';
  }
  return '$' + rounded;
}

function pluralizeWord(n, singular, plural) {
  return n + ' ' + (n === 1 ? singular : plural || singular + 's');
}

const STATUS_BADGE = {
  'stock-out-risk': { label: 'Stock-Out Risk', tone: 'bad', icon: '⚠' }, // warning triangle
  overstock: { label: 'Overstock', tone: 'watch', icon: '▲' }, // triangle up
  healthy: { label: 'Healthy', tone: 'good', icon: '✓' } // check
};

function buildTrendSvg(points, goal) {
  const width = 860;
  const height = 360;
  const padLeft = 64;
  const padRight = 24;
  const padTop = 28;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  if (!points || points.length === 0) {
    return '<svg width="' + width + '" height="' + height + '"></svg>';
  }

  const values = points.map((p) => p.total);
  const allValues = goal ? values.concat([goal]) : values;
  const rawMax = Math.max.apply(null, allValues);
  const rawMin = Math.min.apply(null, allValues.concat([0]));
  const max = rawMax * 1.08;
  const min = rawMin;
  const span = max - min || 1;
  const stepX = plotW / Math.max(points.length - 1, 1);

  function yFor(v) {
    return padTop + plotH - ((v - min) / span) * plotH;
  }

  const coords = points.map((p, i) => [padLeft + i * stepX, yFor(p.total)]);

  // Gridlines + y-axis labels, 4 bands.
  const bands = 4;
  let gridlines = '';
  for (let b = 0; b <= bands; b++) {
    const v = min + (span * b) / bands;
    const y = yFor(v);
    gridlines +=
      '<line x1="' + padLeft + '" y1="' + y.toFixed(1) + '" x2="' + (width - padRight) + '" y2="' + y.toFixed(1) +
      '" stroke="#e7e4db" stroke-width="1" />' +
      '<text x="' + (padLeft - 10) + '" y="' + (y + 4).toFixed(1) + '" font-size="12" text-anchor="end" fill="#8a8578">' +
      fmtUsdShort(v) +
      '</text>';
  }

  const path = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
  const areaPath =
    path + ' L' + coords[coords.length - 1][0].toFixed(1) + ',' + (padTop + plotH).toFixed(1) +
    ' L' + coords[0][0].toFixed(1) + ',' + (padTop + plotH).toFixed(1) + ' Z';

  const dots = coords
    .map((c, i) => {
      const isLast = i === coords.length - 1;
      return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="' + (isLast ? 5.5 : 4) +
        '" fill="#2a6f5b" stroke="#fff" stroke-width="' + (isLast ? 2 : 0) + '" />';
    })
    .join('');

  const labels = points
    .map((p, i) => {
      const x = coords[i][0];
      return (
        '<text x="' + x.toFixed(1) + '" y="' + (height - 14) + '" font-size="12" text-anchor="middle" fill="#6b6657">' +
        escapeHtml(p.week.replace('2026-', '')) +
        '</text>'
      );
    })
    .join('');

  const last = coords[coords.length - 1];
  const lastValue = points[points.length - 1].total;
  // Push the latest-value label above the line, further up if the dashed goal line sits close by.
  const labelAboveLine = goal && Math.abs(yFor(goal) - last[1]) < 24;
  const latestLabelY = last[1] - (labelAboveLine ? 24 : 12);
  const latestLabel =
    '<text x="' + (last[0] + 10).toFixed(1) + '" y="' + latestLabelY.toFixed(1) +
    '" font-size="13" font-weight="700" fill="#1b2b2a" text-anchor="' + (last[0] > width - 120 ? 'end' : 'start') + '">' +
    fmtUsdShort(lastValue) +
    '</text>';

  let goalLine = '';
  if (goal) {
    const gy = yFor(goal);
    goalLine =
      '<line x1="' + padLeft + '" y1="' + gy.toFixed(1) + '" x2="' + (width - padRight) + '" y2="' + gy.toFixed(1) +
      '" stroke="#b5542a" stroke-width="2" stroke-dasharray="6,5" />' +
      '<text x="' + padLeft + '" y="' + (gy - 8).toFixed(1) +
      '" font-size="12" text-anchor="start" fill="#b5542a" font-weight="600">Goal ' + fmtUsdShort(goal) + '</text>';
  }

  return (
    '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet">' +
    gridlines +
    '<path d="' + areaPath + '" fill="#2a6f5b" fill-opacity="0.08" stroke="none" />' +
    '<path d="' + path + '" fill="none" stroke="#2a6f5b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />' +
    goalLine +
    dots +
    latestLabel +
    labels +
    '</svg>'
  );
}

function renderTable(columns, rows, numericColumns, statusColumn) {
  const head =
    '<tr>' +
    columns
      .map((c, i) => '<th class="' + (numericColumns && numericColumns[i] ? 'num' : '') + '">' + escapeHtml(c) + '</th>')
      .join('') +
    '</tr>';
  const body = rows
    .map(
      (row) =>
        '<tr>' +
        row
          .map((cell, i) => {
            if (typeof statusColumn === 'number' && i === statusColumn) {
              return '<td>' + renderStatusBadge(cell) + '</td>';
            }
            const cls = numericColumns && numericColumns[i] ? 'num' : '';
            return '<td class="' + cls + '">' + escapeHtml(cell) + '</td>';
          })
          .join('') +
        '</tr>'
    )
    .join('');
  return '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

function renderStatusBadge(rawValue) {
  const def = STATUS_BADGE[rawValue] || { label: String(rawValue), tone: 'neutral', icon: '' };
  return '<span class="badge badge-' + def.tone + '">' + def.icon + ' ' + escapeHtml(def.label) + '</span>';
}

function renderTile(t) {
  const toneClass = t.tone ? 'tile-' + t.tone : '';
  return (
    '<div class="tile ' + toneClass + '">' +
    '<div class="tile-value">' + escapeHtml(t.value) + '</div>' +
    '<div class="tile-label">' + escapeHtml(t.label) + '</div>' +
    (t.status ? '<div class="tile-status">' + escapeHtml(t.status) + '</div>' : '') +
    '</div>'
  );
}

function renderTiles(tiles, columns, large) {
  const cols = columns || 4;
  const sizeClass = large ? 'tiles-large' : '';
  return '<div class="tiles tiles-cols-' + cols + ' ' + sizeClass + '">' + tiles.map(renderTile).join('') + '</div>';
}

function describeRiskGroup(shown, total, label) {
  if (total === 0) return null;
  if (shown >= total) return (total === 1 ? 'the 1 ' + label + ' store' : 'all ' + total + ' ' + label + ' stores');
  return shown + ' of ' + total + ' ' + label + ' stores';
}

function renderInventoryFootnote(summary) {
  const parts = [
    describeRiskGroup(summary.stockOutShown, summary.stockOutRiskCount, 'stock-out risk'),
    describeRiskGroup(summary.overstockShown, summary.overstockCount, 'overstock')
  ].filter(Boolean);
  const showing = parts.length > 0 ? 'Showing ' + parts.join(' and ') + '.' : 'No stores are currently flagged.';
  return showing + ' ' + pluralizeWord(summary.totalFlagged, 'flagged store') + ' out of ' + summary.totalStores + ' total.';
}

const BAR_SCALE_MAX = 150; // % attainment that fills the bar track completely

function renderBarList(items) {
  return (
    '<div class="bar-list">' +
    items
      .map((item) => {
        const tone = item.pct >= 100 ? 'good' : item.pct >= 90 ? 'watch' : 'bad';
        const width = Math.max(2, Math.min(100, (item.pct / BAR_SCALE_MAX) * 100));
        return (
          '<div class="bar-row">' +
          '<div class="bar-label">' + escapeHtml(item.label) + '</div>' +
          '<div class="bar-track"><div class="bar-fill bar-' + tone + '" style="width:' + width.toFixed(1) + '%"></div></div>' +
          '<div class="bar-value">' + item.pct + '%</div>' +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}

function renderProgressBar(progress) {
  if (!progress) return '';
  const pctValue = Math.max(0, Math.min(100, progress.pct));
  const tone = pctValue >= 90 ? 'good' : pctValue >= 75 ? 'watch' : 'bad';
  return (
    '<div class="progress-block">' +
    '<div class="progress-row"><span>' + escapeHtml(progress.label) + '</span><span>' + pctValue + '%</span></div>' +
    '<div class="progress-track"><div class="progress-fill progress-' + tone + '" style="width:' + pctValue + '%"></div></div>' +
    '</div>'
  );
}

function renderSlideBody(slide) {
  switch (slide.type) {
    case 'title':
      return (
        '<div class="title-slide">' +
        '<div class="kicker">Weekly Field Performance</div>' +
        '<h1>' + escapeHtml(slide.title) + '</h1>' +
        '<p class="subtitle">' + escapeHtml(slide.content.subtitle) + '</p>' +
        '<p class="week">Week ' + escapeHtml(slide.content.week) + '</p>' +
        (slide.content.generatedAt
          ? '<p class="generated">Generated ' + escapeHtml(new Date(slide.content.generatedAt).toISOString().slice(0, 16).replace('T', ' ')) + ' UTC</p>'
          : '') +
        '</div>'
      );
    case 'bullets':
      return (
        '<div class="exec-summary">' +
        '<ul class="bullets">' + slide.content.bullets.map((b) => '<li>' + escapeHtml(b) + '</li>').join('') + '</ul>' +
        renderTiles(slide.content.tiles, 4) +
        (slide.content.callout
          ? '<div class="callout"><span class="callout-tag">What changed</span>' + escapeHtml(slide.content.callout) + '</div>'
          : '') +
        '</div>'
      );
    case 'tiles':
      if (slide.id === 'kpi-tiles') {
        return (
          '<div class="tiles-slide kpi-slide">' +
          '<div class="kpi-caption">' + slide.content.onTrackCount + ' of ' + slide.content.tiles.length + ' KPIs on track</div>' +
          renderTiles(slide.content.tiles, 3, true) +
          '<div class="tone-legend">' +
          '<span class="tone-legend-item"><span class="dot dot-good"></span>On Track</span>' +
          '<span class="tone-legend-item"><span class="dot dot-watch"></span>Watch</span>' +
          '<span class="tone-legend-item"><span class="dot dot-bad"></span>At Risk</span>' +
          '</div>' +
          '</div>'
        );
      }
      return (
        '<div class="tiles-slide">' +
        renderTiles(slide.content.tiles, slide.content.tiles.length > 4 ? 3 : 4) +
        renderProgressBar(slide.content.progress) +
        (slide.content.byRegion
          ? '<div class="region-breakdown"><h3>By Region</h3>' +
            renderTable(slide.content.byRegion.columns, slide.content.byRegion.rows, slide.content.byRegion.numericColumns) +
            '</div>'
          : '') +
        '</div>'
      );
    case 'table':
      if (slide.id === 'top-bottom-stores') {
        return (
          '<div class="two-col">' +
          '<div><h3>Top 5</h3>' + renderTable(slide.content.columns, slide.content.top, slide.content.numericColumns) +
          '<div class="bar-list-heading">Attainment</div>' + renderBarList(slide.content.topBars) + '</div>' +
          '<div><h3>Bottom 5</h3>' + renderTable(slide.content.columns, slide.content.bottom, slide.content.numericColumns) +
          '<div class="bar-list-heading">Attainment</div>' + renderBarList(slide.content.bottomBars) + '</div>' +
          '</div>'
        );
      }
      if (slide.id === 'sellout-by-region') {
        return (
          '<div class="table-slide">' +
          renderTable(slide.content.columns, slide.content.rows, slide.content.numericColumns) +
          '<div class="bar-list-heading">Attainment by Region</div>' +
          renderBarList(slide.content.bars) +
          '</div>'
        );
      }
      return (
        '<div class="table-slide">' +
        renderTable(slide.content.columns, slide.content.rows, slide.content.numericColumns, slide.content.statusColumn) +
        (slide.content.summary
          ? '<div class="table-footnote">' + renderInventoryFootnote(slide.content.summary) + '</div>'
          : '') +
        '</div>'
      );
    case 'trend-chart':
      return (
        '<div class="chart-slide">' +
        '<div class="chart">' + buildTrendSvg(slide.content.points, slide.content.goal) + '</div>' +
        '<div class="legend"><span class="legend-swatch legend-line"></span>Sell-out' +
        '<span class="legend-swatch legend-dash"></span>Goal (current week)</div>' +
        '</div>'
      );
    case 'actions':
      return (
        '<div class="actions-slide">' +
        '<ul class="action-list">' +
        slide.content.actions
          .map(
            (a, i) =>
              '<li class="action-row">' +
              '<span class="action-rank">' + (i + 1) + '</span>' +
              '<span class="action-text">' + escapeHtml(a.action) + '</span>' +
              '<span class="action-owner">' + escapeHtml(a.owner) + '</span>' +
              '</li>'
          )
          .join('') +
        '</ul>' +
        (slide.content.note ? '<div class="table-footnote">' + escapeHtml(slide.content.note) + '</div>' : '') +
        '</div>'
      );
    case 'checklist': {
      const passed = typeof slide.content.passedCount === 'number' ? slide.content.passedCount : slide.content.checks.filter((c) => c.passed).length;
      const total = slide.content.checks.length;
      return (
        '<div class="checklist-slide">' +
        '<div class="checklist-summary">' + passed + ' / ' + total + ' checks passed' +
        (slide.content.warningCount > 0 ? ' · ' + pluralizeWord(slide.content.warningCount, 'warning') : '') +
        '</div>' +
        '<ul class="checklist">' +
        slide.content.checks
          .map(
            (c) =>
              '<li class="' + (c.passed ? 'pass' : 'fail') + '">' +
              '<span class="check-icon">' + (c.passed ? '✓' : '✗') + '</span>' +
              '<span class="check-status">' + (c.passed ? 'PASS' : 'FAIL') + '</span>' +
              '<span class="check-desc">' + escapeHtml(c.description) + '</span>' +
              '</li>'
          )
          .join('') +
        '</ul>' +
        (slide.content.note ? '<div class="table-footnote">' + escapeHtml(slide.content.note) + '</div>' : '') +
        '</div>'
      );
    }
    default:
      return '';
  }
}

function renderDeckHtml(deckSpec) {
  const slidesHtml = deckSpec.slides
    .map(
      (slide, i) =>
        '<section class="slide">' +
        '<div class="slide-number">' + (i + 1) + ' / ' + deckSpec.slides.length + '</div>' +
        (slide.type !== 'title' ? '<h2>' + escapeHtml(slide.title) + '</h2>' : '') +
        renderSlideBody(slide) +
        '</section>'
    )
    .join('\n');

  return (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8" />' +
    '<title>Weekly Performance Report - ' + escapeHtml(deckSpec.week) + '</title>' +
    '<style>' + CSS + '</style></head><body>' +
    '<div class="deck">' + slidesHtml + '</div>' +
    '</body></html>\n'
  );
}

const CSS = `
  :root {
    --ink:#1b2b2a; --ink-soft:#5b5a52; --accent:#2a6f5b; --accent-dark:#1f5445;
    --bg:#f3f1ea; --card:#ffffff; --line:#e7e4db;
    --good:#2a6f5b; --good-bg:#e4f0ea;
    --watch:#9a6d1a; --watch-bg:#f7efdd;
    --bad:#a13a2f; --bad-bg:#f8e7e4;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color:var(--ink); }
  .deck { display:flex; flex-direction:column; gap:28px; padding:28px; align-items:center; }
  .slide { width:960px; height:540px; background:var(--card); border-radius:10px; box-shadow:0 2px 14px rgba(0,0,0,0.12);
    padding:36px 48px 30px; position:relative; display:flex; flex-direction:column; justify-content:flex-start; overflow:hidden; }
  .slide h2 { margin:0 0 16px; font-size:24px; font-weight:700; color:var(--accent-dark); border-bottom:2px solid var(--accent); padding-bottom:8px; letter-spacing:-0.01em; }
  .slide h3 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-soft); font-weight:700; }
  .slide-number { position:absolute; bottom:14px; right:20px; font-size:11px; color:#a39f92; }

  .title-slide { margin:auto; text-align:center; }
  .title-slide .kicker { font-size:13px; letter-spacing:0.12em; text-transform:uppercase; color:var(--accent); font-weight:700; margin-bottom:10px; }
  .title-slide h1 { font-size:42px; margin:0 0 14px; color:var(--ink); font-weight:800; letter-spacing:-0.01em; }
  .title-slide .subtitle { font-size:18px; color:var(--ink-soft); margin:0; }
  .title-slide .week { font-size:15px; color:#8a8578; margin-top:8px; }
  .title-slide .generated { font-size:12px; color:#b1ad9f; margin-top:28px; }

  .exec-summary { display:flex; flex-direction:column; gap:18px; flex:1; justify-content:space-between; }
  ul.bullets { font-size:21px; line-height:1.55; padding-left:24px; margin:0; font-weight:500; }
  ul.bullets li { margin-bottom:6px; }
  .callout { background:var(--good-bg); border-left:4px solid var(--good); border-radius:6px; padding:14px 18px; font-size:15px; color:var(--ink); }
  .callout-tag { display:block; font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--good); font-weight:700; margin-bottom:4px; }

  .tiles { display:grid; gap:16px; }
  .tiles-cols-3 { grid-template-columns:repeat(3,1fr); }
  .tiles-cols-4 { grid-template-columns:repeat(4,1fr); }
  .tiles-slide .tiles { margin-bottom:10px; }
  .tile { background:#f7f6f1; border:1px solid var(--line); border-radius:10px; padding:16px 14px; text-align:center; }
  .tiles-large .tile { padding:26px 18px; }
  .tiles-large .tile-value { font-size:34px; }
  .tiles-large .tile-label { font-size:13.5px; margin-top:8px; }
  .tiles-large .tile-status { font-size:12px; margin-top:12px; }
  .tile-value { font-size:26px; font-weight:800; color:var(--ink); letter-spacing:-0.01em; }
  .tile-label { font-size:12px; color:var(--ink-soft); margin-top:6px; font-weight:600; }
  .tile-status { font-size:11px; font-weight:700; margin-top:8px; display:inline-block; padding:2px 8px; border-radius:999px; }
  .tile-good .tile-value { color:var(--good); } .tile-good .tile-status { color:var(--good); background:var(--good-bg); }
  .tile-watch .tile-value { color:var(--watch); } .tile-watch .tile-status { color:var(--watch); background:var(--watch-bg); }
  .tile-bad .tile-value { color:var(--bad); } .tile-bad .tile-status { color:var(--bad); background:var(--bad-bg); }

  .kpi-slide { flex:1; display:flex; flex-direction:column; justify-content:space-between; }
  .kpi-caption { font-size:15px; font-weight:700; color:var(--accent-dark); margin-bottom:18px; }
  .tone-legend { display:flex; gap:26px; justify-content:center; font-size:13px; color:var(--ink-soft); font-weight:600; margin-top:auto; padding-top:18px; border-top:1px solid var(--line); }
  .tone-legend-item { display:flex; align-items:center; gap:7px; }
  .dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
  .dot-good { background:var(--good); } .dot-watch { background:var(--watch); } .dot-bad { background:var(--bad); }

  .progress-block { margin:14px 0 10px; }
  .progress-row { display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--ink-soft); margin-bottom:6px; }
  .progress-track { height:14px; background:#ece9e0; border-radius:999px; overflow:hidden; }
  .progress-fill { height:100%; border-radius:999px; }
  .progress-good { background:var(--good); } .progress-watch { background:var(--watch); } .progress-bad { background:var(--bad); }

  .region-breakdown { margin-top:auto; }

  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); }
  th { color:var(--ink-soft); font-weight:700; text-transform:uppercase; font-size:10.5px; letter-spacing:0.05em; }
  th.num, td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tbody tr:nth-child(odd) { background:#fafaf6; }

  .badge { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700; padding:3px 9px; border-radius:999px; }
  .badge-good { color:var(--good); background:var(--good-bg); }
  .badge-watch { color:var(--watch); background:var(--watch-bg); }
  .badge-bad { color:var(--bad); background:var(--bad-bg); }

  .two-col { display:flex; gap:28px; flex:1; }
  .two-col > div { flex:1; display:flex; flex-direction:column; }

  .bar-list-heading { font-size:10.5px; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-soft); font-weight:700; margin:16px 0 8px; }
  .bar-list { display:flex; flex-direction:column; gap:9px; }
  .bar-row { display:grid; grid-template-columns:110px 1fr 46px; align-items:center; gap:10px; font-size:12.5px; }
  .bar-label { color:var(--ink); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar-track { height:10px; background:#ece9e0; border-radius:999px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:999px; }
  .bar-good { background:var(--good); } .bar-watch { background:var(--watch); } .bar-bad { background:var(--bad); }
  .bar-value { text-align:right; font-weight:700; color:var(--ink-soft); font-variant-numeric:tabular-nums; }

  .table-slide { display:flex; flex-direction:column; flex:1; }
  .table-footnote { margin-top:auto; padding-top:14px; font-size:13px; color:var(--ink-soft); }

  .chart-slide { display:flex; flex-direction:column; flex:1; }
  .chart { display:flex; justify-content:center; align-items:center; flex:1; }
  .chart svg { width:100%; height:100%; max-height:400px; }
  .legend { display:flex; gap:22px; justify-content:center; font-size:12.5px; color:var(--ink-soft); font-weight:600; margin-top:4px; }
  .legend-swatch { display:inline-block; width:18px; height:3px; margin-right:6px; vertical-align:middle; }
  .legend-line { background:var(--accent); }
  .legend-dash { background:repeating-linear-gradient(90deg,#b5542a 0 6px, transparent 6px 11px); }

  .actions-slide { display:flex; flex-direction:column; flex:1; }
  ul.action-list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px; }
  .action-row { display:grid; grid-template-columns:30px 1fr auto; align-items:center; gap:14px; padding:12px 14px; background:#f7f6f1; border:1px solid var(--line); border-radius:8px; }
  .action-rank { width:26px; height:26px; border-radius:50%; background:var(--accent); color:#fff; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; }
  .action-text { font-size:14.5px; color:var(--ink); font-weight:500; }
  .action-owner { font-size:12px; font-weight:700; color:var(--accent-dark); background:var(--good-bg); padding:4px 10px; border-radius:999px; white-space:nowrap; }

  .checklist-slide { display:flex; flex-direction:column; flex:1; }
  .checklist-summary { font-size:16px; font-weight:800; color:var(--accent-dark); margin-bottom:14px; }
  ul.checklist { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; }
  ul.checklist li { display:flex; align-items:center; gap:10px; font-size:15px; padding:11px 2px; border-bottom:1px solid var(--line); }
  .check-icon { font-weight:800; width:16px; font-size:15px; }
  .check-status { font-weight:800; width:42px; font-size:11px; letter-spacing:0.04em; }
  ul.checklist li.pass { color:var(--good); }
  ul.checklist li.fail { color:var(--bad); }
  .check-desc { color:var(--ink); font-weight:500; }
`;

if (typeof module !== 'undefined') {
  module.exports = { renderDeckHtml, buildTrendSvg, fmtUsdShort, renderInventoryFootnote, pluralizeWord };
}
