// 简单的 JSON 文件存储：原子写入（先写临时文件再改名），写坏了也能从备份恢复。
// 阶段 1 后半段换成 SQLite + 向量检索；接口保持 load/save 不变。

const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) {
    return path.join(this.dir, name + '.json');
  }

  load(name, fallback) {
    for (const f of [this.file(name), this.file(name) + '.bak']) {
      try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        /* 试下一个 */
      }
    }
    return typeof fallback === 'function' ? fallback() : structuredClone(fallback);
  }

  save(name, data) {
    const f = this.file(name);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
    fs.renameSync(tmp, f);
  }
}

module.exports = { JsonStore };
