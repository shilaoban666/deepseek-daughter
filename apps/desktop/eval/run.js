// 记忆召回评估（设计文档“测试与评估”）
//
// 用法：node eval/run.js [--strict]
// 读取 eval/dataset.json，写入记忆后逐题检索，计算 recall@5、MRR 和检索延迟。
// --strict 时 recall@5 低于 90% 或 p50 超过 200ms 会以非零码退出，方便放进 CI。

const fs = require('fs');
const path = require('path');
const memory = require('../src/main/memory');
const config = require('../src/main/config');

const DAY = 86400000;
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset.json'), 'utf8'));
const NOW = new Date(dataset.now).getTime();

const bank = new memory.MemoryBank({ now: () => NOW, config: config.get() });

for (const m of dataset.memories) {
  const d = new Date(NOW - (m.daysAgo || 0) * DAY);
  d.setHours(m.hour ?? 12, 0, 0, 0);
  bank.add({
    layer: m.layer,
    text: m.text,
    importance: m.importance ?? 0.5,
    at: d.getTime(),
    source: { kind: m.source || 'owner' },
  });
}

const results = [];
for (const item of dataset.questions) {
  const t0 = process.hrtime.bigint();
  const found = bank.search(item.q, { now: NOW, limit: 5 });
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  const texts = found.items.map((x) => x.text);
  const rank = texts.findIndex((t) => item.answers.includes(t)) + 1;
  results.push({ ...item, rank: rank || 0, ms, mode: found.mode, got: texts });
}

const hits = results.filter((r) => r.rank > 0).length;
const recall = hits / results.length;
const mrr = results.reduce((a, r) => a + (r.rank ? 1 / r.rank : 0), 0) / results.length;
const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;

console.log(`\n记忆召回评估 · ${results.length} 题 · ${bank.stats().active} 条记忆`);
console.log(`recall@5  ${(recall * 100).toFixed(1)}%  (${hits}/${results.length})   目标 ≥ 90%`);
console.log(`MRR       ${mrr.toFixed(3)}`);
console.log(`检索延迟  p50 ${p50.toFixed(2)}ms  p95 ${p95.toFixed(2)}ms   目标 p50 < 200ms`);

const byMode = results.reduce((a, r) => ((a[r.mode] = (a[r.mode] || 0) + 1), a), {});
console.log(`检索方式  ${Object.entries(byMode).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

const missed = results.filter((r) => !r.rank);
if (missed.length) {
  console.log('\n没召回的题：');
  for (const r of missed) console.log(`- ${r.q}\n  期望：${r.answers.join(' / ')}\n  实际：${r.got.slice(0, 3).join(' | ') || '（空）'}`);
}

const failed = recall < 0.9 || p50 >= 200;
if (process.argv.includes('--strict') && failed) {
  console.error('\n未达到验收标准。');
  process.exit(1);
}
