// Pure deck-spec core. No Apps Script globals, no Node globals.
// Turns a metrics object + a validation result into a platform-neutral,
// JSON-serializable slide spec. Exactly 11 slides, same order every time.
//
// Tone/status fields (e.g. on a tile: { tone: 'good'|'watch'|'bad', status: 'On Track' })
// are part of the spec, not the renderer: any renderer (HTML, Slides) should
// be able to color a shape red/amber/green AND show the status word, so
// color is never the only signal.

var SLIDE_TITLES = [
  'Weekly Performance Report',
  'Executive Summary',
  'KPI Tiles',
  'Sell-Out by Region',
  'Top & Bottom Stores',
  '6-Week Trend',
  'Inventory Risk',
  'Visit Compliance',
  'Training Completion',
  'Actions & Owners',
  'Data Quality Appendix'
];

function fmtUsd(n) {
  var rounded = Math.round(n);
  return '$' + rounded.toLocaleString('en-US');
}

function fmtPct(n) {
  return n + '%';
}

function pluralize(n, singular, plural) {
  return n + ' ' + (n === 1 ? singular : plural || singular + 's');
}

function toneForPct(pctValue, goodAt, watchAt) {
  if (pctValue >= goodAt) return { tone: 'good', status: 'On Track' };
  if (pctValue >= watchAt) return { tone: 'watch', status: 'Watch' };
  return { tone: 'bad', status: 'At Risk' };
}

function toneForChange(pctValue) {
  return pctValue >= 0 ? { tone: 'good', status: 'Up' } : { tone: 'bad', status: 'Down' };
}

function toneForCount(n, watchMax) {
  if (n === 0) return { tone: 'good', status: 'Clear' };
  if (n <= watchMax) return { tone: 'watch', status: 'Watch' };
  return { tone: 'bad', status: 'At Risk' };
}

function pctTile(label, pctValue, goodAt, watchAt) {
  var t = toneForPct(pctValue, goodAt, watchAt);
  return { label: label, value: fmtPct(pctValue), tone: t.tone, status: t.status };
}

function changeTile(label, pctValue) {
  var t = toneForChange(pctValue);
  var arrow = pctValue >= 0 ? '▲ ' : '▼ ';
  return { label: label, value: arrow + fmtPct(Math.abs(pctValue)), tone: t.tone, status: t.status };
}

function countTile(label, n, watchMax) {
  var t = toneForCount(n, watchMax);
  return { label: label, value: String(n), tone: t.tone, status: t.status };
}

function buildExecutiveSummaryBullets(metrics) {
  var t = metrics.totals;
  var bullets = [];

  bullets.push(
    'Sell-out reached ' + fmtUsd(t.sellout) + ' (' + fmtPct(t.attainmentPct) + ' of goal), ' +
    (t.wowChangePct >= 0 ? 'up ' : 'down ') + fmtPct(Math.abs(t.wowChangePct)) + ' week-over-week.'
  );

  var regions = metrics.byRegion.slice().sort(function (a, b) { return b.attainmentPct - a.attainmentPct; });
  if (regions.length > 0) {
    var best = regions[0];
    var worst = regions[regions.length - 1];
    bullets.push(
      best.region + ' led at ' + fmtPct(best.attainmentPct) + ' of goal; ' +
      worst.region + ' trailed at ' + fmtPct(worst.attainmentPct) + '.'
    );
  }

  bullets.push(
    pluralize(metrics.inventory.stockOutRiskCount, 'store') + ' at stock-out risk, visit compliance at ' +
    fmtPct(metrics.visitCompliance.compliancePct) + ', training completion at ' +
    fmtPct(metrics.training.completionPct) + '.'
  );

  return bullets;
}

function buildExecutiveSummaryTiles(metrics) {
  return [
    pctTile('Sell-Out vs Goal', metrics.totals.attainmentPct, 100, 90),
    changeTile('WoW Change', metrics.totals.wowChangePct),
    pctTile('Visit Compliance', metrics.visitCompliance.compliancePct, 90, 75),
    // Same number and concept as the executive summary bullet below (stock-out risk only).
    // KPI Tiles' "Stores at Inventory Risk" is a different, broader concept (stock-out + overstock) and is labeled as such.
    countTile('Stock-Out Risk', metrics.inventory.stockOutRiskCount, 5)
  ];
}

