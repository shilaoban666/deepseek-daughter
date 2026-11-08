// 配置中心：默认值在 config/default.json；用户可以在数据目录放一份 config.json 覆盖任意字段，
// 也可以用 DFY_CONFIG 指向别的文件。设计文档要求“所有参数写在配置文件里，方便社区调整”。

const fs = require('fs');
const path = require('path');

const DEFAULTS = require('../../config/default.json');

let current = null;

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** 深合并：数组整体替换，普通对象逐层合并，_comment 这类注释键跳过 */
function merge(base, extra) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(extra || {})) {
    if (k.startsWith('_')) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

/**
 * 载入配置。多次调用会覆盖上一次的结果。
 * @param {{dir?: string, overrides?: object, file?: string}} [opts]
 */
function init(opts = {}) {
  const file = opts.file || process.env.DFY_CONFIG || (opts.dir ? path.join(opts.dir, 'config.json') : '');
  let user = {};
  if (file) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[config] 读不了用户配置，用默认值：', err.message);
    }
  }
  current = merge(merge(structuredClone(DEFAULTS), user), opts.overrides || {});
  return current;
}

/** 取当前配置（没初始化就用默认值） */
function get() {
  return current || init();
}

/** 运行中临时改参数（设置页、调试面板用），立即对所有模块生效 */
function patch(partial) {
  current = merge(get(), partial || {});
  return current;
}

function reset() {
  current = null;
}

/** 给测试用：基于默认值做一份互不影响的深拷贝 */
function defaults() {
  return structuredClone(DEFAULTS);
}

module.exports = { init, get, patch, reset, defaults, merge };
