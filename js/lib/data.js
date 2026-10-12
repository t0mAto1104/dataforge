// data.js — 示例数据生成 + CSV 解析
window.DataGen = (function () {
  'use strict';

  // 可复现随机数（mulberry32）
  function prng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(rng) {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function gaussian(rng, mean, sigma) {
    return mean + sigma * randn(rng);
  }

  const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉'];
  const TIERS = ['普通', '白银', '黄金', '钻石'];

  const COLUMNS = [
    { key: 'id', label: '客户ID', type: 'number' },
    { key: 'age', label: '年龄', type: 'number' },
    { key: 'income', label: '月收入(元)', type: 'number' },
    { key: 'spend', label: '累计消费(元)', type: 'number' },
    { key: 'purchases', label: '购买次数', type: 'number' },
    { key: 'tenure', label: '注册时长(月)', type: 'number' },
    { key: 'satisfaction', label: '满意度(1-5)', type: 'number' },
    { key: 'city', label: '城市', type: 'category' },
    { key: 'tier', label: '会员等级', type: 'category' },
    { key: 'churned', label: '是否流失', type: 'category' }
  ];

  // 生成 240 行带缺失/异常/重复/类别不平衡的示例数据
  function sampleData(n) {
    n = n || 240;
    const rng = prng(20261010);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const age = Math.floor(gaussian(rng, 38, 12));
      const income = Math.max(1500, Math.round(gaussian(rng, 12000, 5500)));
      const purchases = Math.max(0, Math.round(gaussian(rng, 9, 4)));
      const tenure = Math.max(1, Math.round(gaussian(rng, 18, 10)));
      const spend = Math.max(0, Math.round(income * 0.12 + purchases * 180 + gaussian(rng, 0, 2000)));
      const satisfaction = Math.max(1, Math.min(5, Math.round(gaussian(rng, 3.6, 1.0))));
      const city = CITIES[Math.floor(rng() * CITIES.length)];
      // 会员等级与消费关联
      let tierIdx = 0;
      if (spend > 15000) tierIdx = 3;
      else if (spend > 8000) tierIdx = 2;
      else if (spend > 3500) tierIdx = 1;
      const tier = TIERS[tierIdx];
      // 类别不平衡：约 14% 流失
      let churned = rng() < 0.14 ? '是' : '否';
      if (satisfaction <= 2 && rng() < 0.5) churned = '是';

      rows.push({
        id: 1000 + i,
        age: Math.max(16, Math.min(75, age)),
        income, spend, purchases, tenure, satisfaction,
        city, tier, churned
      });
    }

    // 注入缺失（约 5%）
    for (const r of rows) {
      if (rng() < 0.05) r.income = null;
      if (rng() < 0.04) r.satisfaction = null;
      if (rng() < 0.03) r.city = null;
      if (rng() < 0.06) r.age = null;
    }
    // 注入异常值
    for (let k = 0; k < 6; k++) {
      const r = rows[Math.floor(rng() * n)];
      r.spend = Math.round(gaussian(rng, 0, 1) * 90000 + 90000);
    }
    for (let k = 0; k < 4; k++) {
      const r = rows[Math.floor(rng() * n)];
      r.income = 999999;
    }
    // 注入重复行
    for (let k = 0; k < 5; k++) {
      const src = rows[Math.floor(rng() * n)];
      rows.splice(Math.floor(rng() * n), 0, { ...src });
    }
    return rows;
  }

  // 解析 CSV 文本 -> { columns, rows }
  function parseCSV(text, hasHeader) {
    if (hasHeader === undefined) hasHeader = true;
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return null;

    const parseLine = (line) => {
      const out = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = false;
          } else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };

    const header = hasHeader ? parseLine(lines[0]) : Array.from({ length: parseLine(lines[0]).length }, (_, i) => 'col' + (i + 1));
    const startIdx = hasHeader ? 1 : 0;
    // 列名去重
    const seen = new Map();
    const columns = header.map((h) => {
      let key = (h || '').trim() || 'col';
      if (seen.has(key)) {
        const base = key;
        let i = seen.get(key) + 1;
        while (seen.has(base + '_' + i)) i++;
        key = base + '_' + i;
      }
      seen.set(key, 1);
      return { key, label: h || key };
    });

    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cells = parseLine(lines[i]);
      if (cells.length === 1 && cells[0].trim() === '') continue;
      const row = {};
      columns.forEach((c, idx) => {
        let raw = cells[idx];
        if (raw === undefined) raw = '';
        let v = raw.trim();
        if (v === '' || v.toLowerCase() === 'null' || v.toLowerCase() === 'na' || v.toLowerCase() === 'nan') v = null;
        else if (v !== '' && !isNaN(Number(v))) v = Number(v);
        row[c.key] = v;
      });
      rows.push(row);
    }
    return { columns: DataUtil.detectTypes(rows, columns), rows };
  }

  return { sampleData, parseCSV, COLUMNS, prng, gaussian, randn };
})();