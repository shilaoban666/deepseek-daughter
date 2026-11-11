// 把 dsh-pet（PC2005-cloud/dsh-pet）的鲸鱼娘动画导入到 assets/pet/whale-girl/clips/。
//
//   node scripts/import-dsh-pet.mjs [dsh-pet 的安装目录]
//
// 默认读 ~/.dsh/profiles/desktop/node_modules/dsh-pet。只读源目录，不写入、不修改。
// 素材条款：代码 MIT；素材禁止商用；二创在公开渠道须署名。详见 assets/pet/whale-girl/LICENSE-ATTRIBUTION.md。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(process.argv[2] || path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
const dest = path.join(root, 'assets', 'pet', 'whale-girl');
const clipsDir = path.join(dest, 'clips');

const fail = (msg) => {
  console.error(`导入失败：${msg}`);
  process.exit(1);
};

const pkgFile = path.join(src, 'package.json');
if (!fs.existsSync(pkgFile)) fail(`找不到 ${pkgFile}`);
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
if (pkg.name !== 'dsh-pet') fail(`这不是 dsh-pet（package.json 的 name 是 ${pkg.name}）`);
if (!/PC2005-cloud\/dsh-pet/.test(pkg.repository?.url || '')) fail(`仓库地址不是 PC2005-cloud/dsh-pet：${pkg.repository?.url}`);
const readme = fs.readFileSync(path.join(src, 'README.md'), 'utf8');
if (!/素材禁止商用/.test(readme)) fail('README 里没找到素材条款“素材禁止商用”，条款可能变了，请先人工核对');

const webm = path.join(src, 'assets', 'webm');
const files = fs.readdirSync(webm).filter((f) => f.endsWith('.webm')).sort();
if (!files.length) fail(`${webm} 里没有 .webm`);

fs.mkdirSync(clipsDir, { recursive: true });
for (const old of fs.readdirSync(clipsDir)) if (old.endsWith('.webm') && !files.includes(old)) fs.unlinkSync(path.join(clipsDir, old));
const lines = [];
let bytes = 0;
for (const f of files) {
  const buf = fs.readFileSync(path.join(webm, f));
  fs.writeFileSync(path.join(clipsDir, f), buf);
  lines.push(`${createHash('sha256').update(buf).digest('hex')}  ${f}`);
  bytes += buf.length;
}
fs.writeFileSync(path.join(dest, 'clips.sha256'), lines.join('\n') + '\n');
fs.writeFileSync(
  path.join(dest, 'source.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, repository: 'https://github.com/PC2005-cloud/dsh-pet', importedAt: new Date().toISOString().slice(0, 10), clips: files.length, bytes }, null, 2) + '\n',
);

// 和映射表核对：每段动画都要被用到，映射表里引用的每段都要存在
const manifestFile = path.join(dest, 'pet.json');
if (fs.existsSync(manifestFile)) {
  const { referencedClips } = await import('../src/renderer/pet/pet-director.mjs');
  const used = new Set(referencedClips(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))));
  const have = new Set(files.map((f) => f.replace(/\.webm$/, '')));
  const missing = [...used].filter((x) => !have.has(x));
  const unused = [...have].filter((x) => !used.has(x));
  if (missing.length) console.warn(`映射表引用了，但素材里没有：${missing.join('、')}`);
  if (unused.length) console.warn(`素材里有，但映射表没用到：${unused.join('、')}`);
}

console.log(`已导入 dsh-pet ${pkg.version} 的 ${files.length} 段动画，共 ${(bytes / 1048576).toFixed(1)} MB → ${path.relative(root, clipsDir)}`);
