// 每日自动备份（设计文档 §7「每天自动备份」）
//
// 把数据目录里的 json 复制到 data/backups/<日期>/，只留最近 N 天。
// 备份不加密，跟着数据目录走；主人可以直接拷走整个目录换电脑。

const fs = require('fs');
const path = require('path');
const config = require('./config');

function dateKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class Backup {
  constructor({ dir, now = Date.now } = {}) {
    this.dir = dir;
    this.now = now;
    this.root = path.join(dir, 'backups');
  }

  /** 今天是否已经备份过 */
  hasToday() {
    return fs.existsSync(path.join(this.root, dateKey(this.now())));
  }

  /** 跑一次（同一天重复调用会跳过，除非 force） */
  run(force = false) {
    const cfg = config.get().backup;
    if (!cfg.enabled) return null;
    const day = dateKey(this.now());
    const dest = path.join(this.root, day);
    if (fs.existsSync(dest) && !force) return null;
    fs.mkdirSync(dest, { recursive: true });
    let copied = 0;
    for (const name of fs.readdirSync(this.dir)) {
      const src = path.join(this.dir, name);
      if (!name.endsWith('.json')) continue;
      const st = fs.statSync(src);
      if (!st.isFile()) continue;
      fs.copyFileSync(src, path.join(dest, name));
      copied += 1;
    }
    this.prune();
    return { day, dest, copied };
  }

  /** 只保留最近 keepDays 天 */
  prune() {
    const keep = config.get().backup.keepDays ?? 7;
    if (!fs.existsSync(this.root)) return 0;
    const days = fs
      .readdirSync(this.root)
      .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
      .sort();
    let removed = 0;
    for (const d of days.slice(0, Math.max(0, days.length - keep))) {
      fs.rmSync(path.join(this.root, d), { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  list() {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root)
      .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
      .sort()
      .reverse()
      .map((day) => {
        const p = path.join(this.root, day);
        const files = fs.readdirSync(p);
        return { day, files: files.length, bytes: files.reduce((a, f) => a + fs.statSync(path.join(p, f)).size, 0) };
      });
  }
}

module.exports = { Backup, dateKey };