function buildActions(metrics) {
  var actions = [];

  metrics.bottomStores.slice(0, 2).forEach(function (store) {
    actions.push({
      action: 'Review sell-out plan for ' + store.store_name + ' (' + store.region + ', ' +
        fmtPct(store.attainmentPct) + ' of goal)',
      owner: 'Regional Sales Lead'
    });
  });

  metrics.inventory.atRisk
    .filter(function (s) { return s.category === 'stock-out-risk'; })
    .slice(0, 2)
    .forEach(function (store) {
      actions.push({
        action: 'Expedite replenishment for ' + store.store_name + ' (' + store.weeksOfCover + ' weeks of cover)',
        owner: 'Supply Chain'
      });
    });

  metrics.staffing.understaffed.slice(0, 2).forEach(function (store) {
    actions.push({
      action: 'Backfill open roles at ' + store.store_name + ' (' + fmtPct(store.coveragePct) + ' staffed)',
      owner: 'Store Operations'
    });
  });

  if (metrics.training.completionPct < 90) {
    actions.push({
      action: 'Close the training gap (' + fmtPct(metrics.training.completionPct) + ' complete)',
      owner: 'Learning & Development'
    });
  }

  return actions.slice(0, 6);
}

function buildDeckSpec(metrics, validation, context) {
  context = context || {};
  validation = validation || { checks: [], warnings: [], errors: [], ok: true };

  var actions = buildActions(metrics);
  var callout = actions.length > 0 ? 'Top priority: ' + actions[0].action : null;

  var kpiTiles = [
    pctTile('Sell-Out vs Goal', metrics.totals.attainmentPct, 100, 90),
    changeTile('WoW Change', metrics.totals.wowChangePct),
    pctTile('Visit Compliance', metrics.visitCompliance.compliancePct, 90, 75),
    pctTile('Training Completion', metrics.training.completionPct, 90, 75),
    pctTile('Staffing Coverage', metrics.staffing.coveragePct, 90, 75),
    countTile('Stores at Inventory Risk', metrics.inventory.atRisk.length, 10)
  ];

  var slides = [
    {
      id: 'title',
      type: 'title',
      title: SLIDE_TITLES[0],
      content: {
        subtitle: 'Field Performance Review',
        week: metrics.week,
        generatedAt: context.generatedAt || null
      }
    },
    {
      id: 'executive-summary',
      type: 'bullets',
      title: SLIDE_TITLES[1],
      content: {
        bullets: buildExecutiveSummaryBullets(metrics),
        tiles: buildExecutiveSummaryTiles(metrics),
        callout: callout
      }
    },
    {
      id: 'kpi-tiles',
      type: 'tiles',
      title: SLIDE_TITLES[2],
      content: {
        tiles: kpiTiles,
        onTrackCount: kpiTiles.filter(function (t) { return t.tone === 'good'; }).length
      }
    },
    {
      id: 'sellout-by-region',
      type: 'table',
      title: SLIDE_TITLES[3],
      content: {
        columns: ['Region', 'Sell-Out', 'Goal', 'Attainment', 'WoW'],
        numericColumns: [false, true, true, true, true],
        rows: metrics.byRegion.map(function (r) {
          return [r.region, fmtUsd(r.sellout), fmtUsd(r.goal), fmtPct(r.attainmentPct), fmtPct(r.wowChangePct)];
        }),
        bars: metrics.byRegion.map(function (r) {
          return { label: r.region, pct: r.attainmentPct };
        })
      }
    },
    {
      id: 'top-bottom-stores',
      type: 'table',
      title: SLIDE_TITLES[4],
      content: {
        top: metrics.topStores.map(function (s) {
          return [s.store_name, s.region, fmtUsd(s.sellout), fmtPct(s.attainmentPct)];
        }),
        bottom: metrics.bottomStores.map(function (s) {
          return [s.store_name, s.region, fmtUsd(s.sellout), fmtPct(s.attainmentPct)];
        }),
        columns: ['Store', 'Region', 'Sell-Out', 'Attainment'],
        numericColumns: [false, false, true, true],
        topBars: metrics.topStores.map(function (s) { return { label: s.store_name, pct: s.attainmentPct }; }),
        bottomBars: metrics.bottomStores.map(function (s) { return { label: s.store_name, pct: s.attainmentPct }; })
      }
    },
    {
      id: 'six-week-trend',
      type: 'trend-chart',
      title: SLIDE_TITLES[5],
      content: { points: metrics.trend, goal: metrics.totals.goal }
    },
    {
      id: 'inventory-risk',
      type: 'table',
      title: SLIDE_TITLES[6],
      content: (function () {
        var SHOWN_CAP = 8;
        // Stock-out risk is the urgent case, so it is shown in full first (already sorted
        // most severe first); overstock fills whatever room is left, most severe first.
        var stockOut = metrics.inventory.atRisk.filter(function (s) { return s.category === 'stock-out-risk'; });
        var overstock = metrics.inventory.atRisk
          .filter(function (s) { return s.category === 'overstock'; })
          .slice()
          .sort(function (a, b) { return b.weeksOfCover - a.weeksOfCover; });
        var stockOutShown = stockOut.slice(0, SHOWN_CAP);
        var overstockShown = overstock.slice(0, Math.max(0, SHOWN_CAP - stockOutShown.length));
        var shown = stockOutShown.concat(overstockShown);
        return {
          columns: ['Store', 'Region', 'Weeks of Cover', 'Status'],
          numericColumns: [false, false, true, false],
          statusColumn: 3,
          rows: shown.map(function (s) {
            return [s.store_name, s.region, s.weeksOfCover === null ? 'n/a' : String(s.weeksOfCover), s.category];
          }),
          summary: {
            stockOutRiskCount: metrics.inventory.stockOutRiskCount,
            overstockCount: metrics.inventory.overstockCount,
            stockOutShown: stockOutShown.length,
            overstockShown: overstockShown.length,
            shownCount: shown.length,
            totalFlagged: metrics.inventory.atRisk.length,
            totalStores: metrics.inventory.stores.length
          }
        };
      })()
    },
    {
      id: 'visit-compliance',
      type: 'tiles',
      title: SLIDE_TITLES[7],
      content: {
        tiles: [
          { label: 'Visits Scheduled', value: String(metrics.visitCompliance.scheduled), tone: 'neutral', status: '' },
          { label: 'Visits Completed', value: String(metrics.visitCompliance.completed), tone: 'neutral', status: '' },
          pctTile('Compliance', metrics.visitCompliance.compliancePct, 90, 75),
          countTile('Visits Missed', metrics.visitCompliance.scheduled - metrics.visitCompliance.completed, 10)
        ],
        progress: { label: 'Overall compliance', pct: metrics.visitCompliance.compliancePct },
        byRegion: {
          columns: ['Region', 'Scheduled', 'Completed', 'Compliance'],
          numericColumns: [false, true, true, true],
          rows: metrics.visitCompliance.byRegion.map(function (r) {
            return [r.region, String(r.denominator), String(r.numerator), fmtPct(r.pct)];
          })
        }
      }
    },
    {
      id: 'training-completion',
      type: 'tiles',
      title: SLIDE_TITLES[8],
      content: {
        tiles: [
          { label: 'Staff Total', value: String(metrics.training.staffTotal), tone: 'neutral', status: '' },
          { label: 'Staff Trained', value: String(metrics.training.staffTrained), tone: 'neutral', status: '' },
          pctTile('Completion', metrics.training.completionPct, 90, 75),
          countTile('Staff Not Yet Trained', metrics.training.staffTotal - metrics.training.staffTrained, 10)
        ],
        progress: { label: 'Overall completion', pct: metrics.training.completionPct },
        byRegion: {
          columns: ['Region', 'Staff Total', 'Staff Trained', 'Completion'],
          numericColumns: [false, true, true, true],
          rows: metrics.training.byRegion.map(function (r) {
            return [r.region, String(r.denominator), String(r.numerator), fmtPct(r.pct)];
          })
        }
      }
    },
    {
      id: 'actions-owners',
      type: 'actions',
      title: SLIDE_TITLES[9],
      content: {
        actions: actions,
        note: 'Actions regenerate each week from the latest validated numbers above.'
      }
    },
    {
      id: 'data-quality-appendix',
      type: 'checklist',
      title: SLIDE_TITLES[10],
      content: {
        checks: validation.checks,
        passedCount: validation.checks.filter(function (c) { return c.passed; }).length,
        warningCount: validation.warnings.length,
        warnings: validation.warnings,
        note: 'Every check below runs automatically before each build; a single failure blocks the deck.'
      }
    }
  ];

  return { week: metrics.week, generatedAt: context.generatedAt || null, slides: slides };
}

if (typeof module !== 'undefined') {
  module.exports = { buildDeckSpec: buildDeckSpec, SLIDE_TITLES: SLIDE_TITLES, pluralize: pluralize };
}
