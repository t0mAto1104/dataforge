// algo.js — 数据处理算法库（数据评估 / 预处理 / 清洗 / 增强）
// 所有算法均为本地纯 JS 实现，无外部依赖、数据不出浏览器。
window.Algo = (function () {
  'use strict';
  const S = Stats;
  const DU = DataUtil;

  function numericKeys(columns) {
    return columns.filter((c) => c.type === 'number').map((c) => c.key);
  }
  function catKeys(columns) {
    return columns.filter((c) => c.type === 'category').map((c) => c.key);
  }
  function isIdLike(key) {
    return /^(id|idx|编号|序号)$/i.test(key) || /(^|_)(id|idx|编号|序号)$/i.test(key);
  }

  // 按 keys 筛选列；keys 为 null/undefined 表示"全部列"，空数组表示"不作用于任何列"
  function scopeCols(columns, keys) {
    if (keys == null) return columns;
    const set = new Set(keys);
    return columns.filter((c) => set.has(c.key));
  }

  // ===================== 数据评估 =====================
  function profile(rows, columns) {
    return columns.map((c) => {
      const vals = rows.map((r) => r[c.key]);
      const nonMissing = vals.filter((v) => !S.isMissing(v));
      const missing = vals.length - nonMissing.length;
      const missingRate = vals.length ? missing / vals.length : 0;
      const uniq = S.uniqueArr(vals).length;
      let stats = null, outliers = null;
      if (c.type === 'number') {
        stats = {
          mean: S.mean(vals),
          median: S.median(vals),
          std: S.std(vals),
          min: nonMissing.length ? Math.min(...nonMissing) : null,
          max: nonMissing.length ? Math.max(...nonMissing) : null
        };
        outliers = S.iqrOutliers(vals);
      }
      // 质量分级：良好（绿）/ 偏差（黄）/ 关注（红）
      // 依据缺失率与异常值占比评估，不因样本量小直接判差
      let quality = 'good';
      const outlierRatio = outliers && vals.length ? outliers.count / vals.length : 0;
      if (missingRate > 0.1 || outlierRatio > 0.08) quality = 'mid';
      if (missingRate > 0.3) quality = 'bad';
      return {
        key: c.key, label: c.label, type: c.type,
        count: vals.length, missing, missingRate, uniq,
        stats, outliers, quality
      };
    });
  }

  function correlationMatrix(rows, columns) {
    const keys = numericKeys(columns);
    const m = keys.map((ka) =>
      keys.map((kb) => S.pearson(rows.map((r) => r[ka]), rows.map((r) => r[kb])))
    );
    return { matrix: m, keys, labels: keys.map((k) => (columns.find((c) => c.key === k) || {}).label || k) };
  }

  // ===================== 数据预处理 =====================
  function imputeMissing(rows, columns, strategy, keys) {
    const out = DU.clone(rows);
    const targets = scopeCols(columns, keys);
    for (const c of targets) {
      const vals = rows.map((r) => r[c.key]).filter((v) => !S.isMissing(v));
      let fill = null, apply = false;
      if (strategy === 'zero') {
        // 仅数值列：缺失填 0
        if (c.type === 'number') { fill = 0; apply = true; }
      } else if (strategy === 'null') {
        // 仅类别/文本列：缺失标记为 'NULL'
        if (c.type === 'category' || c.type === 'text') { fill = 'NULL'; apply = true; }
      } else {
        // mean / median / mode
        if (!vals.length) continue;
        if (c.type === 'number') {
          if (strategy === 'median') fill = S.median(vals);
          else if (strategy === 'mode') fill = S.mode(vals);
          else fill = S.mean(vals);
        } else {
          fill = S.mode(vals) !== null ? S.mode(vals) : vals[0];
        }
        apply = true;
      }
      if (!apply || fill === null || fill === undefined) continue;
      for (const r of out) if (S.isMissing(r[c.key])) r[c.key] = fill;
    }
    return out;
  }

  function standardize(rows, columns, method, keys) {
    const out = DU.clone(rows);
    const targets = scopeCols(columns, keys).filter((c) => c.type === 'number');
    for (const c of targets) {
      const vals = rows.map((r) => r[c.key]).filter((v) => S.isNumeric(v));
      if (!vals.length) continue;
      if (method === 'minmax') {
        const min = Math.min(...vals), max = Math.max(...vals);
        const span = max - min || 1;
        for (const r of out) if (S.isNumeric(r[c.key])) r[c.key] = (r[c.key] - min) / span;
      } else {
        const m = S.mean(vals), sd = S.std(vals) || 1;
        for (const r of out) if (S.isNumeric(r[c.key])) r[c.key] = (r[c.key] - m) / sd;
      }
    }
    return out;
  }

  function labelEncode(rows, columns, keys) {
    const out = DU.clone(rows);
    const targets = scopeCols(columns, keys).filter((c) => c.type === 'category');
    for (const c of targets) {
      const key = c.key;
      const map = new Map();
      let idx = 0;
      for (const r of out) {
        if (S.isMissing(r[key])) { r[key] = null; continue; }
        const k = String(r[key]);
        if (!map.has(k)) map.set(k, idx++);
        r[key] = map.get(k);
      }
    }
    return { rows: out, columns: columns.slice() };
  }

  function oneHotEncode(rows, columns, keys) {
    const out = DU.clone(rows);
    const targets = scopeCols(columns, keys).filter((c) => c.type === 'category');
    const targetSet = new Set(targets.map((c) => c.key));
    const newCols = columns.filter((c) => !targetSet.has(c.key)).map((c) => ({ ...c }));
    for (const c of targets) {
      const levels = S.uniqueArr(rows.map((r) => r[c.key]));
      for (const lv of levels) {
        const newKey = c.key + '_' + lv;
        const label = c.label + '=' + lv;
        for (const r of out) {
          r[newKey] = (!S.isMissing(r[c.key]) && String(r[c.key]) === lv) ? 1 : 0;
        }
        newCols.push({ key: newKey, label, type: 'number' });
      }
      for (const r of out) delete r[c.key];
    }
    return { rows: out, columns: newCols };
  }

  function dropColumns(rows, columns, keys) {
    const dropSet = new Set(keys);
    const newCols = columns.filter((c) => !dropSet.has(c.key));
    const out = rows.map((r) => {
      const o = {};
      for (const c of newCols) o[c.key] = r[c.key];
      return o;
    });
    return { rows: out, columns: newCols };
  }

  function dropMissingRows(rows, columns, keys) {
    const targets = scopeCols(columns, keys);
    return rows.filter((r) => !targets.some((c) => S.isMissing(r[c.key])));
  }

  // ===================== 数据清洗 =====================
  function dedup(rows) {
    const seen = new Set();
    return rows.filter((r) => {
      const k = JSON.stringify(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function _outlierBounds(rows, key, method, threshold) {
    const vals = rows.map((r) => r[key]).filter((v) => S.isNumeric(v));
    if (!vals.length) return { low: null, high: null };
    if (method === 'iqr') {
      const o = S.iqrOutliers(vals);
      return { low: o.low, high: o.high };
    }
    const m = S.mean(vals), sd = S.std(vals) || 1;
    return { low: m - threshold * sd, high: m + threshold * sd };
  }

  function removeOutlierRows(rows, columns, method, threshold, keys) {
    method = method || 'iqr';
    threshold = threshold || 1.5;
    const numKeys = scopeCols(columns, keys).filter((c) => c.type === 'number').map((c) => c.key);
    if (!numKeys.length) return DU.clone(rows);
    const bounds = {};
    for (const key of numKeys) bounds[key] = _outlierBounds(rows, key, method, threshold);
    return rows.filter((r) => {
      for (const key of numKeys) {
        const v = r[key];
        if (!S.isNumeric(v)) continue;
        const b = bounds[key];
        if (b.low !== null && (v < b.low || v > b.high)) return false;
      }
      return true;
    });
  }

  function clipOutliers(rows, columns, method, threshold, keys) {
    method = method || 'iqr';
    threshold = threshold || 1.5;
    const numKeys = scopeCols(columns, keys).filter((c) => c.type === 'number').map((c) => c.key);
    const out = DU.clone(rows);
    for (const key of numKeys) {
      const b = _outlierBounds(rows, key, method, threshold);
      if (b.low === null) continue;
      for (const r of out) {
        if (S.isNumeric(r[key])) {
          if (r[key] < b.low) r[key] = b.low;
          else if (r[key] > b.high) r[key] = b.high;
        }
      }
    }
    return out;
  }

  function trimStrings(rows, columns, keys) {
    const out = DU.clone(rows);
    const targets = scopeCols(columns, keys);
    for (const r of out) {
      for (const c of targets) {
        if (typeof r[c.key] === 'string') {
          r[c.key] = r[c.key].replace(/\s+/g, ' ').trim();
          if (r[c.key] === '') r[c.key] = null;
        }
      }
    }
    return out;
  }

  function normalizeCategory(rows, columns, keys) {
    const out = DU.clone(rows);
    const targets = scopeCols(columns, keys).filter((c) => c.type === 'category' || c.type === 'text');
    for (const c of targets) {
      for (const r of out) {
        if (typeof r[c.key] === 'string') r[c.key] = r[c.key].trim().toLowerCase();
      }
    }
    return out;
  }

  // ===================== 数据增强 =====================
  function duplicateSample(rows, times) {
    const out = [];
    for (const r of rows) {
      out.push({ ...r });
      for (let i = 1; i < times; i++) out.push({ ...r });
    }
    return out;
  }

  function bootstrap(rows, targetCount) {
    if (!rows.length) return [];
    const out = DU.clone(rows);
    const rng = DataGen.prng(Date.now());
    while (out.length < targetCount) {
      out.push({ ...rows[Math.floor(rng() * rows.length)] });
    }
    return out;
  }

  function gaussianNoise(rows, columns, sigma, multiplier, keys) {
    sigma = sigma || 0.05;
    multiplier = multiplier || 1;
    const numKeys = scopeCols(columns, keys).filter((c) => c.type === 'number').map((c) => c.key).filter((k) => !isIdLike(k));
    const rng = DataGen.prng(Date.now());
    const out = [];
    for (const r of rows) {
      for (let t = 0; t < multiplier; t++) {
        const syn = { ...r };
        for (const key of numKeys) {
          if (!S.isNumeric(r[key])) continue;
          syn[key] = r[key] * (1 + sigma * DataGen.randn(rng));
        }
        out.push(syn);
      }
    }
    return out;
  }

  function _euclid(a, b) {
    let sum = 0, count = 0;
    for (let i = 0; i < a.length; i++) {
      if (S.isNumeric(a[i]) && S.isNumeric(b[i])) {
        sum += (a[i] - b[i]) * (a[i] - b[i]);
        count++;
      }
    }
    return count ? Math.sqrt(sum / count) : Infinity;
  }

  // SMOTE：对少数类样本做 k 近邻插值，合成新样本（处理类别不平衡）
  function smote(rows, columns, targetKey, minorityValue, k, multiplier, featureKeys) {
    k = k || 5;
    multiplier = multiplier || 1;
    const keys = scopeCols(columns, featureKeys)
      .filter((c) => c.type === 'number' && c.key !== targetKey && !isIdLike(c.key))
      .map((c) => c.key);
    const minority = rows.filter((r) => String(r[targetKey]) === String(minorityValue));
    if (minority.length < 2 || !keys.length) return [];
    const rng = DataGen.prng(Date.now());
    const syn = [];
    for (const s of minority) {
      const sVec = keys.map((key) => s[key]);
      const nn = minority
        .filter((x) => x !== s)
        .map((x) => ({ x, d: _euclid(sVec, keys.map((key) => x[key])) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k);
      if (!nn.length) continue;
      for (let t = 0; t < multiplier; t++) {
        const nbr = nn[Math.floor(rng() * nn.length)].x;
        const g = rng();
        const newRow = { ...s };
        for (const key of keys) {
          if (S.isNumeric(s[key]) && S.isNumeric(nbr[key])) {
            newRow[key] = s[key] + g * (nbr[key] - s[key]);
          }
        }
        syn.push(newRow);
      }
    }
    return syn;
  }

  return {
    profile, correlationMatrix,
    imputeMissing, standardize, labelEncode, oneHotEncode, dropColumns, dropMissingRows,
    dedup, removeOutlierRows, clipOutliers, trimStrings, normalizeCategory,
    duplicateSample, bootstrap, gaussianNoise, smote,
    numericKeys, catKeys
  };
})();