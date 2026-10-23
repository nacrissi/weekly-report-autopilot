// Pure KPI core. No Apps Script globals, no Node globals.
// Data in, numbers out. Every number here is a straightforward sum, ratio,
// or sort so a reviewer can re-derive it by hand from the raw rows.
//
// Input shape:
// {
//   week: '2026-W42',
//   priorWeek: '2026-W41',
//   stores: [{ store_id, store_name, region }, ...],
//   sellout:    [{ week, store_id, sellout_usd }, ...]            (current week)
//   priorSellout: [...]                                            (prior week, for WoW)
//   goals:      [{ week, store_id, goal_usd }, ...]
//   inventory:  [{ week, store_id, units_on_hand, avg_weekly_units_sold }, ...]
//   storeVisits:[{ week, store_id, visits_scheduled, visits_completed }, ...]
//   trainingCompletion: [{ week, store_id, staff_total, staff_trained }, ...]
//   staffing:   [{ week, store_id, positions_required, positions_filled }, ...]
//   salesHistory: [{ week, rows: [sellout rows] }, ...]            (oldest -> newest, for the 6-week trend)
// }

var WEEKS_OF_COVER_LOW = 2;   // below this: stock-out risk
var WEEKS_OF_COVER_HIGH = 12; // above this: overstock risk
var UNDERSTAFFED_THRESHOLD = 0.80;

function buildStoreMap(stores) {
  var map = {};
  for (var i = 0; i < stores.length; i++) {
    map[stores[i].store_id] = stores[i];
  }
  return map;
}

function sum(arr, pick) {
  var total = 0;
  for (var i = 0; i < arr.length; i++) total += Number(pick(arr[i])) || 0;
  return total;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return round1((numerator / denominator) * 100);
}

function sellOutByRegion(sellout, goals, priorSellout, stores) {
  var storeMap = buildStoreMap(stores);
  var regions = {};

  function ensure(region) {
    if (!regions[region]) {
      regions[region] = { region: region, sellout: 0, goal: 0, priorSellout: 0 };
    }
    return regions[region];
  }

  for (var i = 0; i < sellout.length; i++) {
    var row = sellout[i];
    var store = storeMap[row.store_id];
    var region = store ? store.region : 'Unknown';
    ensure(region).sellout += Number(row.sellout_usd) || 0;
  }
  for (var j = 0; j < goals.length; j++) {
    var grow = goals[j];
    var gstore = storeMap[grow.store_id];
    var gregion = gstore ? gstore.region : 'Unknown';
    ensure(gregion).goal += Number(grow.goal_usd) || 0;
  }
  for (var k = 0; k < priorSellout.length; k++) {
    var prow = priorSellout[k];
    var pstore = storeMap[prow.store_id];
    var pregion = pstore ? pstore.region : 'Unknown';
    ensure(pregion).priorSellout += Number(prow.sellout_usd) || 0;
  }

  var result = Object.keys(regions).sort().map(function (region) {
    var r = regions[region];
    return {
      region: region,
      sellout: r.sellout,
      goal: r.goal,
      attainmentPct: pct(r.sellout, r.goal),
      priorSellout: r.priorSellout,
      wowChangePct: pct(r.sellout - r.priorSellout, r.priorSellout)
    };
  });
  return result;
}

function storeSellOutRanking(sellout, goals, stores) {
  var storeMap = buildStoreMap(stores);
  var goalByStore = {};
  for (var i = 0; i < goals.length; i++) {
    goalByStore[goals[i].store_id] = Number(goals[i].goal_usd) || 0;
  }

  var ranked = sellout.map(function (row) {
    var store = storeMap[row.store_id] || { store_name: row.store_id, region: 'Unknown' };
    var goal = goalByStore[row.store_id] || 0;
    var selloutUsd = Number(row.sellout_usd) || 0;
    return {
      store_id: row.store_id,
      store_name: store.store_name,
      region: store.region,
      sellout: selloutUsd,
      goal: goal,
      attainmentPct: pct(selloutUsd, goal)
    };
  });

  ranked.sort(function (a, b) {
    return b.attainmentPct - a.attainmentPct;
  });

  return ranked;
}

function inventoryRisk(inventory, stores) {
  var storeMap = buildStoreMap(stores);
  var rows = inventory.map(function (row) {
    var store = storeMap[row.store_id] || { store_name: row.store_id, region: 'Unknown' };
    var onHand = Number(row.units_on_hand) || 0;
    var weeklySold = Number(row.avg_weekly_units_sold) || 0;
    var weeksOfCover = weeklySold > 0 ? round1(onHand / weeklySold) : null;
    var category;
    if (weeksOfCover === null) {
      category = weeklySold === 0 && onHand > 0 ? 'overstock' : 'healthy';
    } else if (weeksOfCover < WEEKS_OF_COVER_LOW) {
      category = 'stock-out-risk';
    } else if (weeksOfCover > WEEKS_OF_COVER_HIGH) {
      category = 'overstock';
    } else {
      category = 'healthy';
    }
    return {
      store_id: row.store_id,
      store_name: store.store_name,
      region: store.region,
      weeksOfCover: weeksOfCover,
      category: category
    };
  });

  var atRisk = rows.filter(function (r) { return r.category !== 'healthy'; })
    .sort(function (a, b) {
      return (a.weeksOfCover === null ? 999 : a.weeksOfCover) - (b.weeksOfCover === null ? 999 : b.weeksOfCover);
    });

  return {
    stores: rows,
    atRisk: atRisk,
    stockOutRiskCount: rows.filter(function (r) { return r.category === 'stock-out-risk'; }).length,
    overstockCount: rows.filter(function (r) { return r.category === 'overstock'; }).length
  };
}

