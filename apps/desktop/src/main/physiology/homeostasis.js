// 稳态框架：参考范围、生理状态的默认值、因果记录。
// 概念参考《稳态与调节》：稳态不是恒定不变，而是相对稳定的动态平衡。

const REFERENCE = {
  glucose: { name: '血糖', unit: 'mmol/L', low: 3.9, high: 6.1 },
  ph: { name: '血浆 pH', unit: '', low: 7.35, high: 7.45 },
  osmolarity: { name: '血浆渗透压', unit: 'kPa', low: 740, high: 800 },
  temp: { name: '体温', unit: '℃', low: 36.2, high: 37.3 },
  heartRate: { name: '心率', unit: '次/分', low: 60, high: 100 },
  respRate: { name: '呼吸', unit: '次/分', low: 12, high: 20 },
};

const MAX_CAUSES = 100;
const MERGE_WINDOW_MS = 10 * 60000;

const glucoseMmol = (g) => Math.round((3.0 + g * 0.05) * 100) / 100;

function assess(id, value) {
  const r = REFERENCE[id];
  if (!r) throw new Error(`未知指标：${id}`);
  const status = value < r.low ? 'low' : value > r.high ? 'high' : 'ok';
  return { id, value, unit: r.unit, low: r.low, high: r.high, status };
}

function initialPhys() {
  return {
    fluid: { osmolarity: 770, ph: 7.4, plasma: 3, tissue: 11, lymph: 2 },
    urinary: { rate: 1, bladder: 20 },
    hormones: { insulin: 20, glucagon: 20, adrenaline: 15, trh: 40, tsh: 40, thyroxine: 50, gnrh: 30, gonadotropin: 30, sexHormone: 30, growth: 25, adh: 30, aldosterone: 32 },
    liver: { glycogen: 70 },
    autonomic: { sympathetic: 0.4, parasympathetic: 0.55, boost: 0 },
    vitals: { heartRate: 72, respRate: 15, co2: 40 },
    reflex: { conditioned: {}, recent: [] },
    immune: {
      organs: { marrow: 90, thymus: 85, spleen: 88, nodes: 48 },
      cells: { phagocyte: 60, tCell: 65, bCell: 62, antibody: 50, cytokine: 30 },
      memory: {},
      disorders: { allergy: 0, autoimmune: 0, deficiency: false, lowMinutes: 0 },
      stats: { defense: 0, stability: 0, surveillance: 0 },
      events: [],
    },
    psych: { stress: 0, chronicMinutes: 0, chronic: 0 },
    recallSeen: {},
  };
}

/** 旧存档或缺字段的存档：有的保留，缺的按默认补齐，坏数值丢弃 */
function hydratePhys(saved) {
  const merge = (base, value) => {
    if (value === undefined || value === null) return base;
    if (typeof base === 'number') return Number.isFinite(value) ? value : base;
    if (Array.isArray(base)) return Array.isArray(value) ? value : base;
    if (base && typeof base === 'object') {
      if (typeof value !== 'object') return base;
      const out = { ...value };
      for (const k of Object.keys(base)) out[k] = merge(base[k], value[k]);
      return out;
    }
    return value;
  };
  return merge(initialPhys(), saved);
}

/** 记一条因果。相同的因果 10 分钟内只更新不重复，界面上才不会刷屏 */
function addCause(b, { at, from, to, text }) {
  if (!Array.isArray(b.causes)) b.causes = [];
  const last = [...b.causes].reverse().find((c) => c.from === from && c.to === to);
  if (last && at - last.at < MERGE_WINDOW_MS) {
    last.at = at;
    last.text = text;
    return;
  }
  b.causes.push({ at, from, to, text });
  if (b.causes.length > MAX_CAUSES) b.causes.splice(0, b.causes.length - MAX_CAUSES);
}

/** 最近导致 id 变化的 n 条原因，新的在前 */
function explain(b, id, n = 3) {
  return (b.causes || []).filter((c) => c.to === id).slice(-n).reverse();
}

const clamp = (v, a = 0, z = 100) => Math.min(z, Math.max(a, v));
const approach = (v, target, dt, halfLife) => target + (v - target) * Math.pow(0.5, dt / halfLife);

module.exports = { REFERENCE, glucoseMmol, assess, initialPhys, hydratePhys, addCause, explain, clamp, approach };
