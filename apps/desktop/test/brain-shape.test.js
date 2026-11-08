// 3D 大脑的资源和形状：皮层数据要和元信息对得上，小脑网格必须封闭，否则界面上会破洞或错位。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cortexDir = path.join(__dirname, '..', 'assets', 'cortex');
const loadShape = () => import('../src/renderer/brain-shape.mjs');

function assertClosed(index, count) {
  const edges = new Set();
  for (let i = 0; i < index.length; i += 3) {
    for (const [a, b] of [[index[i], index[i + 1]], [index[i + 1], index[i + 2]], [index[i + 2], index[i]]]) {
      const key = a * count + b;
      assert.ok(!edges.has(key), `有向边重复：${a}-${b}`);
      edges.add(key);
    }
  }
  for (const key of edges) {
    const a = Math.floor(key / count), b = key % count;
    assert.ok(edges.has(b * count + a), `网格有破口：${a}-${b}`);
  }
}

test('皮层低模的长度和元信息一致，三角形下标不越界', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(cortexDir, 'metadata.json'), 'utf8'));
  for (const side of ['lh', 'rh']) {
    const b = fs.readFileSync(path.join(cortexDir, `${side}.lod.bin`));
    const m = meta.lod[side];
    assert.deepStrictEqual([b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8), b.readUInt32LE(12)], [m.vertices, m.triangles, m.points, m.strandVertices]);
    assert.strictEqual(b.length, 16 + m.vertices * 24 + m.triangles * 12 + m.points * 24 + m.strandVertices * 20, side);
    assert.strictEqual(m.strandVertices % 2, 0, '纤维是线段对');
    const start = 16 + m.vertices * 24;
    for (let i = 0; i < m.triangles * 3; i += 97) assert.ok(b.readUInt32LE(start + i * 4) < m.vertices, side);
  }
});

test('皮层低模足够轻', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(cortexDir, 'metadata.json'), 'utf8'));
  for (const m of Object.values(meta.lod)) assert.ok(m.triangles < 100000, '遮挡网格太细会拖慢渲染');
});

test('皮层数据带着署名和许可', () => {
  const text = fs.readFileSync(path.join(cortexDir, 'LICENSE-ATTRIBUTION.md'), 'utf8');
  assert.match(text, /Anderson Winkler/);
  assert.match(text, /Attribution-ShareAlike 3\.0/);
  assert.match(text, /lod\.bin/, '要写明这里做过的改动');
  assert.ok(fs.existsSync(path.join(cortexDir, 'LICENSE-dafeiyu-3d-brain.txt')));
});

test('细分球封闭，顶点数和三角形数符合公式', async () => {
  const shape = await loadShape();
  const { index, count, dirs } = shape.icosphere(8);
  assert.strictEqual(count, 10 * 8 * 8 + 2);
  assert.strictEqual(index.length, 20 * 8 * 8 * 3);
  assertClosed(index, count);
  for (let i = 0; i < count; i++) {
    assert.ok(Math.abs(Math.hypot(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]) - 1) < 1e-5);
  }
});

test('小脑和脑干的网格没有非法顶点，下标不越界', async () => {
  const shape = await loadShape();
  for (const m of [shape.buildCerebellum(16), shape.buildBrainstem(24, 12)]) {
    assert.ok(m.position.every(Number.isFinite));
    assert.ok(m.fold.every((f) => f >= 0 && f <= 1));
    const count = m.position.length / 3;
    assert.ok(m.index.every((i) => i < count));
  }
  const { index, position } = shape.buildCerebellum(16);
  assertClosed(index, position.length / 3);
});