/** Sums two columns per region and returns the ratio, for compliance/completion style rates. */
function byRegionRate(rows, stores, numeratorKey, denominatorKey) {
  var storeMap = buildStoreMap(stores);
  var regions = {};

  rows.forEach(function (row) {
    var store = storeMap[row.store_id];
    var region = store ? store.region : 'Unknown';
    if (!regions[region]) regions[region] = { region: region, numerator: 0, denominator: 0 };
    regions[region].numerator += Number(row[numeratorKey]) || 0;
    regions[region].denominator += Number(row[denominatorKey]) || 0;
  });

  return Object.keys(regions).sort().map(function (region) {
    var r = regions[region];
    return { region: region, numerator: r.numerator, denominator: r.denominator, pct: pct(r.numerator, r.denominator) };
  });
}

function visitCompliance(storeVisits, stores) {
  var scheduled = sum(storeVisits, function (r) { return r.visits_scheduled; });
  var completed = sum(storeVisits, function (r) { return r.visits_completed; });
  return {
    scheduled: scheduled,
    completed: completed,
    compliancePct: pct(completed, scheduled),
    byRegion: byRegionRate(storeVisits, stores || [], 'visits_completed', 'visits_scheduled')
  };
}

function trainingCompletionRate(trainingCompletion, stores) {
  var total = sum(trainingCompletion, function (r) { return r.staff_total; });
  var trained = sum(trainingCompletion, function (r) { return r.staff_trained; });
  return {
    staffTotal: total,
    staffTrained: trained,
    completionPct: pct(trained, total),
    byRegion: byRegionRate(trainingCompletion, stores || [], 'staff_trained', 'staff_total')
  };
}

function staffingCoverage(staffing, stores) {
  var storeMap = buildStoreMap(stores);
  var required = sum(staffing, function (r) { return r.positions_required; });
  var filled = sum(staffing, function (r) { return r.positions_filled; });

  var understaffed = staffing
    .map(function (row) {
      var store = storeMap[row.store_id] || { store_name: row.store_id, region: 'Unknown' };
      var req = Number(row.positions_required) || 0;
      var fill = Number(row.positions_filled) || 0;
      return {
        store_id: row.store_id,
        store_name: store.store_name,
        region: store.region,
        coveragePct: pct(fill, req)
      };
    })
    .filter(function (r) { return r.coveragePct < UNDERSTAFFED_THRESHOLD * 100; })
    .sort(function (a, b) { return a.coveragePct - b.coveragePct; });

  return { required: required, filled: filled, coveragePct: pct(filled, required), understaffed: understaffed };
}

function sixWeekTrend(salesHistory) {
  if (!Array.isArray(salesHistory)) return [];
  return salesHistory.map(function (entry) {
    return {
      week: entry.week,
      total: sum(entry.rows || [], function (r) { return r.sellout_usd; })
    };
  });
}

function computeMetrics(input) {
  input = input || {};
  var stores = input.stores || [];
  var sellout = input.sellout || [];
  var priorSellout = input.priorSellout || [];
  var goals = input.goals || [];
  var inventory = input.inventory || [];
  var storeVisits = input.storeVisits || [];
  var trainingCompletion = input.trainingCompletion || [];
  var staffing = input.staffing || [];

  var totalSellout = sum(sellout, function (r) { return r.sellout_usd; });
  var totalGoal = sum(goals, function (r) { return r.goal_usd; });
  var totalPriorSellout = sum(priorSellout, function (r) { return r.sellout_usd; });

  var ranked = storeSellOutRanking(sellout, goals, stores);

  return {
    week: input.week,
    priorWeek: input.priorWeek,
    totals: {
      sellout: totalSellout,
      goal: totalGoal,
      attainmentPct: pct(totalSellout, totalGoal),
      priorSellout: totalPriorSellout,
      wowChangePct: pct(totalSellout - totalPriorSellout, totalPriorSellout)
    },
    byRegion: sellOutByRegion(sellout, goals, priorSellout, stores),
    topStores: ranked.slice(0, 5),
    bottomStores: ranked.slice(-5).reverse(),
    inventory: inventoryRisk(inventory, stores),
    visitCompliance: visitCompliance(storeVisits, stores),
    training: trainingCompletionRate(trainingCompletion, stores),
    staffing: staffingCoverage(staffing, stores),
    trend: sixWeekTrend(input.salesHistory)
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    computeMetrics: computeMetrics,
    sellOutByRegion: sellOutByRegion,
    storeSellOutRanking: storeSellOutRanking,
    inventoryRisk: inventoryRisk,
    visitCompliance: visitCompliance,
    trainingCompletionRate: trainingCompletionRate,
    byRegionRate: byRegionRate,
    staffingCoverage: staffingCoverage,
    sixWeekTrend: sixWeekTrend
  };
}
