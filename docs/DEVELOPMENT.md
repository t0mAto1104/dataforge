# 开发说明

## 模块与加载顺序

`index.html` 依次加载 stats、data、geo、china-geo、charts、algo、app。库通过 `window` 暴露接口，`app.js` 使用闭包管理 UI 状态。运行时无需 npm 安装或构建。

| 全局对象 | 定义文件 | 职责 |
| --- | --- | --- |
| Stats / DataUtil | js/lib/stats.js | 描述统计、类型推断、维度与复制工具 |
| DataGen | js/lib/data.js | 合成示例数据、parseCSV(text, hasHeader) |
| GeoData / ChinaGeo | js/lib/geo.js / china-geo.js | 地点坐标与底图 |
| Charts | js/lib/charts.js | Canvas 绘图 |
| Algo | js/lib/algo.js | 数据画像、变换与增强 |

## 数据模型

行是以字段 key 为键的普通对象，值为字符串、数字或 null。列定义为 `{ key, label, type }`，type 为 number / category / text。类型由 DataUtil 推断。

作用列参数约定：`null` 表示所有列，`[]` 表示未选中任何列，字符串数组表示指定列。

## 操作管线

`PREPROCESS_OPS`、`CLEAN_OPS`、`AUGMENT_OPS` 声明操作卡片及参数；`renderOps` 创建控件，`readOpParams` 读取参数，`execPreprocess` / `execClean` / `execAugment` 调用算法。

新增操作：先在 Algo 实现算法，再在相应操作列表加入配置，最后补充 exec* 分支。保持输入不变，并遵循现有 rows 或 `{rows, columns}` 返回约定。

`runStageOps` 保存执行前快照，更新数据并添加历史。回滚恢复快照，并非删除中间步骤后重放。JSON 深拷贝不适用于 Date、循环引用或函数对象。

## 地图生成脚本

`node scripts/gen-china-geo.js <input.geojson> [output.js]` 从已有 GeoJSON 生成简化轮廓。输入数据需自行提供，格式应与源脚本使用的 DataV FeatureCollection 一致（含 name、adcode、center 属性）。默认输出到 `js/lib/china-geo.js`。该脚本不参与页面运行，仓库已包含生成结果。

## 本地检查

```bash
node --check js/app.js
python3 -m http.server 3030 --bind 127.0.0.1
```

在浏览器中检查示例数据、画像、字段货架、查询、清洗与 CSV 导出。变更算法时，以含缺失值、重复项和边界数值的小数据集核对结果。
