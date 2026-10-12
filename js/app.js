// app.js — 应用主逻辑（状态 / 导航 / 渲染 / 管线执行 / 回滚）
(function () {
  'use strict';
  const S = Stats, DU = DataUtil, A = Algo, C = Charts;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // 当前数据集自动识别出的地理位置列（供「地图」标记类型使用）
  let geoColumn = null;

  const STAGE_META = {
    overview: { title: '数据总览', desc: '整体数据状态可视化' },
    assess: { title: '数据评估', desc: '自动画像、分布与相关性分析' },
    viz: { title: '数据可视化', desc: 'Tableau 风格拖拽式图表' },
    preprocess: { title: '数据预处理', desc: '标准化、编码、填充等准备性变换' },
    clean: { title: '数据清洗', desc: '去重、异常值处理与纠错' },
    augment: { title: '数据增强', desc: '合成样本、处理类别不平衡' },
    query: { title: '数据查询', desc: '筛选、排序、分组聚合与导出' },
    learn: { title: '学习', desc: '按数据处理方式分类的知识介绍' }
  };

  const state = {
    rows: [],
    columns: [],
    origin: { rows: [], columns: [] },
    history: [],
    activeStage: 'overview',
    queryFilters: [],
    heatmapSel: null,
    queryColSel: null,
    viz: { mark: 'bar', cols: null, rows: [], color: null, agg: 'sum' }
  };

  // ===================== 数据操作 =====================
  function setData(rows, columns, opts) {
    opts = opts || {};
    state.rows = DU.clone(rows);
    state.columns = (columns && columns.length)
      ? columns.map((c) => ({ ...c, type: inferColType(rows, c) }))
      : buildColumns(rows);
    if (!opts.keepOrigin) {
      state.origin = { rows: DU.clone(rows), columns: state.columns.map((c) => ({ ...c })) };
    }
    state.queryFilters = [];
    state.heatmapSel = null;
    state.queryColSel = null;
    renderAll();
  }

  function buildColumns(rows) {
    if (!rows.length) return [];
    const keys = Object.keys(rows[0]);
    return DU.detectTypes(rows, keys.map((k) => ({ key: k, label: k })));
  }

  function inferColType(rows, c) {
    const vals = rows.map((r) => r[c.key]);
    return DU.inferType(vals);
  }

  function updateData(rows, columns) {
    state.rows = DU.clone(rows);
    state.columns = (columns || state.columns).map((c) => ({ ...c }));
    state.heatmapSel = null;
    state.queryColSel = null;
    renderAll();
  }

  function snapshotShape() {
    return DU.shape(state.rows, state.columns);
  }

  function snapState() {
    return { rows: DU.clone(state.rows), columns: state.columns.map((c) => ({ ...c })) };
  }

  // ===================== 历史 / 回滚 =====================
  function addHistory(tag, text, snap) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    state.history.unshift({ tag, text, time, snap: snap || null });
    if (state.history.length > 100) state.history.pop();
    renderHistory();
  }

  function renderHistory() {
    const el = $('#history-list');
    if (!state.history.length) {
      el.innerHTML = '<div class="empty-hint">暂无操作记录</div>';
      return;
    }
    el.innerHTML = state.history.map((h, i) =>
      '<div class="history-item" title="' + h.time + '">' +
        '<span class="history-tag tag-' + h.tag + '">' + tagLabel(h.tag) + '</span>' +
        '<span class="history-detail">' + escapeHtml(h.text) + '</span>' +
        (h.snap ? '<button class="history-rollback" data-idx="' + i + '" title="回滚到该操作之前">↩</button>' : '') +
      '</div>'
    ).join('');
  }

  function rollback(index) {
    const h = state.history[index];
    if (!h || !h.snap) return;
    const ok = window.confirm('确定回滚到「' + h.text + '」执行之前的状态吗？\n该操作之后的变更将被撤销。');
    if (!ok) return;
    const before = snapState();
    state.history.splice(0, index + 1); // 移除该操作及其后更新的记录
    updateData(h.snap.rows, h.snap.columns);
    addHistory('load', '回滚到「' + h.text + '」之前', before);
    toast('已回滚', 'ok');
  }

  function tagLabel(tag) {
    return { assess: '评估', preprocess: '预处理', clean: '清洗', augment: '增强', query: '查询', load: '数据' }[tag] || tag;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  // ===================== Toast =====================
  let toastTimer;
  function toast(msg, type) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  // ===================== 渲染 =====================
  function renderAll() {
    renderSidebar();
    renderOverview();
    renderPreview();
    renderStage(state.activeStage);
  }

  function renderSidebar() {
    const sh = snapshotShape();
    const missingRate = sh.cells ? (sh.missing / sh.cells * 100) : 0;
    document.title = 'DataForge · ' + sh.rows + ' 行 × ' + sh.cols + ' 列 · 缺失 ' + missingRate.toFixed(1) + '%';
  }

  // ---------- 总览 ----------
  function renderOverview() {
    const sh = snapshotShape();
    if (!state.rows.length) {
      $('#overview-cards').innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-state-icon">📊</div>' +
          '<div class="empty-state-title">暂无数据</div>' +
          '<div class="empty-state-desc">点击右上角「加载示例数据」快速体验，或「上传 CSV」导入你自己的数据</div>' +
        '</div>';
      return;
    }
    const dup = DU.duplicateCount(state.rows);
    const numCols = A.numericKeys(state.columns).length;
    const catCols = A.catKeys(state.columns).length;
    const missingRate = sh.cells ? sh.missing / sh.cells * 100 : 0;
    const cards = [
      { label: '总行数', value: sh.rows, sub: '当前工作数据', accent: 'var(--accent)' },
      { label: '总列数', value: sh.cols, sub: numCols + ' 数值 · ' + catCols + ' 类别', accent: 'var(--accent-2)' },
      { label: '缺失率', value: missingRate.toFixed(1) + '%', sub: sh.missing + ' 个缺失单元格', accent: 'var(--amber)' },
      { label: '重复行', value: dup, sub: '完全重复的样本', accent: 'var(--red)' }
    ];
    $('#overview-cards').innerHTML = cards.map((c) =>
      '<div class="stat-card" style="--card-accent:' + c.accent + '">' +
        '<div class="stat-card-label">' + c.label + '</div>' +
        '<div class="stat-card-value">' + c.value + '</div>' +
        '<div class="stat-card-sub">' + c.sub + '</div>' +
      '</div>'
    ).join('');
  }

  // ---------- 通用表格 ----------
  function renderTable(el, rows, columns, opts) {
    opts = opts || {};
    const maxRows = opts.maxRows || 100;
    const useNumAlign = opts.numAlign !== false;
    const head = '<thead><tr>' + columns.map((c) =>
      '<th class="' + (useNumAlign && c.type === 'number' ? 'num' : '') + '">' + escapeHtml(c.label) + '</th>'
    ).join('') + '</tr></thead>';
    const body = rows.slice(0, maxRows).map((r) =>
      '<tr>' + columns.map((c) => {
        const v = r[c.key];
        if (S.isMissing(v)) return '<td class="missing-cell">NULL</td>';
        const isNum = c.type === 'number';
        const fmt = isNum ? (Number.isInteger(v) ? v : Number(v).toFixed(2)) : escapeHtml(String(v));
        return '<td class="' + (isNum ? 'num' : '') + '">' + fmt + '</td>';
      }).join('') + '</tr>'
    ).join('');
    el.innerHTML = head + '<tbody>' + body + '</tbody>';
    if (opts.after) opts.after(rows.length, columns.length);
  }

  // ---------- 数据预览 ----------
  function renderPreview() {
    renderTable($('#data-preview-table'), state.rows, state.columns, {
      after: (shown, cols) => {
        $('#preview-meta').textContent = '显示前 ' + Math.min(shown, 100) + ' / ' + state.rows.length + ' 行';
      }
    });
  }

  // ---------- 数据评估 ----------
  function renderAssess() {
    if (!state.rows.length) return;
    const prof = A.profile(state.rows, state.columns);
    buildSelect('#hist-col', state.columns.filter((c) => c.type === 'number'));
    buildSelect('#box-col', state.columns.filter((c) => c.type === 'number'));

    const head = '<tr><th>列名</th><th>类型</th><th>非空</th><th>缺失</th><th>缺失率</th><th>唯一值</th><th>均值/中位数</th><th>标准差</th><th>异常值</th><th>质量</th></tr>';
    const body = prof.map((p) => {
      const typeBadge = { number: '<span class="badge b-num">数值</span>', category: '<span class="badge b-cat">类别</span>', text: '<span class="badge b-txt">文本</span>' }[p.type];
      const meanMed = p.stats ? fmtNum(p.stats.mean) + ' / ' + fmtNum(p.stats.median) : '—';
      const stdTxt = p.stats ? fmtNum(p.stats.std) : '—';
      const outTxt = p.outliers ? p.outliers.count : '—';
      const qc = { good: '<span class="quality-good">良好</span>', mid: '<span class="quality-mid">偏差</span>', bad: '<span class="quality-bad">关注</span>' }[p.quality];
      const missColor = p.missingRate > 0.1 ? (p.missingRate > 0.3 ? 'quality-bad' : 'quality-mid') : 'quality-good';
      return '<tr><td>' + escapeHtml(p.label) + '</td><td>' + typeBadge + '</td>' +
        '<td class="num">' + (p.count - p.missing) + '</td>' +
        '<td class="num">' + p.missing + '</td>' +
        '<td class="num ' + missColor + '">' + (p.missingRate * 100).toFixed(1) + '%</td>' +
        '<td class="num">' + p.uniq + '</td>' +
        '<td class="num">' + meanMed + '</td>' +
        '<td class="num">' + stdTxt + '</td>' +
        '<td class="num">' + outTxt + '</td>' +
        '<td>' + qc + '</td></tr>';
    }).join('');
    $('#assess-table').innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody>';

    renderHeatmapCols();
    drawHist();
    drawBox();
    drawHeatmap();
  }

  function fmtNum(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (Math.abs(v) >= 1000) return v.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  function drawHist() {
    const key = $('#hist-col').value;
    if (!key) return;
    const vals = state.rows.map((r) => r[key]);
    C.histogram($('#hist-canvas'), S.histogram(vals, 12));
  }

  function drawBox() {
    const key = $('#box-col').value;
    if (!key) return;
    C.boxplot($('#box-canvas'), state.rows.map((r) => r[key]));
  }

  // 多选下拉：替代列 piles，特征再多也不会撑高页面
  // selected: null 表示全选；数组表示指定子集；空数组表示未选
  function multiSelect(columns, opts) {
    opts = opts || {};
    const root = document.createElement('div');
    root.className = 'ms';
    root.innerHTML =
      '<button type="button" class="ms-trigger">' +
        '<span class="ms-label"></span><span class="ms-caret">▼</span>' +
      '</button>' +
      '<div class="ms-panel">' +
        '<div class="ms-actions">' +
          '<span class="ms-action" data-act="all">全选</span>' +
          '<span class="ms-action" data-act="none">清空</span>' +
        '</div>' +
        '<div class="ms-list"></div>' +
      '</div>';
    const trigger = root.querySelector('.ms-trigger');
    const label = root.querySelector('.ms-label');
    const list = root.querySelector('.ms-list');
    list.innerHTML = columns.map((c) =>
      '<label class="ms-item">' +
        '<input type="checkbox" value="' + escapeHtml(c.key) + '"><span>' + escapeHtml(c.label) + '</span>' +
      '</label>'
    ).join('');

    let sel = (opts.selected == null) ? null : new Set(opts.selected);

    function checkedArray() {
      return Array.from(list.querySelectorAll('input')).filter((b) => b.checked).map((b) => b.value);
    }

    function render() {
      const boxes = Array.from(list.querySelectorAll('input'));
      boxes.forEach((b) => { b.checked = (sel === null || sel.has(b.value)); });
      const n = sel === null ? columns.length : sel.size;
      label.textContent = (sel === null && columns.length > 0)
        ? '全部列（' + columns.length + '）'
        : (n > 0 ? '已选 ' + n + ' 列' : '未选择列');
      if (opts.onChange) opts.onChange(sel === null ? null : Array.from(sel));
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.ms.open').forEach((o) => {
        if (o !== root) o.classList.remove('open');
      });
      root.classList.toggle('open');
    });
    root.querySelector('[data-act="all"]').addEventListener('click', () => { sel = null; render(); });
    root.querySelector('[data-act="none"]').addEventListener('click', () => { sel = new Set(); render(); });
    list.addEventListener('change', (e) => {
      if (!e.target.matches('input[type="checkbox"]')) return;
      const checked = checkedArray();
      sel = (columns.length > 0 && checked.length === columns.length) ? null : new Set(checked);
      render();
    });
    render();
    return root;
  }

  function renderHeatmapCols() {
    const numeric = state.columns.filter((c) => c.type === 'number');
    const el = $('#heatmap-cols');
    el.innerHTML = '';
    if (!numeric.length) return;
    const ms = multiSelect(numeric, {
      selected: state.heatmapSel,
      onChange: (selNew) => {
        // selNew: null = 全选；数组 = 指定子集
        state.heatmapSel = selNew;
        drawHeatmap();
      }
    });
    el.appendChild(ms);
  }

  function drawHeatmap() {
    const numeric = state.columns.filter((c) => c.type === 'number');
    let keys;
    if (state.heatmapSel === null) keys = numeric.map((c) => c.key);
    else keys = state.heatmapSel.filter((k) => numeric.some((c) => c.key === k));
    if (!keys.length) {
      C.heatmap($('#heatmap-canvas'), [[0]], ['—']);
      return;
    }
    const selCols = numeric.filter((c) => keys.includes(c.key));
    const corr = A.correlationMatrix(state.rows, selCols);
    if (!corr.keys.length) {
      C.heatmap($('#heatmap-canvas'), [[0]], ['—']);
      return;
    }
    C.heatmap($('#heatmap-canvas'), corr.matrix, corr.labels);
  }

  function buildSelect(sel, columns, placeholder) {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = (placeholder ? '<option value="">' + placeholder + '</option>' : '') +
      columns.map((c) => '<option value="' + escapeHtml(c.key) + '">' + escapeHtml(c.label) + '</option>').join('');
  }

  // 解析"应用范围"：null = 全部列；数组 = 指定列（空数组 = 不作用于任何列）
  function scopeKeys(scope) {
    return (scope == null) ? null : scope;
  }

  // ===================== 数据可视化（Tableau 风格） =====================
  function vizDims() { return state.columns.filter((c) => c.type !== 'number'); }
  function vizMeasures() { return state.columns.filter((c) => c.type === 'number'); }

  // 自动识别地理列：优先经纬度坐标列对，其次地理名称列（命中坐标库）
  function detectGeoColumn() {
    const colMatch = (re) => state.columns.filter((c) => re.test(c.label) || re.test(c.key));
    const lngC = colMatch(/经度|lng|lon|longitude|东经/i)[0];
    const latC = colMatch(/纬度|lat|latitude|北纬/i)[0];
    if (lngC && latC) return { kind: 'coord', lngKey: lngC.key, latKey: latC.key, key: lngC.key, matched: Infinity, total: state.rows.length };

    const nameRe = /城市|地区|区域|省份|省|市|州|国家|地点|地址|位置|city|province|region|country|location|state/i;
    for (const c of state.columns) {
      if (c.type === 'number') continue;
      if (!nameRe.test(c.label) && !nameRe.test(c.key)) continue;
      const vals = S.uniqueArr(state.rows.map((r) => r[c.key])).filter((v) => v != null);
      let matched = 0;
      for (const v of vals) if (GeoData.lookup(String(v))) matched++;
      if (matched >= 2) return { kind: 'name', key: c.key, matched, total: vals.length };
    }
    return null;
  }

  // 可用的标记类型：基础类型 + 按数据集动态追加
  function vizAvailableMarks() {
    const base = [
      { id: 'bar', label: '柱状' },
      { id: 'line', label: '折线' },
      { id: 'area', label: '面积' },
      { id: 'pie', label: '饼图' },
      { id: 'scatter', label: '散点' },
      { id: 'histogram', label: '直方图' },
      { id: 'boxplot', label: '箱线图' }
    ];
    if (geoColumn) base.push({ id: 'map', label: '地图' });
    return base;
  }

  function vizAggLabel(a) {
    return { sum: '求和', avg: '平均', count: '计数', min: '最小', max: '最大', countd: '去重计数' }[a] || a;
  }

  // 行货架的度量（可多个）：数值列 + 聚合；过滤掉非数值或失效字段
  function shelfMeasures() {
    const keys = Array.isArray(state.viz.rows) ? state.viz.rows : (state.viz.rows ? [state.viz.rows] : []);
    return keys.map((k) => {
      const c = state.columns.find((x) => x.key === k);
      return (c && c.type === 'number') ? { key: c.key, agg: state.viz.agg, label: c.label } : null;
    }).filter(Boolean);
  }

  // 单度量兜底：取第一个度量，否则落到"计数"
  function vizMeasure() {
    const m = shelfMeasures()[0];
    return m || { key: null, agg: 'count', label: '记录数' };
  }

  function vizAggregate(rows, key, agg) {
    if (!key || agg === 'count') return rows.length;
    const vals = rows.map((r) => r[key]).filter((v) => S.isNumeric(v));
    if (!vals.length) return null;
    switch (agg) {
      case 'sum': return vals.reduce((s, x) => s + x, 0);
      case 'avg': return vals.reduce((s, x) => s + x, 0) / vals.length;
      case 'min': return Math.min(...vals);
      case 'max': return Math.max(...vals);
      case 'countd': return new Set(vals.map((v) => String(v))).size;
    }
    return vals.reduce((s, x) => s + x, 0);
  }

  function cmpCat(a, b) {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), 'zh-CN');
  }

  function sampleArray(arr, n) {
    if (arr.length <= n) return arr;
    const step = arr.length / n, out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

  // 按维度分组聚合，返回 { xLabels, series:[{name, values}] }
  // measures：度量数组（支持多度量横向比较，每个度量一条序列）；colorKey：颜色拆分（仅单度量时生效）
  function buildGrouped(dimKey, measures, agg, colorKey) {
    const groups = new Map(); // dim -> rows
    for (const r of state.rows) {
      const dv = S.isMissing(r[dimKey]) ? '(空)' : String(r[dimKey]);
      if (!groups.has(dv)) groups.set(dv, []);
      groups.get(dv).push(r);
    }
    const first = measures[0] || { key: null, agg: 'count' };
    // 按聚合值降序排名，读取的维度取 top-N + "其他"
    let ranked = [...groups.entries()].map(([dv, rows]) => ({ label: dv, rows, total: vizAggregate(rows, first.key, first.agg) || 0 }))
      .sort((a, b) => b.total - a.total);
    const maxCats = 14;
    if (ranked.length > maxCats) {
      const top = ranked.slice(0, maxCats);
      const otherRows = ranked.slice(maxCats).flatMap((d) => d.rows);
      top.push({ label: '其他（' + (ranked.length - maxCats) + ' 类）', rows: otherRows, total: vizAggregate(otherRows, first.key, first.agg) || 0 });
      ranked = top;
    }
    const xLabels = ranked.map((d) => d.label);

    // 多度量：每个度量一条序列（横向比较），此时忽略颜色拆分
    if (measures.length > 1) {
      const series = measures.map((m) => ({
        name: vizAggLabel(m.agg) + (m.key ? ' ' + m.label : ''),
        values: ranked.map((d) => vizAggregate(d.rows, m.key, m.agg))
      }));
      return { xLabels, series };
    }

    const measure = measures[0] || { key: null, agg: 'count' };
    if (!colorKey) {
      return { xLabels, series: [{ name: vizAggLabel(measure.agg) + (measure.key ? ' ' + measure.label : ''), values: ranked.map((d) => vizAggregate(d.rows, measure.key, measure.agg)) }] };
    }
    const colorSet = new Set();
    for (const r of state.rows) colorSet.add(S.isMissing(r[colorKey]) ? '(空)' : String(r[colorKey]));
    const colors = [...colorSet].sort(cmpCat).slice(0, 10);
    const series = colors.map((cv) => ({
      name: cv,
      values: ranked.map((d) => vizAggregate(d.rows.filter((r) => (S.isMissing(r[colorKey]) ? '(空)' : String(r[colorKey])) === cv), measure.key, measure.agg))
    }));
    return { xLabels, series };
  }

  function buildScatterSeries(xKey, yKey, colorKey) {
    const pairs = [];
    for (const r of state.rows) {
      const x = r[xKey], y = r[yKey];
      if (S.isNumeric(x) && S.isNumeric(y)) {
        pairs.push({ x, y, c: colorKey ? (S.isMissing(r[colorKey]) ? '(空)' : String(r[colorKey])) : null });
      }
    }
    const sample = sampleArray(pairs, 1500);
    if (!colorKey) return [{ name: '(全部)', points: sample.map((p) => [p.x, p.y]) }];
    const groups = new Map();
    for (const p of sample) {
      if (!groups.has(p.c)) groups.set(p.c, []);
      groups.get(p.c).push([p.x, p.y]);
    }
    return [...groups.keys()].sort(cmpCat).slice(0, 10).map((cv) => ({ name: cv, points: groups.get(cv) }));
  }

  // 地图标记数据：将地理位置列落到坐标，按度量聚合出气泡
  // geoKeyOverride：用户拖入货架的地区字段；name 类型时覆盖自动识别列，coord 经纬度对仍自动识别
  function buildMapSeries(geoKeyOverride) {
    const g = geoColumn;
    if (!g) return { series: [], placeLabel: '', measureLabel: '' };
    const measure = vizMeasure();
    const measureLabel = measure.key ? vizAggLabel(measure.agg) + '(' + measure.label + ')' : '记录数';
    let placeLabel = '';

    if (g.kind === 'coord') {
      const pts = [];
      for (const r of state.rows) {
        const lng = Number(r[g.lngKey]), lat = Number(r[g.latKey]);
        if (!S.isNumeric(lng) || !S.isNumeric(lat)) continue;
        pts.push({ x: lng, y: lat, v: (measure.key ? vizAggregate([r], measure.key, measure.agg) : 1) || 0, lab: '' });
        if (pts.length >= 1500) break;
      }
      placeLabel = '经纬度';
      return { series: [{ name: measureLabel, points: pts }], placeLabel, measureLabel };
    }

    const geoKey = geoKeyOverride || g.key;
    const groups = new Map();
    for (const r of state.rows) {
      const raw = r[geoKey];
      if (S.isMissing(raw)) continue;
      const coord = GeoData.lookup(String(raw));
      if (!coord) continue;
      if (!groups.has(raw)) groups.set(raw, []);
      groups.get(raw).push(r);
    }
    const pts = [...groups.entries()].map(([name, rows]) => {
      const c = GeoData.lookup(String(name));
      return { x: c[0], y: c[1], v: vizAggregate(rows, measure.key, measure.agg) || 0, lab: name };
    });
    const col = state.columns.find((c) => c.key === geoKey);
    placeLabel = col ? col.label : geoKey;
    return { series: [{ name: measureLabel, points: pts }], placeLabel, measureLabel };
  }

  function renderViz() {
    // 清理失效字段引用
    ['cols', 'color'].forEach((role) => {
      const k = state.viz[role];
      if (k && !state.columns.some((c) => c.key === k)) state.viz[role] = null;
    });
    // 行货架支持多度量：数组过滤失效字段
    if (Array.isArray(state.viz.rows)) {
      state.viz.rows = state.viz.rows.filter((k) => state.columns.some((c) => c.key === k));
    } else if (state.viz.rows) {
      state.viz.rows = state.columns.some((c) => c.key === state.viz.rows) ? [state.viz.rows] : [];
    } else {
      state.viz.rows = [];
    }
    // 重新识别地理列；若当前标记类型已失效则回退到柱状
    geoColumn = detectGeoColumn();
    if (!vizAvailableMarks().some((m) => m.id === state.viz.mark)) state.viz.mark = 'bar';
    renderVizFields();
    renderVizShelves();
    renderVizMarks();
    $('#viz-agg').value = state.viz.agg;
    drawVizChart();
  }

  function renderVizFields() {
    const dimsEl = $('#viz-dims'), measEl = $('#viz-measures');
    dimsEl.innerHTML = '';
    measEl.innerHTML = '';
    if (!state.columns.length) {
      dimsEl.innerHTML = '<div class="empty-hint">暂无字段</div>';
      measEl.innerHTML = '<div class="empty-hint">暂无字段</div>';
      return;
    }
    vizDims().forEach((c) => dimsEl.appendChild(vizFieldChip(c)));
    vizMeasures().forEach((c) => measEl.appendChild(vizFieldChip(c)));
  }

  function vizFieldChip(col) {
    const chip = document.createElement('div');
    chip.className = 'viz-chip' + (col.type === 'number' ? ' num' : '');
    chip.draggable = true;
    chip.title = '拖到货架 或 双击自动放置';
    chip.innerHTML = '<span class="ic">' + (col.type === 'number' ? '#' : '▦') + '</span>' + escapeHtml(col.label);
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', col.key);
      e.dataTransfer.effectAllowed = 'copy';
    });
    chip.addEventListener('dblclick', () => vizAutoAssign(col));
    return chip;
  }

  function vizAutoAssign(col) {
    if (col.type === 'number') {
      const arr = Array.isArray(state.viz.rows) ? state.viz.rows : (state.viz.rows ? [state.viz.rows] : []);
      if (arr.includes(col.key)) state.viz.rows = arr.filter((k) => k !== col.key);
      else state.viz.rows = arr.concat(col.key);
    } else {
      if (state.viz.cols === col.key) state.viz.cols = null;
      else if (!state.viz.cols) state.viz.cols = col.key;
      else if (state.viz.color === col.key) state.viz.color = null;
      else if (!state.viz.color) state.viz.color = col.key;
    }
    renderVizShelves();
    drawVizChart();
  }

  function vizAssignShelf(role, key) {
    const col = state.columns.find((c) => c.key === key);
    if (!col) return;
    if (role === 'rows') {
      const arr = Array.isArray(state.viz.rows) ? state.viz.rows : (state.viz.rows ? [state.viz.rows] : []);
      if (!arr.includes(key)) state.viz.rows = arr.concat(key);
    } else {
      state.viz[role] = key;
    }
    renderVizShelves();
    drawVizChart();
  }

  function renderShelfPill(drop, role, key) {
    const col = state.columns.find((c) => c.key === key);
    if (!col) return;
    const pill = document.createElement('span');
    pill.className = 'shelf-pill ' + (col.type === 'number' ? 'pill-measure' : 'pill-dim');
    pill.innerHTML = (col.type === 'number' ? 'Σ ' : '▦ ') + escapeHtml(col.label) + '<span class="remove" title="移除">✕</span>';
    pill.querySelector('.remove').addEventListener('click', (e) => {
      e.stopPropagation();
      if (role === 'rows') {
        state.viz.rows = (Array.isArray(state.viz.rows) ? state.viz.rows : []).filter((k) => k !== key);
      } else {
        state.viz[role] = null;
      }
      renderVizShelves();
      drawVizChart();
    });
    drop.appendChild(pill);
  }

  function renderVizShelves() {
    // 单值货架：列（维度）、颜色/分组
    ['cols', 'color'].forEach((role) => {
      const drop = $('#shelf-' + role);
      if (!drop) return;
      const key = state.viz[role];
      drop.innerHTML = '';
      const col = key ? state.columns.find((c) => c.key === key) : null;
      drop.classList.toggle('empty', !col);
      if (col) renderShelfPill(drop, role, key);
    });
    // 多值货架：行（多度量，支持横向比较）
    const rowsDrop = $('#shelf-rows');
    if (rowsDrop) {
      rowsDrop.innerHTML = '';
      const keys = Array.isArray(state.viz.rows) ? state.viz.rows : (state.viz.rows ? [state.viz.rows] : []);
      rowsDrop.classList.toggle('empty', keys.length === 0);
      keys.forEach((k) => renderShelfPill(rowsDrop, 'rows', k));
    }
  }

  function renderVizMarks() {
    const el = $('#viz-marks');
    if (!el) return;
    const marks = vizAvailableMarks();
    el.innerHTML = marks.map((m) =>
      '<button type="button" data-mark="' + m.id + '" class="mark' + (m.id === state.viz.mark ? ' active' : '') + '">' + m.label + '</button>'
    ).join('');
  }

  function drawVizChart() {
    const cv = $('#viz-canvas');
    const hint = $('#viz-hint');
    if (!state.rows.length) {
      hint.textContent = '当前没有数据，请先加载示例或上传 CSV';
      C.bar(cv, [], [], {});
      return;
    }
    const v = state.viz;
    const colX = state.columns.find((c) => c.key === v.cols);
    const colC = state.columns.find((c) => c.key === v.color);
    const measure = vizMeasure();

    if (v.mark === 'histogram') {
      const firstMeasure = shelfMeasures()[0];
      const col = (firstMeasure && state.columns.find((c) => c.key === firstMeasure.key && c.type === 'number'))
        || (v.cols && state.columns.find((c) => c.key === v.cols && c.type === 'number'))
        || state.columns.find((c) => c.type === 'number');
      if (!col) {
        hint.textContent = '直方图需要一个数值列：拖度量到「行」货架';
        C.histogram(cv, { labels: [], values: [] }, {});
        return;
      }
      const vals = state.rows.map((r) => r[col.key]);
      C.histogram(cv, S.histogram(vals, 12), {});
      hint.textContent = '直方图 · ' + col.label + ' · ' + vals.length + ' 个数值 · 12 个分箱';
      return;
    }

    if (v.mark === 'boxplot') {
      const colY = shelfMeasures()[0] ? state.columns.find((c) => c.key === shelfMeasures()[0].key) : null;
      const measureCol = (colY && colY.type === 'number') ? colY : null;
      const groupKey = v.cols || v.color;
      const groupCol = (groupKey && (!measureCol || groupKey !== measureCol.key)) ? state.columns.find((c) => c.key === groupKey) : null;
      if (!measureCol) {
        hint.textContent = '箱线图需要一个度量：拖数值列到「行」货架';
        C.boxGroups(cv, [], [], {});
        return;
      }
      if (groupCol) {
        const groups = new Map();
        for (const r of state.rows) {
          const dv = S.isMissing(r[groupCol.key]) ? '(空)' : String(r[groupCol.key]);
          if (!groups.has(dv)) groups.set(dv, []);
          const val = r[measureCol.key];
          if (S.isNumeric(val)) groups.get(dv).push(val);
        }
        const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 14);
        C.boxGroups(cv, ranked.map((d) => d[0]), ranked.map((d) => d[1]), {});
        hint.textContent = '箱线图 · ' + measureCol.label + ' · 按 ' + groupCol.label + ' · ' + ranked.length + ' 组';
      } else {
        const vals = state.rows.map((r) => r[measureCol.key]).filter(S.isNumeric);
        C.boxGroups(cv, [measureCol.label], [vals], {});
        hint.textContent = '箱线图 · ' + measureCol.label + ' · ' + vals.length + ' 个数值';
      }
      return;
    }

    if (v.mark === 'map') {
      const g = geoColumn;
      if (!g) {
        hint.textContent = '当前数据集未检测到地理位置信息';
        C.geoBubble(cv, [], {});
        return;
      }
      // 名称类地理字段需用户显式拖到货架后才渲染；经纬度坐标对保持自动识别
      let geoKeyOverride = null;
      if (g.kind === 'name') {
        const geoKey = v.cols || v.color;
        const geoCol = geoKey ? state.columns.find((c) => c.key === geoKey) : null;
        const geoHit = geoCol && state.rows.some((r) => !S.isMissing(r[geoCol.key]) && GeoData.lookup(String(r[geoCol.key])));
        if (!geoHit) {
          const gl = state.columns.find((c) => c.key === g.key);
          hint.textContent = '请把地区字段「' + (gl ? gl.label : '地区') + '」拖到「列」货架后显示地图';
          C.geoBubble(cv, [], {});
          return;
        }
        geoKeyOverride = geoKey;
      }
      const m = buildMapSeries(geoKeyOverride);
      const mPts = m.series[0] ? m.series[0].points : [];
      // 仅当数据点落在中国范围内时叠加中国省份底图（国界外坐标不画底图）
      const inChina = mPts.length > 0 && mPts.every((p) => p.x >= 70 && p.x <= 140 && p.y >= 15 && p.y <= 55);
      C.geoBubble(cv, m.series, { baseMap: inChina });
      hint.textContent = '地图 · 按 ' + m.placeLabel + ' · ' + m.measureLabel + ' · ' + mPts.length + ' 个位置';
      return;
    }

    if (v.mark === 'scatter') {
      const colY = shelfMeasures()[0] ? state.columns.find((c) => c.key === shelfMeasures()[0].key) : null;
      if (!colX || !colY || colY.type !== 'number') {
        hint.textContent = '散点图需要两个度量：拖度量到「列」和「行」';
        C.scatter(cv, [], 'X', 'Y');
        return;
      }
      const series = buildScatterSeries(colX.key, colY.key, colC ? colC.key : null);
      const n = series.reduce((s, x) => s + x.points.length, 0);
      C.scatter(cv, series, colX.label, colY.label);
      hint.textContent = '散点图 · ' + colX.label + ' × ' + colY.label + (colC ? ' · 按 ' + colC.label + ' 着色' : '') + ' · 已绘制 ' + n + ' 点';
      return;
    }

    if (v.mark === 'pie') {
      const dimKey = v.color || v.cols;
      if (!dimKey) {
        hint.textContent = '饼图需要至少一个维度（拖到「列」或「颜色」）';
        C.pie(cv, [], [], {});
        return;
      }
      const dimCol = state.columns.find((c) => c.key === dimKey);
      const g = buildGrouped(dimKey, [measure], measure.agg, null);
      C.pie(cv, g.xLabels, g.series[0].values, {});
      hint.textContent = '饼图 · 按 ' + dimCol.label + ' · ' + vizAggLabel(measure.agg) + (measure.key ? '(' + measure.label + ')' : '') + ' · ' + g.xLabels.length + ' 类';
      return;
    }

    if (!colX) {
      hint.textContent = '请把维度拖到「列」货架（或双击左侧字段）';
      C.bar(cv, [], [], {});
      return;
    }
    const measuresAll = shelfMeasures();
    const measureList = measuresAll.length ? measuresAll : [{ key: null, agg: 'count', label: '记录数' }];
    // 多度量时忽略颜色拆分（每个度量一条序列做横向比较）
    const g = buildGrouped(colX.key, measureList, state.viz.agg, (measureList.length > 1 ? null : (colC ? colC.key : null)));
    if (v.mark === 'bar') {
      if (g.series.length > 1) C.barGrouped(cv, g.xLabels, g.series, {});
      else C.bar(cv, g.xLabels, g.series[0] ? g.series[0].values : [], {});
    } else if (v.mark === 'line') {
      C.line(cv, g.xLabels, g.series, {});
    } else {
      C.area(cv, g.xLabels, g.series, {});
    }
    const markName = { bar: '柱状图', line: '折线图', area: '面积图' }[v.mark];
    const measTxt = measureList.map((mm) => (mm.key ? vizAggLabel(mm.agg) + '(' + mm.label + ')' : '计数')).join(' / ');
    hint.textContent = markName + ' · ' + colX.label + ' × ' + measTxt + (colC && measureList.length <= 1 ? ' · 按 ' + colC.label + ' 分组' : '') + ' · ' + g.xLabels.length + ' 类';
  }

  // ---------- 操作定义 ----------
  const PREPROCESS_OPS = [
    { id: 'impute', title: '缺失值填充', desc: '用统计量填补缺失', params: [
      { key: 'strategy', type: 'select', label: '策略', options: [['mean', '均值（数值）'], ['median', '中位数（数值）'], ['mode', '众数'], ['zero', '填 0（数值）'], ['null', '填 NULL（类别）']], def: 'mean' },
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]},
    { id: 'standardize', title: '数值标准化', desc: '消除量纲差异', params: [
      { key: 'method', type: 'select', label: '方法', options: [['zscore', 'Z-score 标准化'], ['minmax', 'Min-Max 归一化']], def: 'zscore' },
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]},
    { id: 'encode', title: '类别编码', desc: '类别转数值', params: [
      { key: 'method', type: 'select', label: '方法', options: [['label', '标签编码'], ['onehot', '独热编码']], def: 'label' },
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]},
    { id: 'dropcols', title: '删除列', desc: '移除指定列', params: [{ key: 'cols', type: 'cols', label: '选择列' }] },
    { id: 'dropmissing', title: '删除含缺失的行', desc: '移除存在缺失的样本', params: [
      { key: 'scope', type: 'scope', label: '检查范围' }
    ]}
  ];

  const CLEAN_OPS = [
    { id: 'dedup', title: '去除重复行', desc: '移除完全重复样本', params: [] },
    { id: 'removeoutlier', title: '去除异常值行', desc: '按离群程度删除样本', params: [
      { key: 'method', type: 'select', label: '判定', options: [['iqr', 'IQR 四分位距'], ['zscore', 'Z-score']], def: 'iqr' },
      { key: 'threshold', type: 'select', label: '阈值', options: [['1.5', '×1.5'], ['2', '×2'], ['3', '×3']], def: '1.5' },
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]},
    { id: 'clipoutlier', title: '异常值截断', desc: '离群值收缩到边界', params: [
      { key: 'method', type: 'select', label: '判定', options: [['iqr', 'IQR'], ['zscore', 'Z-score']], def: 'iqr' },
      { key: 'threshold', type: 'select', label: '阈值', options: [['1.5', '×1.5'], ['3', '×3']], def: '1.5' },
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]},
    { id: 'trim', title: '字符串修剪', desc: '去首尾空格、合并空格', params: [
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]},
    { id: 'normalcase', title: '类别名统一', desc: '去空格并转小写', params: [
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]}
  ];

  const AUGMENT_OPS = [
    { id: 'smote', title: 'SMOTE 过采样', desc: '少数类近邻插值扩样', params: [
      { key: 'target', type: 'target', label: '目标列' },
      { key: 'features', type: 'scope', label: '特征列' },
      { key: 'multiplier', type: 'select', label: '合成数', options: [['1', '1 倍'], ['2', '2 倍'], ['3', '3 倍'], ['5', '5 倍']], def: '1' }
    ]},
    { id: 'noise', title: '高斯噪声扰动', desc: '对数值列施加扰动', params: [
      { key: 'sigma', type: 'select', label: '强度 σ', options: [['0.03', '3%'], ['0.05', '5%'], ['0.1', '10%'], ['0.2', '20%']], def: '0.05' },
      { key: 'multiplier', type: 'select', label: '生成数', options: [['1', '1'], ['2', '2'], ['3', '3']], def: '1' },
      { key: 'scope', type: 'scope', label: '应用范围' }
    ]},
    { id: 'duplicate', title: '随机复制样本', desc: '复制数据扩大规模', params: [{ key: 'times', type: 'select', label: '复制倍数', options: [['2', '2 倍'], ['3', '3 倍'], ['5', '5 倍']], def: '2' }] },
    { id: 'bootstrap', title: 'Bootstrap 重采样', desc: '有放回抽样至目标行数', params: [{ key: 'count', type: 'input', label: '目标行数', def: '500' }] }
  ];

  function renderOps(containerId, ops) {
    const el = $('#' + containerId);
    el.innerHTML = ops.map((op) => {
      const paramsHtml = op.params.map((p) => {
        if (p.type === 'select') {
          return '<div class="op-param-row"><span class="op-param-label">' + p.label + '</span><select class="select" data-op="' + op.id + '" data-param="' + p.key + '">' +
            p.options.map(([v, l]) => '<option value="' + v + '"' + (v === p.def ? ' selected' : '') + '>' + l + '</option>').join('') +
            '</select></div>';
        }
        if (p.type === 'input') {
          return '<div class="op-param-row"><span class="op-param-label">' + p.label + '</span><input class="input" type="number" data-op="' + op.id + '" data-param="' + p.key + '" value="' + p.def + '" /></div>';
        }
        if (p.type === 'cols') {
          return '<div class="op-param-row"><span class="op-param-label">' + p.label + '</span>' +
            '<div class="ms-host" data-ms="' + op.id + '|' + p.key + '"></div></div>';
        }
        if (p.type === 'target') {
          return '<div class="op-param-row"><span class="op-param-label">' + p.label + '</span><select class="select" data-op="' + op.id + '" data-param="' + p.key + '">' +
            state.columns.filter((c) => c.type === 'category').map((c) => '<option value="' + escapeHtml(c.key) + '">' + escapeHtml(c.label) + '</option>').join('') +
            '</select></div>';
        }
        if (p.type === 'scope') {
          return '<div class="op-param-row"><span class="op-param-label">' + p.label + '</span>' +
            '<div class="ms-host" data-ms="' + op.id + '|' + p.key + '"></div></div>';
        }
        return '';
      }).join('');
      return '<div class="op-card" data-opcard="' + op.id + '">' +
        '<div class="op-head">' +
          '<span class="op-toggle"><span class="op-toggle-knob"></span></span>' +
          '<div class="op-head-text"><span class="op-title">' + op.title + '</span><span class="op-desc">' + op.desc + '</span></div>' +
        '</div>' +
        '<div class="op-params">' + paramsHtml + '</div>' +
      '</div>';
    }).join('');

    // 绑定开关
    $$('#' + containerId + ' .op-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.op-params')) return;
        card.classList.toggle('checked');
      });
    });
    // 挂载多选下拉（scope / cols 参数，避免列过多撑高页面）
    $$('#' + containerId + ' .ms-host').forEach((host) => {
      const parts = host.dataset.ms.split('|');
      const opId = parts[0], paramKey = parts[1];
      const op = ops.find((o) => o.id === opId);
      if (!op) return;
      const param = op.params.find((pp) => pp.key === paramKey);
      if (!param) return;
      const isScope = param.type === 'scope';
      const ms = multiSelect(state.columns, { selected: isScope ? null : [] });
      host.appendChild(ms);
    });
  }

  function readOpParams(containerId, op) {
    const params = {};
    for (const p of op.params) {
      if (p.type === 'select') {
        const el = $('#' + containerId + ' [data-op="' + op.id + '"][data-param="' + p.key + '"]');
        params[p.key] = el ? el.value : p.def;
      } else if (p.type === 'input') {
        const el = $('#' + containerId + ' [data-op="' + op.id + '"][data-param="' + p.key + '"]');
        params[p.key] = el ? parseFloat(el.value) : parseFloat(p.def);
      } else if (p.type === 'cols') {
        params[p.key] = $$('#' + containerId + ' [data-ms="' + op.id + '|' + p.key + '"] input')
          .filter((b) => b.checked).map((b) => b.value);
      } else if (p.type === 'target') {
        const el = $('#' + containerId + ' [data-op="' + op.id + '"][data-param="' + p.key + '"]');
        params[p.key] = el ? el.value : '';
      } else if (p.type === 'scope') {
        const boxes = $$('#' + containerId + ' [data-ms="' + op.id + '|' + p.key + '"] input');
        const checked = boxes.filter((b) => b.checked).map((b) => b.value);
        params[p.key] = (boxes.length > 0 && checked.length === boxes.length) ? null : checked;
      }
    }
    return params;
  }

  function selectedOps(containerId, ops) {
    const checked = new Set($$('#' + containerId + ' .op-card.checked').map((c) => c.dataset.opcard));
    return ops.filter((op) => checked.has(op.id));
  }

  function runStageOps(containerId, ops, executor, tag) {
    const chosen = selectedOps(containerId, ops);
    if (!chosen.length) { toast('请先开启至少一个操作', 'err'); return; }
    const before = snapState();
    let rows = DU.clone(state.rows), columns = state.columns.map((c) => ({ ...c }));
    const logParts = [];
    for (const op of chosen) {
      const params = readOpParams(containerId, op);
      const res = executor(op.id, rows, columns, params);
      if (res && res.rows) { rows = res.rows; columns = res.columns; }
      else if (res) { rows = res; }
      logParts.push(op.title);
    }
    updateData(rows, columns);
    addHistory(tag, logParts.join('、') + '（' + before.rows.length + '行→' + rows.length + '行）', before);
    toast('完成：' + logParts.join('、'), 'ok');
  }

  function execPreprocess(id, rows, columns, p) {
    switch (id) {
      case 'impute': return A.imputeMissing(rows, columns, p.strategy, scopeKeys(p.scope));
      case 'standardize': return A.standardize(rows, columns, p.method, scopeKeys(p.scope));
      case 'encode': return p.method === 'onehot' ? A.oneHotEncode(rows, columns, scopeKeys(p.scope)) : A.labelEncode(rows, columns, scopeKeys(p.scope));
      case 'dropcols': {
        const keys = p.cols || [];
        if (!keys.length) return rows;
        return A.dropColumns(rows, columns, keys);
      }
      case 'dropmissing': return { rows: A.dropMissingRows(rows, columns, scopeKeys(p.scope)), columns };
    }
    return rows;
  }

  function execClean(id, rows, columns, p) {
    const method = p.method || 'iqr';
    const threshold = parseFloat(p.threshold || '1.5');
    const keys = scopeKeys(p.scope);
    switch (id) {
      case 'dedup': return { rows: A.dedup(rows), columns };
      case 'removeoutlier': return { rows: A.removeOutlierRows(rows, columns, method, threshold, keys), columns };
      case 'clipoutlier': return { rows: A.clipOutliers(rows, columns, method, threshold, keys), columns };
      case 'trim': return { rows: A.trimStrings(rows, columns, keys), columns };
      case 'normalcase': return { rows: A.normalizeCategory(rows, columns, keys), columns };
    }
    return rows;
  }

  function execAugment(id, rows, columns, p) {
    switch (id) {
      case 'smote': {
        const target = p.target || (state.columns.find((c) => c.type === 'category') || {}).key;
        if (!target) return rows;
        const counts = S.valueCounts(rows.map((r) => r[target]));
        const minority = counts.length ? counts[counts.length - 1][0] : null;
        if (minority === null || minority === undefined) return rows;
        const syn = A.smote(rows, columns, target, minority, 5, parseInt(p.multiplier || '1', 10), scopeKeys(p.features));
        return { rows: rows.concat(syn), columns };
      }
      case 'noise': return { rows: A.gaussianNoise(rows, columns, parseFloat(p.sigma || '0.05'), parseInt(p.multiplier || '1', 10), scopeKeys(p.scope)), columns };
      case 'duplicate': return { rows: A.duplicateSample(rows, parseInt(p.times || '2', 10)), columns };
      case 'bootstrap': return { rows: A.bootstrap(rows, parseInt(p.count || '500', 10)), columns };
    }
    return rows;
  }

  // ---------- 数据查询 ----------
  function renderQuery() {
    buildSelect('#sort-col', state.columns, '（无）');
    buildSelect('#group-col', state.columns, '（不分组）');
    buildSelect('#agg-col', state.columns.filter((c) => c.type === 'number'), '（无）');
    renderQueryCols();
    renderFilters();
  }

  function renderQueryCols() {
    const el = $('#query-cols');
    el.innerHTML = '';
    if (!state.columns.length) return;
    const ms = multiSelect(state.columns, {
      selected: state.queryColSel,
      onChange: (selNew) => { state.queryColSel = selNew; }
    });
    el.appendChild(ms);
  }

  function addFilter(def) {
    def = def || {};
    state.queryFilters.push({ col: def.col || state.columns[0].key, op: def.op || '=', value: def.value || '' });
    renderFilters();
  }

  function renderFilters() {
    const el = $('#filter-list');
    if (!state.queryFilters.length) {
      el.innerHTML = '<div class="empty-hint">暂无筛选条件</div>';
      return;
    }
    el.innerHTML = state.queryFilters.map((f, i) => {
      const colType = (state.columns.find((c) => c.key === f.col) || {}).type;
      const ops = colType === 'number'
        ? [['=', '等于'], ['!=', '不等于'], ['>', '大于'], ['<', '小于'], ['>=', '≥'], ['<=', '≤'], ['null', '为空'], ['notnull', '不为空']]
        : [['=', '等于'], ['!=', '不等于'], ['contains', '包含'], ['null', '为空'], ['notnull', '不为空']];
      const valueHidden = f.op === 'null' || f.op === 'notnull';
      return '<div class="filter-item" data-idx="' + i + '">' +
        '<select class="select" data-f="col">' + state.columns.map((c) => '<option value="' + escapeHtml(c.key) + '"' + (c.key === f.col ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>').join('') + '</select>' +
        '<select class="select" data-f="op">' + ops.map(([v, l]) => '<option value="' + v + '"' + (v === f.op ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        (valueHidden ? '' : '<input class="input" data-f="value" value="' + escapeHtml(f.value) + '" placeholder="值" />') +
        '<span class="filter-remove" data-f="rm">✕</span></div>';
    }).join('');

    $$('#filter-list .filter-item').forEach((item) => {
      const idx = parseInt(item.dataset.idx, 10);
      item.querySelector('[data-f="col"]').addEventListener('change', (e) => {
        state.queryFilters[idx].col = e.target.value;
        renderFilters();
      });
      item.querySelector('[data-f="op"]').addEventListener('change', (e) => {
        state.queryFilters[idx].op = e.target.value;
        renderFilters();
      });
      const valInput = item.querySelector('[data-f="value"]');
      if (valInput) valInput.addEventListener('change', (e) => { state.queryFilters[idx].value = e.target.value; });
      item.querySelector('[data-f="rm"]').addEventListener('click', () => {
        state.queryFilters.splice(idx, 1);
        renderFilters();
      });
    });
  }

  function matchFilter(v, op, value) {
    switch (op) {
      case '=': return !S.isMissing(v) && String(v) === String(value);
      case '!=': return S.isMissing(v) ? true : String(v) !== String(value);
      case '>': return S.isNumeric(v) && v > parseFloat(value);
      case '<': return S.isNumeric(v) && v < parseFloat(value);
      case '>=': return S.isNumeric(v) && v >= parseFloat(value);
      case '<=': return S.isNumeric(v) && v <= parseFloat(value);
      case 'contains': return typeof v === 'string' && v.toLowerCase().includes(String(value).toLowerCase());
      case 'null': return S.isMissing(v);
      case 'notnull': return !S.isMissing(v);
    }
    return true;
  }

  function runQuery() {
    if (!state.rows.length) { toast('当前没有数据', 'err'); return; }
    const before = snapState();
    const filterDefs = state.queryFilters;
    let rows = state.rows.filter((r) => filterDefs.every((f) => matchFilter(r[f.col], f.op, f.value)));

    const groupCol = $('#group-col').value;
    const aggCol = $('#agg-col').value;
    const aggFn = $('#agg-fn').value;

    if (groupCol) {
      const groups = new Map();
      for (const r of rows) {
        const g = S.isMissing(r[groupCol]) ? '(空)' : String(r[groupCol]);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r);
      }
      const groupLabel = (state.columns.find((c) => c.key === groupCol) || {}).label || groupCol;
      const aggLabel = (state.columns.find((c) => c.key === aggCol) || {}).label || aggCol;
      const resultCols = [
        { key: groupCol, label: groupLabel, type: 'category' },
        { key: 'agg', label: aggFn + '(' + aggLabel + ')', type: 'number' }
      ];
      const result = [...groups.entries()].map(([g, arr]) => {
        let agg;
        if (aggFn === 'count') agg = arr.length;
        else {
          const vals = arr.map((r) => r[aggCol]).filter((v) => S.isNumeric(v));
          if (aggFn === 'sum') agg = vals.reduce((s, x) => s + x, 0);
          else if (aggFn === 'avg') agg = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
          else if (aggFn === 'min') agg = vals.length ? Math.min(...vals) : null;
          else if (aggFn === 'max') agg = vals.length ? Math.max(...vals) : null;
        }
        return { [groupCol]: g, agg: agg };
      });
      result.sort((a, b) => (b.agg === null ? -1 : a.agg === null ? 1 : a.agg - b.agg));
      updateData(result, resultCols);
      addHistory('query', '分组聚合(' + aggFn + ') · ' + result.length + ' 组', before);
      toast('分组聚合完成 · ' + result.length + ' 组', 'ok');
    } else {
      const sortCol = $('#sort-col').value;
      const sortDir = $('#sort-dir').value;
      if (sortCol) {
        rows = rows.slice().sort((a, b) => {
          const va = a[sortCol], vb = b[sortCol];
          if (S.isMissing(va)) return 1; if (S.isMissing(vb)) return -1;
          const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
          return sortDir === 'desc' ? -cmp : cmp;
        });
      }
      const limit = Math.max(1, parseInt($('#limit-input').value || '100', 10));
      const sliced = rows.slice(0, limit);
      const sel = state.queryColSel;
      const outCols = (sel === null) ? state.columns : state.columns.filter((c) => sel.includes(c.key));
      if (!outCols.length) { toast('未选择任何显示列', 'err'); return; }
      const outRows = sliced.map((r) => { const o = {}; outCols.forEach((c) => o[c.key] = r[c.key]); return o; });
      updateData(outRows, outCols);
      addHistory('query', '筛选查询（命中 ' + rows.length + ' 行 · 展示 ' + outRows.length + ' 行）', before);
      toast('查询完成 · 命中 ' + rows.length + ' 行 · 展示 ' + outRows.length + ' 行', 'ok');
    }
  }

  // idx：目标查询在 state.history 中的下标；回退无需确认
  function undoQueryTo(idx) {
    const h = state.history[idx];
    if (!h || !h.snap) { toast('没有可回退的查询', 'err'); return; }
    const before = snapState();
    state.history.splice(0, idx + 1);
    updateData(h.snap.rows, h.snap.columns);
    addHistory('load', '回退查询「' + h.text + '」', before);
    toast('已回退查询「' + h.text + '」', 'ok');
  }

  function undoLastQuery() {
    const idx = state.history.findIndex((h) => h.tag === 'query' && h.snap);
    if (idx === -1) { toast('没有可回退的查询', 'err'); return; }
    undoQueryTo(idx);
  }

  // ===================== 导航 =====================
  function enterStage(stage) {
    if (!STAGE_META[stage]) stage = 'overview';
    state.activeStage = stage;
    const meta = STAGE_META[stage];
    $('#stage-title').textContent = meta.title;

    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.stage === stage));
    $$('.stage').forEach((s) => { s.hidden = s.id !== 'stage-' + stage; });
    // 学习板块、数据可视化板块不含数据预览
    $('#data-preview-panel').hidden = (stage === 'learn' || stage === 'viz');
    renderStage(stage);
  }

  function renderStage(stage) {
    if (stage === 'overview') renderOverview();
    else if (stage === 'assess') renderAssess();
    else if (stage === 'viz') renderViz();
    else if (stage === 'preprocess') renderOps('preprocess-ops', PREPROCESS_OPS);
    else if (stage === 'clean') renderOps('clean-ops', CLEAN_OPS);
    else if (stage === 'augment') renderOps('augment-ops', AUGMENT_OPS);
    else if (stage === 'query') renderQuery();
    // learn：静态内容，无需渲染
  }

  // ===================== 响应式导航（移动端抽屉） =====================
  function isMobileView() {
    return window.matchMedia('(max-width: 768px)').matches;
  }
  function openMobileSidebar() {
    document.querySelector('.app').classList.add('sidebar-open');
    $('#sidebar-backdrop').classList.add('show');
  }
  function closeMobileSidebar() {
    document.querySelector('.app').classList.remove('sidebar-open');
    $('#sidebar-backdrop').classList.remove('show');
  }
  function refreshSidebarToggle() {
    const app = document.querySelector('.app');
    const btn = $('#btn-toggle-sidebar');
    if (isMobileView()) {
      btn.textContent = '☰';
      btn.title = '菜单';
    } else {
      const collapsed = app.classList.contains('sidebar-collapsed');
      btn.textContent = collapsed ? '☰' : '«';
      btn.title = collapsed ? '展开侧栏' : '收起侧栏';
    }
  }

  // ===================== CSV =====================
  function exportCSV() {
    const head = state.columns.map((c) => '"' + String(c.label).replace(/"/g, '""') + '"').join(',');
    const lines = state.rows.map((r) => state.columns.map((c) => {
      const v = r[c.key];
      if (S.isMissing(v)) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','));
    const blob = new Blob(['\uFEFF' + head + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dataforge_export.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 CSV', 'ok');
  }

  function loadSample() {
    const rows = DataGen.sampleData(240);
    setData(rows, DataGen.COLUMNS.map((c) => ({ ...c })));
    addHistory('load', '加载示例数据（240 行客户数据）');
    toast('已加载示例数据', 'ok');
    enterStage('overview');
  }

  function uploadCSV(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = DataGen.parseCSV(String(reader.result), true);
      if (!parsed || !parsed.rows.length) { toast('CSV 解析失败或为空', 'err'); return; }
      setData(parsed.rows, parsed.columns);
      addHistory('load', '上传 CSV（' + parsed.rows.length + ' 行）');
      toast('已导入 ' + parsed.rows.length + ' 行数据', 'ok');
      enterStage('overview');
    };
    reader.readAsText(file);
  }

  // ===================== 事件绑定 =====================
  function bindEvents() {
    $$('.nav-item').forEach((n) => n.addEventListener('click', () => {
      enterStage(n.dataset.stage);
      closeMobileSidebar();
    }));

    // 侧栏收起/展开（桌面折叠 · 移动端抽屉）
    $('#btn-toggle-sidebar').addEventListener('click', () => {
      const app = document.querySelector('.app');
      if (isMobileView()) {
        if (app.classList.contains('sidebar-open')) closeMobileSidebar();
        else openMobileSidebar();
      } else {
        const collapsed = app.classList.toggle('sidebar-collapsed');
        if (state.activeStage === 'assess') {
          setTimeout(() => { drawHist(); drawBox(); drawHeatmap(); }, 240);
        }
      }
      refreshSidebarToggle();
    });
    $('#sidebar-backdrop').addEventListener('click', closeMobileSidebar);
    window.addEventListener('resize', () => {
      if (isMobileView()) {
        document.querySelector('.app').classList.remove('sidebar-collapsed');
      } else {
        closeMobileSidebar();
      }
      refreshSidebarToggle();
    });

    $('#btn-load-sample').addEventListener('click', loadSample);
    $('#btn-download').addEventListener('click', exportCSV);
    $('#file-input').addEventListener('change', (e) => {
      if (e.target.files.length) uploadCSV(e.target.files[0]);
      e.target.value = '';
    });

    // 历史：清空 + 回滚（事件委托）
    $('#btn-clear-history').addEventListener('click', () => {
      state.history = [];
      renderHistory();
    });
    $('#history-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.history-rollback');
      if (btn) rollback(parseInt(btn.dataset.idx, 10));
    });

    // 数据预览收起/展开
    $('#btn-toggle-preview').addEventListener('click', () => {
      const body = $('#preview-body');
      const btn = $('#btn-toggle-preview');
      const collapsed = body.classList.toggle('collapsed');
      btn.textContent = collapsed ? '展开 ▾' : '收起 ▴';
    });

    // 处理管线各操作模块收起/展开
    $$('.collapse-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const body = document.getElementById(btn.dataset.target);
        if (!body) return;
        const collapsed = body.classList.toggle('collapsed');
        btn.textContent = collapsed ? '展开 ▾' : '收起 ▴';
      });
    });

    // 评估图表联动
    $('#hist-col').addEventListener('change', drawHist);
    $('#box-col').addEventListener('change', drawBox);

    // 预处理 / 清洗 / 增强
    $('#btn-preprocess-run').addEventListener('click', () => runStageOps('preprocess-ops', PREPROCESS_OPS, execPreprocess, 'preprocess'));
    $('#btn-clean-run').addEventListener('click', () => runStageOps('clean-ops', CLEAN_OPS, execClean, 'clean'));
    $('#btn-augment-run').addEventListener('click', () => runStageOps('augment-ops', AUGMENT_OPS, execAugment, 'augment'));

    // 查询
    $('#btn-add-filter').addEventListener('click', () => addFilter());
    $('#btn-query-run').addEventListener('click', runQuery);
    $('#btn-query-undo').addEventListener('click', undoLastQuery);

    // 数据可视化：标记类型切换（事件委托，兼容动态追加的标记按钮）
    $('#viz-marks').addEventListener('click', (e) => {
      const b = e.target.closest('.mark');
      if (!b) return;
      state.viz.mark = b.dataset.mark;
      renderVizMarks();
      drawVizChart();
    });

    // 数据可视化：度量聚合切换
    $('#viz-agg').addEventListener('change', (e) => {
      state.viz.agg = e.target.value;
      drawVizChart();
    });

    // 数据可视化：货架拖放
    $$('.shelf-drop').forEach((drop) => {
      const role = drop.dataset.role;
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        drop.classList.add('drag-over');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('drag-over');
        const key = e.dataTransfer.getData('text/plain');
        if (key) vizAssignShelf(role, key);
      });
    });

    // 点击空白处关闭多选下拉
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.ms.open').forEach((o) => {
        if (!o.contains(e.target)) {
          o.classList.remove('open');
        }
      });
    });
  }

  // ===================== 启动 =====================
  function init() {
    bindEvents();
    refreshSidebarToggle();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();