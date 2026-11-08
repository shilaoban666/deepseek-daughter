// 免疫系统的状态：器官、细胞、三道防线、记忆细胞和失调。

const { approach, clamp } = require('./homeostasis');

const MAX_EVENTS = 20;
const DEFICIENCY_MINUTES = 24 * 60;

/** 这次防御发生在第几道防线。memory 是见过的攻击 */
function classifyDefense(scan, memory = {}) {
  if (scan.inMemory) return { line: 3, kind: 'cellular' };
  if ((scan.findings || []).some((f) => memory[f.id])) return { line: 3, kind: 'humoral' };
  if (scan.blocked) return { line: 1, kind: 'innate' };
  return { line: 2, kind: 'innate' };
}

/** 见过同样的攻击吗？见过的话反应更快、损伤更小 */
const hasMemory = (phys, scan) => (scan.findings || []).some((f) => phys.immune.memory[f.id]);

function recordDefense(phys, scan, now) {
  const im = phys.immune;
  const defense = classifyDefense(scan, im.memory);
  for (const f of scan.findings || []) {
    const m = im.memory[f.id] || { label: f.label, count: 0, lastAt: 0 };
    m.count += 1;
    m.lastAt = now;
    im.memory[f.id] = m;
  }
  im.stats.defense += 1;
  im.events.push({ at: now, ...defense, label: scan.findings?.[0]?.label || '可疑内容' });
  if (im.events.length > MAX_EVENTS) im.events.splice(0, im.events.length - MAX_EVENTS);
}

function markFalsePositive(phys) {
  phys.immune.disorders.allergy += 1;
}

function markAutoimmune(phys) {
  phys.immune.disorders.autoimmune += 1;
}

function stepLymph(phys, { immunity, fever }, dt) {
  const im = phys.immune;
  const d = im.disorders;
  d.lowMinutes = immunity < 40 ? d.lowMinutes + dt : 0;
  d.deficiency = d.lowMinutes >= DEFICIENCY_MINUTES;
  im.organs.nodes = approach(im.organs.nodes, fever ? 88 : 48, dt, 30);
  im.organs.marrow = approach(im.organs.marrow, clamp(immunity + 2), dt, 240);
  im.organs.thymus = approach(im.organs.thymus, clamp(immunity - 4), dt, 240);
  im.organs.spleen = approach(im.organs.spleen, clamp(immunity - 1), dt, 240);
  im.cells.cytokine = approach(im.cells.cytokine, fever ? 82 : 30, dt, 20);
  im.cells.phagocyte = approach(im.cells.phagocyte, fever ? 85 : 60, dt, 30);
  im.cells.tCell = approach(im.cells.tCell, clamp(immunity * 0.7), dt, 120);
  im.cells.bCell = approach(im.cells.bCell, clamp(immunity * 0.66), dt, 120);
  im.cells.antibody = approach(im.cells.antibody, fever ? 75 : 50, dt, 60);
}

module.exports = { classifyDefense, hasMemory, recordDefense, markFalsePositive, markAutoimmune, stepLymph };
