// stats.js — 基础统计与数据结构工具
window.Stats = (function () {
  'use strict';

  function isMissing(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && isNaN(v));
  }

  function isNumeric(v) {
    return typeof v === 'number' && !isNaN(v);
  }

  function mean(arr) {
    const a = arr.filter(isNumeric);
    if (!a.length) return null;
    return a.reduce((s, x) => s + x, 0) / a.length;
  }

  function median(arr) {
    const a = arr.filter(isNumeric).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function std(arr) {
    const a = arr.filter(isNumeric);
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  }

  function quantile(arr, q) {
    const a = arr.filter(isNumeric).sort((x, y) => x - y);
    if (!a.length) return null;
    const pos = (a.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (a[base + 1] !== undefined) return a[base] + rest * (a[base + 1] - a[base]);
    return a[base];
  }

  function mode(arr) {
    const a = arr.filter((v) => !isMissing(v));
    if (!a.length) return null;
    const counts = new Map();
    let best = a[0], bestN = 0;
    for (const v of a) {
      const k = String(v);
      const n = (counts.get(k) || 0) + 1;
      counts.set(k, n);
      if (n > bestN) { bestN = n; best = v; }
    }
    return best;
  }

  function uniqueArr(arr) {
    return [...new Set(arr.filter((v) => !isMissing(v)).map(String))];
  }

  function pearson(a, b) {
    const pairs = [];
    for (let i = 0; i < a.length; i++) {
      if (isNumeric(a[i]) && isNumeric(b[i])) pairs.push([a[i], b[i]]);
    }
    if (pairs.length < 3) return 0;
    const ma = mean(pairs.map((p) => p[0]));
    const mb = mean(pairs.map((p) => p[1]));
    let num = 0, da = 0, db = 0;
    for (const [x, y] of pairs) {
      num += (x - ma) * (y - mb);
      da += (x - ma) * (x - ma);
      db += (y - mb) * (y - mb);
    }
    if (da === 0 || db === 0) return 0;
    return num / Math.sqrt(da * db);
  }

  function iqrOutliers(arr) {
    const q1 = quantile(arr, 0.25);
    const q3 = quantile(arr, 0.75);
    if (q1 === null || q3 === null) return { low: null, high: null, count: 0, q1, q3, iqr: 0 };
    const iqr = q3 - q1;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    const count = arr.filter((v) => isNumeric(v) && (v < low || v > high)).length;
    return { low, high, count, q1, q3, iqr };
  }

  function zOutliers(arr, threshold) {
    threshold = threshold || 3;
    const m = mean(arr);
    const s = std(arr);
    if (m === null || s === 0) return { count: 0 };
    const count = arr.filter((v) => isNumeric(v) && Math.abs((v - m) / s) > threshold).length;
    return { count, mean: m, std: s };
  }

  function histogram(arr, binsCount) {
    binsCount = binsCount || 12;
    const a = arr.filter(isNumeric);
    if (!a.length) return { labels: [], values: [] };
    const min = Math.min(...a);
    const max = Math.max(...a);
    if (min === max) return { labels: [String(min)], values: [a.length] };
    const width = (max - min) / binsCount;
    const counts = new Array(binsCount).fill(0);
    for (const v of a) {
      let idx = Math.floor((v - min) / width);
      if (idx >= binsCount) idx = binsCount - 1;
      counts[idx]++;
    }
    const labels = counts.map((_, i) => (min + i * width).toFixed(2) + '-' + (min + (i + 1) * width).toFixed(2));
    return { labels, values: counts, min, max, width };
  }

  function valueCounts(arr) {
    const counts = new Map();
    for (const v of arr) {
      if (isMissing(v)) continue;
      const k = String(v);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  return {
    isMissing, isNumeric, mean, median, std, quantile, mode,
    uniqueArr, pearson, iqrOutliers, zOutliers, histogram, valueCounts
  };
})();

// 数据集结构工具
window.DataUtil = (function () {
  'use strict';

  function inferType(values) {
    let numeric = 0, nonMissing = 0;
    for (const v of values) {
      if (Stats.isMissing(v)) continue;
      nonMissing++;
      if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) numeric++;
    }
    if (nonMissing === 0) return 'text';
    if (numeric / nonMissing > 0.85) return 'number';
    const uniq = Stats.uniqueArr(values).length;
    if (uniq <= Math.max(20, values.length * 0.2)) return 'category';
    return 'text';
  }

  function detectTypes(rows, columns) {
    return columns.map((c) => {
      const vals = rows.map((r) => r[c.key]);
      return { ...c, type: inferType(vals) };
    });
  }

  function clone(rows) {
    return rows.map((r) => ({ ...r }));
  }

  function shape(rows, columns) {
    const cells = rows.length * columns.length;
    let missing = 0;
    for (const r of rows) for (const c of columns) if (Stats.isMissing(r[c.key])) missing++;
    return { rows: rows.length, cols: columns.length, cells, missing };
  }

  function columnValues(rows, key) {
    return rows.map((r) => r[key]);
  }

  function duplicateCount(rows) {
    const seen = new Set();
    let dup = 0;
    for (const r of rows) {
      const k = JSON.stringify(r);
      if (seen.has(k)) dup++;
      else seen.add(k);
    }
    return dup;
  }

  return { inferType, detectTypes, clone, shape, columnValues, duplicateCount };
})();