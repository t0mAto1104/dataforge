const fs = require('fs');
const path = require('path');
if (!process.argv[2]) {
  console.error('Usage: node scripts/gen-china-geo.js <input.geojson> [output.js]');
  process.exit(1);
}
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outputPath = process.argv[3] || path.join(__dirname, '../js/lib/china-geo.js');

const r2 = (n) => Math.round(n * 100) / 100;

// 将一个省的 geometry 转成 rings 数组（含所有 polygon 的所有 ring），并降采样 + 2位小数
function toRings(geometry, maxPtsPerRing) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const out = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const len = ring.length;
      if (len < 2) continue;
      const step = Math.max(1, Math.ceil(len / maxPtsPerRing));
      const sampled = [];
      for (let i = 0; i < len; i += step) sampled.push([r2(ring[i][0]), r2(ring[i][1])]);
      const last = sampled[sampled.length - 1];
      const first = sampled[0];
      if (last[0] !== first[0] || last[1] !== first[1]) sampled.push([first[0], first[1]]);
      out.push(sampled);
    }
  }
  return out;
}

const provinces = [];
let southChinaSea = [];
let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
const SOUTH_LAT = 17.5; // 南海岛礁纬度上限（海南本岛 ~18-20°N，三沙岛礁 <17.5°N）

function ringMidLat(ring) {
  let s = 0; for (const [, lat] of ring) s += lat; return s / ring.length;
}

for (const f of src.features) {
  const p = f.properties;
  if (String(p.adcode) === '100000_JD' || /南海|九段/i.test(p.name)) {
    southChinaSea = southChinaSea.concat(toRings(f.geometry, 120));
    continue;
  }
  const allRings = toRings(f.geometry, 180);
  const mainRings = [];
  for (const ring of allRings) {
    if (ringMidLat(ring) < SOUTH_LAT) continue; // 南海岛礁细节与 100000_JD 重复，丢弃
    mainRings.push(ring);
  }
  provinces.push({ n: p.name, c: [r2(p.center[0]), r2(p.center[1])], r: mainRings });
  for (const ring of mainRings) for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
}

const out = {
  provinces,
  south: southChinaSea,
  bounds: [Math.round(minLng * 100) / 100, Math.round(minLat * 100) / 100, Math.round(maxLng * 100) / 100, Math.round(maxLat * 100) / 100]
};

const js = '/* 中国省份边界轮廓（简化）— 数据源：阿里云 DataV.GeoAtlas areas_v3 100000_full.json */\n'
  + 'window.ChinaGeo = ' + JSON.stringify(out) + ';\n';

fs.writeFileSync(outputPath, js);
const size = Buffer.byteLength(js);
console.log('provinces:', provinces.length, 'southRings:', southChinaSea.length, 'bounds:', out.bounds, 'size:', size, 'bytes', (size / 1024).toFixed(1) + 'KB');

let pts = 0;
for (const pr of provinces) for (const ring of pr.r) pts += ring.length;
for (const ring of southChinaSea) pts += ring.length;
console.log('total points:', pts);