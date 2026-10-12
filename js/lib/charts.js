// charts.js — 原生 Canvas 图表（无外部依赖，支持高 DPI + 悬停提示）
window.Charts = (function () {
  'use strict';

  const COLORS = ['#5b8cff', '#7c5cff', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#ec4899', '#38bdf8', '#a3e635', '#fb923c'];

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    // 逻辑高度在首次绘制时固定到 data-h，避免 canvas.height 属性被改写后，
    // 再次读取 getAttribute('height') 得到翻倍的高度（每次重绘指数级放大）。
    let h = parseInt(canvas.dataset.h, 10);
    if (!h) {
      h = parseInt(canvas.getAttribute('height'), 10) || 240;
      canvas.dataset.h = String(h);
    }
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function fmt(v) {
    if (v === null || v === undefined) return '';
    const n = Number(v);
    if (isNaN(n)) return String(v);
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1000000) return sign + (a / 1000000).toFixed(1) + 'M';
    if (a >= 1000) return sign + (a / 1000).toFixed(1) + 'k';
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2);
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const d = v / p;
    const n = d <= 1 ? 1 : d <= 2 ? 2 : d <= 5 ? 5 : 10;
    return n * p;
  }

  // ---------- 悬停提示 ----------
  let _tipEl = null;
  function tipEl() {
    if (!_tipEl) {
      _tipEl = document.createElement('div');
      _tipEl.className = 'chart-tooltip';
      document.body.appendChild(_tipEl);
    }
    return _tipEl;
  }
  function showTip(evt, text) {
    const el = tipEl();
    el.innerHTML = text;
    el.style.opacity = '1';
    const pad = 14;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    const r = el.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  function hideTip() { if (_tipEl) _tipEl.style.opacity = '0'; }
  function canvasPos(evt, canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: evt.clientX - r.left, y: evt.clientY - r.top };
  }
  function bindHover(canvas, hits) {
    canvas.onmousemove = function (evt) {
      const p = canvasPos(evt, canvas);
      const hit = hits.find((h) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
      if (hit) showTip(evt, hit.text); else hideTip();
    };
    canvas.onmouseleave = hideTip;
  }

  // 柱状图
  function bar(canvas, labels, values, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const padL = 44, padR = 12, padT = 16, padB = 34;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    ctx.clearRect(0, 0, w, h);
    const max = niceMax(Math.max(1, ...values));
    ctx.strokeStyle = 'rgba(138,151,173,0.14)';
    ctx.fillStyle = 'rgba(138,151,173,0.8)';
    ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (plotH * i) / gridLines;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      const val = max - (max * i) / gridLines;
      ctx.fillText(fmt(val), padL - 7, y);
    }
    const hits = [];
    if (labels.length) {
      const bw = plotW / labels.length;
      const barW = Math.max(2, Math.min(bw * 0.68, 40));
      labels.forEach((lab, i) => {
        const v = values[i] || 0;
        const bh = (v / max) * plotH;
        const x = padL + bw * i + (bw - barW) / 2;
        const y = padT + plotH - bh;
        const col = opts.colors ? opts.colors[i % opts.colors.length] : COLORS[i % COLORS.length];
        const grad = ctx.createLinearGradient(0, y, 0, padT + plotH);
        grad.addColorStop(0, col);
        grad.addColorStop(1, col + '55');
        ctx.fillStyle = grad;
        roundRect(ctx, x, y, barW, bh, 3);
        ctx.fill();
        hits.push({ x, y, w: barW, h: bh, text: lab + '：' + v });
        ctx.fillStyle = 'rgba(138,151,173,0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '10px sans-serif';
        let txt = String(lab);
        if (txt.length > 6) txt = txt.slice(0, 5) + '…';
        ctx.fillText(txt, padL + bw * i + bw / 2, padT + plotH + 7);
      });
    }
    bindHover(canvas, hits);
  }

  // 柱状图（横向，带数值标注）
  function barH(canvas, labels, values, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const padL = 110, padR = 40, padT = 14, padB = 24;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    ctx.clearRect(0, 0, w, h);
    const max = niceMax(Math.max(1, ...values));
    const n = labels.length;
    const bh = plotH / n;
    const barH = Math.max(4, Math.min(bh * 0.7, 26));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '11px sans-serif';
    labels.forEach((lab, i) => {
      const y = padT + bh * i + bh / 2;
      ctx.fillStyle = 'rgba(138,151,173,0.9)';
      let txt = String(lab);
      if (txt.length > 10) txt = txt.slice(0, 9) + '…';
      ctx.fillText(txt, padL - 10, y);
      const v = values[i] || 0;
      const bw = (v / max) * plotW;
      const col = opts.colors ? opts.colors[i % opts.colors.length] : COLORS[i % COLORS.length];
      ctx.fillStyle = col;
      roundRect(ctx, padL, y - barH / 2, bw, barH, 3);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,247,0.9)';
      ctx.fillText(fmt(v), padL + bw + 6, y);
      ctx.textAlign = 'right';
    });
  }

  // 直方图
  function histogram(canvas, hist, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const values = hist.values, n = values.length;
    const padL = 44, padR = 12, padT = 16, padB = 32;
    ctx.clearRect(0, 0, w, h);
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const max = niceMax(Math.max(1, ...values));
    ctx.strokeStyle = 'rgba(138,151,173,0.14)';
    ctx.fillStyle = 'rgba(138,151,173,0.8)';
    ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(fmt(max - (max * i) / 4), padL - 7, y);
    }
    const bw = plotW / n;
    const hits = [];
    for (let i = 0; i < n; i++) {
      const v = values[i] || 0;
      const bh = (v / max) * plotH;
      const x = padL + bw * i + 1;
      const y = padT + plotH - bh;
      const grad = ctx.createLinearGradient(0, y, 0, padT + plotH);
      grad.addColorStop(0, '#5b8cff');
      grad.addColorStop(1, '#7c5cff66');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, bw - 2, bh);
      hits.push({ x, y, w: bw - 2, h: bh, text: hist.labels[i] + '：' + v });
    }
    // x 轴刻度（压缩显示，避免重叠）
    const step = Math.max(1, Math.ceil(n / 6));
    ctx.fillStyle = 'rgba(138,151,173,0.9)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px sans-serif';
    for (let i = 0; i < n; i += step) {
      const left = hist.min + i * hist.width;
      ctx.fillText(fmt(left), padL + bw * i + bw / 2, padT + plotH + 7);
    }
    bindHover(canvas, hits);
  }

  // 箱线图（异常值截断显示，避免范围被极端值拉长）
  function boxplot(canvas, values, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const a = values.filter(Stats.isNumeric).sort((x, y) => x - y);
    const padL = 44, padR = 48, padT = 26, padB = 26;
    ctx.clearRect(0, 0, w, h);
    const plotW = w - padL - padR, plotH = h - padT - padB;
    if (!a.length) {
      ctx.fillStyle = 'rgba(138,151,173,0.7)'; ctx.textAlign = 'center';
      ctx.fillText('无数值数据', w / 2, h / 2);
      return;
    }
    const q1 = Stats.quantile(a, 0.25), q2 = Stats.quantile(a, 0.5), q3 = Stats.quantile(a, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    // 须端 = 落在 1.5 IQR 内的实际极值
    let whiskerLow = a[0], whiskerHigh = a[a.length - 1];
    for (const v of a) { if (v >= lo) { whiskerLow = v; break; } }
    for (let i = a.length - 1; i >= 0; i--) { if (a[i] <= hi) { whiskerHigh = a[i]; break; } }
    const outliers = a.filter((v) => v < lo || v > hi);

    let loR = whiskerLow, hiR = whiskerHigh;
    if (hiR === loR) { loR -= 1; hiR += 1; }
    const span = hiR - loR || 1;
    loR -= span * 0.08; hiR += span * 0.08;
    const scale = (v) => padL + Math.max(0, Math.min(1, (v - loR) / (hiR - loR))) * plotW;

    // 轴刻度
    ctx.fillStyle = 'rgba(138,151,173,0.8)'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const v = loR + ((hiR - loR) * i) / 4;
      const x = padL + (plotW * i) / 4;
      ctx.strokeStyle = 'rgba(138,151,173,0.1)';
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.fillText(fmt(v), x, padT + plotH + 7);
    }
    const cy = padT + plotH / 2;
    const boxH = plotH * 0.4;
    // 须
    ctx.strokeStyle = '#8a97ad'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(scale(whiskerLow), cy); ctx.lineTo(scale(q1), cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(scale(q3), cy); ctx.lineTo(scale(whiskerHigh), cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(scale(whiskerLow), cy - boxH / 4); ctx.lineTo(scale(whiskerLow), cy + boxH / 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(scale(whiskerHigh), cy - boxH / 4); ctx.lineTo(scale(whiskerHigh), cy + boxH / 4); ctx.stroke();
    // 箱体
    const grad = ctx.createLinearGradient(0, cy - boxH / 2, 0, cy + boxH / 2);
    grad.addColorStop(0, '#5b8cff');
    grad.addColorStop(1, '#7c5cff');
    ctx.fillStyle = grad;
    roundRect(ctx, scale(q1), cy - boxH / 2, Math.max(1, scale(q3) - scale(q1)), boxH, 3);
    ctx.fill();
    // 中位线
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(scale(q2), cy - boxH / 2); ctx.lineTo(scale(q2), cy + boxH / 2); ctx.stroke();
    // 异常值：截断到绘图边界显示
    ctx.fillStyle = '#f87171';
    for (const o of outliers) {
      ctx.beginPath(); ctx.arc(scale(Math.max(loR, Math.min(hiR, o))), cy, 3, 0, Math.PI * 2); ctx.fill();
    }
    // 摘要（压缩一行）
    ctx.fillStyle = 'rgba(230,237,247,0.85)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '10px sans-serif';
    ctx.fillText('Q1 ' + fmt(q1) + ' · 中位 ' + fmt(q2) + ' · Q3 ' + fmt(q3) + ' · 异常值 ' + outliers.length, padL, 0);
  }

  // 相关性热力图
  function heatmap(canvas, matrix, labels) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const n = matrix.length;
    if (!n) return;
    const short = (s) => (String(s).length > 8 ? String(s).slice(0, 8) + '…' : String(s));
    const labs = labels.map(short);

    // 依据标签实际宽度动态计算留白，避免数字与标签重叠
    const labelFont = '11px sans-serif';
    ctx.font = labelFont;
    let maxLabW = 0;
    labs.forEach((l) => { maxLabW = Math.max(maxLabW, ctx.measureText(l).width); });
    const padL = Math.ceil(maxLabW) + 16;      // 左侧行标签
    const padR = 18;
    const padT = 12;
    const padB = Math.ceil(maxLabW * 0.75) + 22; // 底部旋转标签垂直空间

    let size = Math.floor(Math.min((w - padL - padR) / n, (h - padT - padB) / n));
    size = Math.max(10, Math.min(64, size));
    const grid = size * n;
    const startX = padL + Math.floor((w - padL - padR - grid) / 2);
    const startY = padT;

    ctx.textBaseline = 'middle';
    const showNum = size >= 24;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = matrix[i][j];
        ctx.fillStyle = corrColor(v);
        ctx.fillRect(startX + j * size + 0.5, startY + i * size + 0.5, size - 1, size - 1);
        if (showNum && !isNaN(v)) {
          ctx.fillStyle = Math.abs(v) > 0.55 ? '#0b0f17' : 'rgba(230,237,247,0.85)';
          ctx.font = (size > 40 ? '11px' : '9px') + ' sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(v.toFixed(2), startX + j * size + size / 2, startY + i * size + size / 2);
        }
      }
    }

    // 左侧行标签（右对齐到网格左侧）
    ctx.font = labelFont;
    ctx.fillStyle = 'rgba(160,172,195,0.95)';
    ctx.textAlign = 'right';
    labs.forEach((lab, i) => {
      ctx.fillText(lab, startX - 8, startY + i * size + size / 2);
    });

    // 底部列标签：末端锚定 + 向下倾斜，标签整体悬于网格下方、不侵入单元格
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    labs.forEach((lab, j) => {
      ctx.save();
      ctx.translate(startX + j * size + size / 2, startY + grid + 14);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(lab, 0, 0);
      ctx.restore();
    });
  }

  // 饼图（含图例 + 悬停提示）
  function pie(canvas, labels, values, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const total = values.reduce((s, v) => s + v, 0) || 1;
    const cx = w * 0.36, cy = h / 2;
    const radius = Math.max(24, Math.min(w * 0.26, h * 0.40));
    const start0 = -Math.PI / 2;
    let start = start0;
    const slices = [];
    values.forEach((v, i) => {
      if (v <= 0) return;
      const ang = (v / total) * Math.PI * 2;
      const end = start + ang;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(11,15,23,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      slices.push({ start, end, label: labels[i], value: v, color: COLORS[i % COLORS.length] });
      start = end;
    });
    // 图例（右侧，紧凑）
    const lx = cx + radius + 18;
    let ly = Math.max(12, cy - slices.length * 11);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '12px sans-serif';
    slices.forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly - 5, 10, 10);
      ctx.fillStyle = 'rgba(230,237,247,0.9)';
      const pct = (s.value / total * 100);
      ctx.fillText(s.label + '  ' + s.value + ' (' + (pct >= 10 || pct < 1 ? pct.toFixed(0) : pct.toFixed(1)) + '%)', lx + 16, ly);
      ly += 20;
    });
    // 悬停
    canvas.onmousemove = function (evt) {
      const p = canvasPos(evt, canvas);
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius + 2) {
        let ang = Math.atan2(dy, dx);
        if (ang < start0) ang += Math.PI * 2;
        const s = slices.find((sl) => ang >= sl.start && ang < sl.end);
        if (s) {
          const pct = s.value / total * 100;
          showTip(evt, s.label + '：' + s.value + '（' + pct.toFixed(1) + '%）');
          return;
        }
      }
      hideTip();
    };
    canvas.onmouseleave = hideTip;
  }

  // ---------- 分类坐标布局（折线/面积/分组柱/堆叠柱共用） ----------
  function catLayout(canvas) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h, padL: 54, padR: 16, padT: 20, padB: 38, plotW: w - 54 - 16, plotH: h - 20 - 38 };
  }

  function drawYGrid(ctx, padL, padT, plotW, plotH, max) {
    const lines = 4;
    ctx.strokeStyle = 'rgba(138,151,173,0.14)';
    ctx.fillStyle = 'rgba(138,151,173,0.8)';
    ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= lines; i++) {
      const y = padT + plotH * i / lines;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(fmt(max - max * i / lines), padL - 7, y);
    }
  }

  function drawXLabels(ctx, padL, padT, plotW, plotH, labels) {
    const n = labels.length;
    if (!n) return;
    const bw = plotW / n;
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));
    ctx.fillStyle = 'rgba(138,151,173,0.9)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px sans-serif';
    labels.forEach((lab, i) => {
      if (i % step !== 0) return;
      let t = String(lab);
      if (t.length > 8) t = t.slice(0, 7) + '…';
      ctx.fillText(t, padL + bw * i + bw / 2, padT + plotH + 8);
    });
  }

  function drawLegend(ctx, w, series) {
    if (!series || series.length <= 1) return;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '10.5px sans-serif';
    let x = 10, y = 5;
    series.forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(x, y, 9, 9);
      ctx.fillStyle = 'rgba(230,237,247,0.85)';
      const label = String(s.name);
      const short = label.length > 10 ? label.slice(0, 9) + '…' : label;
      ctx.fillText(short, x + 13, y + 5);
      x += 13 + ctx.measureText(short).width + 14;
    });
  }

  function asSeries(series) {
    return series.map((s, i) => ({ name: s.name, values: s.values || [], color: s.color || COLORS[i % COLORS.length] }));
  }

  // 折线图（多序列）
  function line(canvas, xLabels, series, opts) {
    opts = opts || {};
    series = asSeries(series);
    const { ctx, w, padL, padT, plotW, plotH } = catLayout(canvas);
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values).filter((v) => v != null)));
    drawYGrid(ctx, padL, padT, plotW, plotH, max);
    const n = xLabels.length;
    const bw = n ? plotW / n : plotW;
    const px = (i) => padL + bw * i + bw / 2;
    const py = (v) => padT + plotH - (v == null ? 0 : (v / max) * plotH);
    const hits = [];
    ctx.lineWidth = 2;
    series.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      s.values.forEach((v, i) => { const x = px(i), y = py(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke();
      s.values.forEach((v, i) => {
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(px(i), py(v), 3, 0, Math.PI * 2); ctx.fill();
        if (v != null) hits.push({ x: px(i) - 6, y: py(v) - 6, w: 12, h: 12, text: xLabels[i] + ' · ' + s.name + '：' + fmt(v) });
      });
    });
    drawXLabels(ctx, padL, padT, plotW, plotH, xLabels);
    drawLegend(ctx, w, series);
    bindHover(canvas, hits);
  }

  // 面积图（堆叠）
  function area(canvas, xLabels, series, opts) {
    opts = opts || {};
    series = asSeries(series);
    const { ctx, w, padL, padT, plotW, plotH } = catLayout(canvas);
    const n = xLabels.length;
    const totals = xLabels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0));
    const max = niceMax(Math.max(1, ...totals));
    drawYGrid(ctx, padL, padT, plotW, plotH, max);
    const bw = n ? plotW / n : plotW;
    const px = (i) => padL + bw * i + bw / 2;
    const py = (v) => padT + plotH - (v / max) * plotH;
    let cum = new Array(n).fill(0);
    const hits = [];
    series.forEach((s) => {
      ctx.fillStyle = s.color + 'cc';
      ctx.beginPath();
      s.values.forEach((v, i) => { const x = px(i), y = py(cum[i] + (v || 0)); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(px(i), py(cum[i]));
      ctx.closePath();
      ctx.fill();
      cum = cum.map((c, i) => c + (s.values[i] || 0));
    });
    xLabels.forEach((lab, i) => {
      if (totals[i] > 0) hits.push({ x: px(i) - bw / 2, y: padT, w: bw, h: plotH, text: lab + ' · 合计：' + fmt(totals[i]) });
    });
    drawXLabels(ctx, padL, padT, plotW, plotH, xLabels);
    drawLegend(ctx, w, series);
    bindHover(canvas, hits);
  }

  // 分组柱状图（多序列）
  function barGrouped(canvas, xLabels, series, opts) {
    opts = opts || {};
    series = asSeries(series);
    const { ctx, w, padL, padT, plotW, plotH } = catLayout(canvas);
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values).filter((v) => v != null)));
    drawYGrid(ctx, padL, padT, plotW, plotH, max);
    const n = xLabels.length;
    const bw = n ? plotW / n : plotW;
    const k = series.length || 1;
    const groupW = Math.min(bw * 0.72, 46);
    const barW = Math.max(2, groupW / k);
    const hits = [];
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v == null) return;
        const bh = (v / max) * plotH;
        const x = padL + bw * i + bw / 2 - groupW / 2 + si * barW;
        const y = padT + plotH - bh;
        ctx.fillStyle = s.color;
        roundRect(ctx, x, y, barW - 1, bh, 2);
        ctx.fill();
        hits.push({ x, y, w: barW - 1, h: bh, text: xLabels[i] + ' · ' + s.name + '：' + fmt(v) });
      });
    });
    drawXLabels(ctx, padL, padT, plotW, plotH, xLabels);
    drawLegend(ctx, w, series);
    bindHover(canvas, hits);
  }

  // 堆叠柱状图
  function barStacked(canvas, xLabels, series, opts) {
    opts = opts || {};
    series = asSeries(series);
    const { ctx, w, padL, padT, plotW, plotH } = catLayout(canvas);
    const n = xLabels.length;
    const totals = xLabels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0));
    const max = niceMax(Math.max(1, ...totals));
    drawYGrid(ctx, padL, padT, plotW, plotH, max);
    const bw = n ? plotW / n : plotW;
    const barW = Math.max(2, Math.min(bw * 0.68, 40));
    const hits = [];
    xLabels.forEach((lab, i) => {
      let acc = 0;
      series.forEach((s) => {
        const v = s.values[i] || 0;
        if (v === 0) return;
        const bh = (v / max) * plotH;
        const x = padL + bw * i + (bw - barW) / 2;
        const y = padT + plotH - (acc + v) / max * plotH;
        ctx.fillStyle = s.color;
        roundRect(ctx, x, y, barW, bh, 1);
        ctx.fill();
        hits.push({ x, y, w: barW, h: bh, text: lab + ' · ' + s.name + '：' + fmt(v) });
        acc += v;
      });
    });
    drawXLabels(ctx, padL, padT, plotW, plotH, xLabels);
    drawLegend(ctx, w, series);
    bindHover(canvas, hits);
  }

  // 散点图（支持序列着色）
  function scatter(canvas, series, xLabel, yLabel) {
    series = (series || []).filter((s) => s.points && s.points.length)
      .map((s, i) => ({ name: s.name, color: s.color || COLORS[i % COLORS.length], points: s.points }));
    const { ctx, w, h, padL, padT, plotW, plotH } = catLayout(canvas);
    const all = series.flatMap((s) => s.points);
    if (!all.length) {
      ctx.fillStyle = 'rgba(138,151,173,0.7)'; ctx.textAlign = 'center';
      ctx.fillText('请配置两个度量字段（列=X 轴 · 行=Y 轴）', w / 2, h / 2);
      return;
    }
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    all.forEach(([x, y]) => { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); });
    if (xmin === xmax) { xmin -= 1; xmax += 1; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const px0 = (xmax - xmin) * 0.06, py0 = (ymax - ymin) * 0.06;
    xmin -= px0; xmax += px0; ymin -= py0; ymax += py0;
    const sx = (v) => padL + (v - xmin) / (xmax - xmin) * plotW;
    const sy = (v) => padT + plotH - (v - ymin) / (ymax - ymin) * plotH;
    const ticks = 4;
    ctx.strokeStyle = 'rgba(138,151,173,0.14)';
    ctx.fillStyle = 'rgba(138,151,173,0.8)'; ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= ticks; i++) {
      const vx = xmin + (xmax - xmin) * i / ticks;
      const x = padL + plotW * i / ticks;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.fillText(fmt(vx), x, padT + plotH + 7);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= ticks; i++) {
      const vy = ymax - (ymax - ymin) * i / ticks;
      const y = padT + plotH * i / ticks;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(fmt(vy), padL - 7, y);
    }
    if (xLabel) { ctx.fillStyle = 'rgba(160,172,195,0.95)'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = '11px sans-serif'; ctx.fillText(String(xLabel), padL + plotW, h - 4); }
    if (yLabel) { ctx.fillStyle = 'rgba(160,172,195,0.95)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '11px sans-serif'; ctx.fillText(String(yLabel), padL, 4); }
    const hits = [];
    series.forEach((s) => {
      s.points.forEach(([x, y]) => {
        ctx.fillStyle = s.color; ctx.globalAlpha = 0.72;
        ctx.beginPath(); ctx.arc(sx(x), sy(y), 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        hits.push({ x: sx(x) - 5, y: sy(y) - 5, w: 10, h: 10, text: s.name + ' · (' + fmt(x) + ', ' + fmt(y) + ')' });
      });
    });
    drawLegend(ctx, w, series);
    bindHover(canvas, hits);
  }

  function corrColor(v) {
    if (isNaN(v)) return '#1a2338';
    const blue = [27, 41, 68], red = [239, 68, 68];
    if (v >= 0) return rgbLerp(blue, [91, 140, 255], v);
    return rgbLerp(blue, red, -v);
  }

  function rgbLerp(a, b, t) {
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 分组箱线图（横向，按维度分组，共享刻度）
  function boxGroups(canvas, labels, valuesArrays, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 92, padR = 16, padT = 16, padB = 26;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const n = labels.length;
    function noData(msg) { ctx.fillStyle = 'rgba(138,151,173,0.7)'; ctx.textAlign = 'center'; ctx.fillText(msg, w / 2, h / 2); }
    if (!n) { noData('无数值数据'); return; }

    function box(a) {
      a = a.filter(Stats.isNumeric).sort((x, y) => x - y);
      if (!a.length) return null;
      const q1 = Stats.quantile(a, 0.25), q2 = Stats.quantile(a, 0.5), q3 = Stats.quantile(a, 0.75);
      const iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
      let wl = a[0], wh = a[a.length - 1];
      for (const v of a) { if (v >= lo) { wl = v; break; } }
      for (let i = a.length - 1; i >= 0; i--) { if (a[i] <= hi) { wh = a[i]; break; } }
      const out = a.filter((v) => v < lo || v > hi);
      return { q1, q2, q3, wl, wh, out };
    }
    const boxes = valuesArrays.map(box);
    const all = valuesArrays.flat().filter(Stats.isNumeric);
    if (!all.length) { noData('无数值数据'); return; }
    let loR = Math.min(...all), hiR = Math.max(...all);
    if (hiR === loR) { loR -= 1; hiR += 1; }
    const span = hiR - loR || 1;
    loR -= span * 0.06; hiR += span * 0.06;
    const scale = (v) => padL + Math.max(0, Math.min(1, (v - loR) / (hiR - loR))) * plotW;

    // 轴刻度
    ctx.strokeStyle = 'rgba(138,151,173,0.12)';
    ctx.fillStyle = 'rgba(138,151,173,0.8)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const v = loR + (hiR - loR) * i / 4;
      const x = padL + plotW * i / 4;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.fillText(fmt(v), x, padT + plotH + 7);
    }

    const slot = plotH / n;
    const boxH = Math.max(7, Math.min(slot * 0.55, 24));
    const hits = [];
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '11px sans-serif';
    boxes.forEach((b, i) => {
      const cy = padT + slot * i + slot / 2;
      ctx.fillStyle = 'rgba(138,151,173,0.9)';
      let t = String(labels[i]); if (t.length > 8) t = t.slice(0, 7) + '…';
      ctx.fillText(t, padL - 10, cy);
      if (!b) return;
      const col = (opts.colors && opts.colors[i % opts.colors.length]) || COLORS[i % COLORS.length];
      ctx.strokeStyle = '#8a97ad'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(scale(b.wl), cy); ctx.lineTo(scale(b.q1), cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(scale(b.q3), cy); ctx.lineTo(scale(b.wh), cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(scale(b.wl), cy - boxH / 4); ctx.lineTo(scale(b.wl), cy + boxH / 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(scale(b.wh), cy - boxH / 4); ctx.lineTo(scale(b.wh), cy + boxH / 4); ctx.stroke();
      ctx.fillStyle = col;
      roundRect(ctx, scale(b.q1), cy - boxH / 2, Math.max(1, scale(b.q3) - scale(b.q1)), boxH, 2);
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(scale(b.q2), cy - boxH / 2); ctx.lineTo(scale(b.q2), cy + boxH / 2); ctx.stroke();
      ctx.fillStyle = '#f87171';
      for (const o of b.out) { ctx.beginPath(); ctx.arc(scale(Math.max(loR, Math.min(hiR, o))), cy, 2.5, 0, Math.PI * 2); ctx.fill(); }
      hits.push({ x: padL, y: cy - slot / 2, w: plotW, h: slot, text: String(labels[i]) + ' · Q1 ' + fmt(b.q1) + ' · 中位 ' + fmt(b.q2) + ' · Q3 ' + fmt(b.q3) + ' · 异常值 ' + b.out.length });
    });
    bindHover(canvas, hits);
  }

  // 地理气泡图（经纬度投影，气泡大小=数值；可叠加中国省份底图轮廓）
  function geoBubble(canvas, series, opts) {
    opts = opts || {};
    series = (series || []).filter((s) => s.points && s.points.length)
      .map((s, i) => ({ name: s.name, color: s.color || COLORS[i % COLORS.length], points: s.points }));
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 40, padR = 14, padT = 16, padB = 30;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const base = (opts.baseMap && window.ChinaGeo && window.ChinaGeo.provinces) ? window.ChinaGeo : null;

    // Web Mercator 纵向投影，让中国地图形状接近真实比例
    const my = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const latOf = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

    const all = series.flatMap((s) => s.points);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, vmax = 0;
    if (base && base.bounds && base.bounds.length === 4) {
      xmin = base.bounds[0]; xmax = base.bounds[2];
      ymin = my(base.bounds[1]); ymax = my(base.bounds[3]);
    }
    all.forEach((p) => {
      const y = my(p.y);
      if (p.x < xmin) xmin = p.x;
      if (p.x > xmax) xmax = p.x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
      vmax = Math.max(vmax, p.v || 0);
    });
    if (!Number.isFinite(xmin)) { xmin = 73; ymin = my(18); xmax = 135; ymax = my(54); }
    if (xmin === xmax) { xmin -= 1; xmax += 1; }
    if (ymin === ymax) { ymin -= 0.05; ymax += 0.05; }

    const px = (lng) => padL + (lng - xmin) / (xmax - xmin) * plotW;
    const py = (lat) => padT + plotH - (my(lat) - ymin) / (ymax - ymin) * plotH;

    if (!base && !all.length) {
      ctx.fillStyle = 'rgba(138,151,173,0.7)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('请把地理位置字段拖到「列」货架', w / 2, h / 2);
      return;
    }

    // ---- 省份层：边界轮廓 + 省名 ----
    if (base) {
      ctx.lineJoin = 'round';
      base.provinces.forEach((pr) => {
        if (!pr.r || !pr.r.length) return;
        ctx.beginPath();
        pr.r.forEach((ring) => {
          if (!ring || ring.length < 3) return;
          ring.forEach(([lng, lat], i) => { const X = px(lng), Y = py(lat); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
          ctx.closePath();
        });
        ctx.fillStyle = 'rgba(99,120,156,0.07)';
        ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(148,163,184,0.38)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
      });
      ctx.font = '8.5px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(166,179,200,0.6)';
      base.provinces.forEach((pr) => {
        const X = px(pr.c[0]), Y = py(pr.c[1]);
        if (X < padL || X > padL + plotW || Y < padT || Y > padT + plotH) return;
        ctx.fillText(pr.n, X, Y);
      });
    }

    // ---- 经纬网格（淡） ----
    ctx.strokeStyle = 'rgba(138,151,173,0.10)';
    ctx.fillStyle = 'rgba(138,151,173,0.72)';
    ctx.font = '9.5px sans-serif';
    const grids = 5;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= grids; i++) {
      const lng = xmin + (xmax - xmin) * i / grids;
      const X = padL + plotW * i / grids;
      ctx.beginPath(); ctx.moveTo(X, padT); ctx.lineTo(X, padT + plotH); ctx.stroke();
      ctx.fillText(lng.toFixed(0) + '°E', X, padT + plotH + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= grids; i++) {
      const lat = latOf(ymin + (ymax - ymin) * i / grids);
      const Y = padT + plotH * i / grids;
      ctx.beginPath(); ctx.moveTo(padL, Y); ctx.lineTo(padL + plotW, Y); ctx.stroke();
      ctx.fillText(lat.toFixed(0) + '°N', padL - 7, Y);
    }

    // ---- 南海诸岛 inset ----
    if (base && base.south && base.south.length) {
      let sxmin = Infinity, sxmax = -Infinity, symin = Infinity, symax = -Infinity;
      for (const ring of base.south) for (const [lng, lat] of ring) {
        if (lng < sxmin) sxmin = lng; if (lng > sxmax) sxmax = lng;
        if (lat < symin) symin = lat; if (lat > symax) symax = lat;
      }
      const sw = Math.max(58, Math.min(92, plotW * 0.24));
      const sar = (sxmax === sxmin) ? 1 : (sxmax - sxmin) / Math.max(0.001, symax - symin);
      const sh = Math.max(30, Math.min(sw / sar, plotH * 0.36));
      const sx = padL + plotW - sw - 4, sy = padT + plotH - sh - 4;
      const spx = (lng) => sx + (lng - sxmin) / (sxmax - sxmin) * sw;
      const spy = (lat) => sy + sh - (lat - symin) / (symax - symin) * sh;
      ctx.fillStyle = 'rgba(11,20,32,0.88)';
      ctx.fillRect(sx - 3, sy - 3, sw + 6, sh + 6);
      ctx.strokeStyle = 'rgba(120,140,172,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(sx - 3, sy - 3, sw + 6, sh + 6);
      ctx.fillStyle = 'rgba(136,186,238,0.34)';
      for (const ring of base.south) {
        ctx.beginPath();
        ring.forEach(([lng, lat], i) => { const X = spx(lng), Y = spy(lat); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 0.6;
      for (const ring of base.south) {
        ctx.beginPath();
        ring.forEach(([lng, lat], i) => { const X = spx(lng), Y = spy(lat); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
        ctx.closePath(); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(203,213,225,0.85)';
      ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('南海诸岛', sx + sw / 2, sy - 5);
    }

    // ---- 城市/气泡层 ----
    const rmax = Math.max(8, Math.min(32, Math.sqrt(plotW * plotH) / 14));
    const rmin = 2.5;
    const hits = [];
    series.forEach((s) => {
      s.points.forEach((p) => {
        const t = vmax > 0 ? (p.v || 0) / vmax : 0;
        const r = rmin + Math.sqrt(t) * (rmax - rmin);
        const cx = px(p.x), cy = py(p.y);
        ctx.fillStyle = s.color; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
        ctx.stroke();
        if (p.lab) {
          ctx.fillStyle = 'rgba(228,236,248,0.88)';
          ctx.font = '8.5px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(String(p.lab), cx, cy - r - 2);
        }
        hits.push({ x: cx - r - 2, y: cy - r - 7, w: r * 2 + 4, h: r * 2 + 10, text: s.name + ' · ' + (p.lab || '') + '：' + fmt(p.v || 0) });
      });
    });
    if (series.length > 1) drawLegend(ctx, w, series);
    bindHover(canvas, hits);
  }

  return { bar, barH, histogram, boxplot, heatmap, pie, line, area, barGrouped, barStacked, scatter, boxGroups, geoBubble, COLORS, fmt };
})();