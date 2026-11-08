// 记忆系统（设计文档 §7）
//
// 六层记忆：工作记忆（由最近情景推导）、情景、语义、程序、反思、自我叙事。
// 五路混合检索：向量相似度、关键词、实体、重要性、新鲜度；时间类问题直接按时间取。
// 遗忘按艾宾浩斯曲线衰减，只归档、不删除；重要性高的记忆受保护。
// 每条记忆都记来源和可信度，陌生人说的话不能覆盖主人说过的话。
//
// 这一层是对外稳定的接口：以后换成 SQLite + sqlite-vec，只要保持同样的方法签名。

const config = require('./config');

const DAY = 86400000;

/** 会写进库的五层（工作记忆不落盘，是当前对话 + 身体状态） */
const LAYERS = ['episodic', 'semantic', 'procedural', 'reflection', 'self'];
const LAYER_NAMES = {
  episodic: '情景记忆',
  semantic: '语义记忆',
  procedural: '程序记忆',
  reflection: '反思与道理',
  self: '自我叙事',
};
const SOURCE_KINDS = ['owner', 'self', 'system', 'content', 'platform', 'stranger'];
const SOURCE_NAMES = {
  owner: '主人说的',
  self: '我自己的经历',
  system: '系统记录',
  content: '书里/视频里看到的',
  platform: '平台上看到的',
  stranger: '陌生人说的',
};

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// ---------- 分词、向量、相似度 ----------
// 中文没有空格，用「字 + 相邻二字」当词项；英文和数字按单词切。
const CJK = /[\u4e00-\u9fff]/;

function tokens(text) {
  const s = norm(text).toLowerCase();
  const out = [];
  for (const word of s.match(/[a-z0-9_]+/g) || []) if (word.length > 1) out.push(word);
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const VEC_DIM = 256;

/** 特征哈希向量：没有配嵌入模型时的本地替代（同一个词落到同一个维度） */
function vectorOf(tokensList, idf, dim = VEC_DIM) {
  const v = new Float32Array(dim);
  for (const t of tokensList) {
    const w = idf ? idf(t) : 1;
    const h = hash(t);
    v[h % dim] += h & 1 ? w : -w;
  }
  let n = 0;
  for (let i = 0; i < dim; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

function cosine(a, b) {
  if (!a || !b) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return clamp(dot, 0, 1);
}

// ---------- 实体抽取 ----------
// 没有引入分词/NER 依赖，先用规则抓：书名号、引号、名字、喜好对象、英文专名。
const ENTITY_STOP = new Set([
  '我们', '自己', '东西', '这个', '那个', '什么', '时候', '今天', '昨天', '现在', '可以', '知道', '觉得', '喜欢', '讨厌', '一个', '有点', '真的', '已经', '还是', '就是', '因为', '所以',
]);

function extractEntities(text) {
  const s = norm(text);
  const out = [];
  const push = (x) => {
    const v = norm(x).replace(/[，。！？、,.!?"'“”‘’]/g, '');
    if (v && v.length >= 2 && v.length <= 12 && !ENTITY_STOP.has(v) && !/^\d+$/.test(v)) out.push(v);
  };
  // 每类线索单独扫一遍，避免一条规则把另一条的词吃掉
  for (const m of s.matchAll(/《([^》]{1,24})》/g)) push(m[1]);
  for (const m of s.matchAll(/[“「]([^”」]{1,20})[”」]/g)) push(m[1]);
  for (const m of s.matchAll(/(?:叫|名叫|昵称是|名字是)([\u4e00-\u9fffA-Za-z0-9]{1,10})/g)) push(m[1]);
  for (const m of s.matchAll(/(?:住在|养了|养的|喜欢|讨厌|爱吃|在读|在看|在玩)([\u4e00-\u9fffA-Za-z0-9]{2,10})/g)) push(m[1]);
  for (const m of s.matchAll(/\b([A-Z][a-zA-Z0-9]{1,15})\b/g)) push(m[1]);
  return uniq(out).slice(0, 8);
}

// ---------- 时间类问题 ----------
const PERIODS = [
  { re: /凌晨/, from: 0, to: 5 },
  { re: /早上|早晨|上午/, from: 5, to: 11 },
  { re: /中午|午间/, from: 11, to: 13 },
  { re: /下午/, from: 13, to: 18 },
  { re: /傍晚|晚上/, from: 18, to: 23 },
  { re: /夜里|半夜|深夜/, from: 22, to: 24 },
];
const RECALL_HINT = /(记得|说过|聊过|讲过|做过|干嘛|干什么|什么|哪|那次|那时候|之前|上次|时候|发生)/;
// 整句就是一个时间词（“昨天”“早上呢”），也算时间查询
const PURE_TIME = /^(今天|昨天|前天|昨晚|今早|刚才|刚刚|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|上周|上个月|这周|最近)(呢|啊|吗|呀|的事|的事情)?$/;
// 在问习惯或规律，不是问某段时间发生过什么
const HABIT = /(会|通常|一般|平时|每天|习惯|总是|经常|往常)/;

/**
 * 识别“昨天”“早上”“三天前”这类时间问题。
 * 只在这句话看起来是在问过去的事时才返回区间，避免“我今天有点累”被当成时间查询。
 * @returns {{from:number,to:number,label:string}|null}
 */
function parseTimeQuery(query, now = Date.now()) {
  const q = norm(query);
  if (!q) return null;
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = DAY;

  let dayBase = null;
  let label = '';
  const mDays = q.match(/(\d+)\s*天前/);
  if (mDays) {
    const n = Math.max(1, Number(mDays[1]));
    dayBase = today - n * dayMs;
    label = `${n} 天前`;
  } else if (/前天/.test(q)) {
    dayBase = today - 2 * dayMs;
    label = '前天';
  } else if (/昨天|昨晚|昨日/.test(q)) {
    dayBase = today - dayMs;
    label = '昨天';
  } else if (/今天|今日|刚才|刚刚|这会儿|今晚/.test(q)) {
    dayBase = today;
    label = '今天';
  } else if (/上周|上个星期/.test(q)) {
    const back = (d.getDay() + 6) % 7; // 本周一是几天前
    const monday = today - back * dayMs;
    return { from: monday - 7 * dayMs, to: monday, label: '上周' };
  } else if (/上个月|上月/.test(q)) {
    const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    return { from: prev, to: first, label: '上个月' };
  } else if (/这周|本周|这个星期/.test(q)) {
    const back = (d.getDay() + 6) % 7;
    return { from: today - back * dayMs, to: now, label: '这周' };
  }

  const period = PERIODS.find((p) => p.re.test(q));
  if (dayBase === null && !period) return null;
  if (HABIT.test(q)) return null; // “你早上一般会做什么”在问习惯，按语义检索
  // “我今天有点累”这类不是在问过去，只是带了时间词；要求它有回忆的语气，或者整句就是个时间词
  const asking = RECALL_HINT.test(q) || PURE_TIME.test(q);
  if (!asking) return null;
  if (period && !RECALL_HINT.test(q) && q.length > 8) return null;

  const base = dayBase === null ? today : dayBase;
  if (period) {
    return { from: base + period.from * 3600000, to: base + period.to * 3600000, label: `${label}${q.match(period.re)[0]}` };
  }
  return { from: base, to: base + dayMs, label: label || '今天' };
}

// ---------- 记忆库 ----------
class MemoryBank {
  /**
   * @param {{config?: object, now?: () => number, embedder?: (text:string)=>Float32Array|null}} [opts]
   */
  constructor(opts = {}) {
    this.cfg = (opts.config || config.get()).memory;
    this.now = opts.now || Date.now;
    this.records = [];
    this.conflicts = [];
    this.embedder = opts.embedder || null;
    this.seq = 0;
    this._tokens = new Map();
    this._vecs = new Map();
    this._idf = null;
    this._embeddings = new Map();
  }

  get maxRecords() {
    return this.cfg.maxRecords || 5000;
  }

  credibility(kind) {
    return this.cfg.credibility?.[kind] ?? 0.5;
  }

  /** 不同层的默认重要性：越核心的层，写进去越难，也越不容易忘 */
  defaultImportance(layer) {
    return { episodic: 0.3, semantic: 0.55, procedural: 0.5, reflection: 0.65, self: 0.9 }[layer] ?? 0.4;
  }

  nextId(now = this.now()) {
    this.seq += 1;
    return `${now.toString(36)}-${this.seq.toString(36)}`;
  }

  // ----- 读写 -----
  load(data) {
    const list = Array.isArray(data) ? data : data?.records;
    this.records = (Array.isArray(list) ? list : []).map((r) => this.normalize(r)).filter(Boolean);
    this.conflicts = Array.isArray(data?.conflicts) ? data.conflicts.map((c) => ({ ...c })) : [];
    this._invalidate();
    return this;
  }

  /** 兼容旧版本存下来的 facts（{id,text,importance,createdAt}） */
  normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = norm(raw.text || raw.content);
    if (!text) return null;
    if (raw.layer && LAYERS.includes(raw.layer)) {
      const at = num(raw.at, num(raw.createdAt, this.now()));
      return {
        id: raw.id || this.nextId(at),
        layer: raw.layer,
        text,
        at,
        createdAt: num(raw.createdAt, at),
        updatedAt: num(raw.updatedAt, at),
        source: { kind: raw.source?.kind || 'system', who: raw.source?.who || '', credibility: num(raw.source?.credibility, this.credibility(raw.source?.kind || 'system')) },
        importance: clamp(num(raw.importance, 0.4)),
        emotion: raw.emotion || null,
        entities: uniq((raw.entities || extractEntities(text)).map(norm).filter(Boolean)).slice(0, 12),
        tags: uniq((raw.tags || []).map(norm).filter(Boolean)),
        recallCount: num(raw.recallCount, 0),
        lastRecallAt: num(raw.lastRecallAt, 0),
        lastDecayAt: num(raw.lastDecayAt, at),
        strength: clamp(num(raw.strength, 1)),
        validFrom: num(raw.validFrom, at),
        validUntil: raw.validUntil == null ? null : num(raw.validUntil, null),
        archived: !!raw.archived,
        archivedAt: num(raw.archivedAt, 0),
        conflict: !!raw.conflict,
        provisional: !!raw.provisional,
        links: Array.isArray(raw.links) ? raw.links : [],
        meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
      };
    }
    // 旧 facts
    const importance = clamp(num(raw.importance, 2) / 5);
    return this.normalize({
      id: raw.id,
      layer: 'semantic',
      text,
      at: num(raw.createdAt, this.now()),
      source: { kind: 'owner', who: '', credibility: this.credibility('owner') },
      importance,
      entities: extractEntities(text),
    });
  }

  toJSON() {
    return this.records.map((r) => ({ ...r }));
  }

  /** 落盘用的完整快照：记忆 + 还没处理的矛盾 */
  export() {
    return { records: this.toJSON(), conflicts: this.conflicts.map((c) => ({ ...c })) };
  }

  /** 新记忆进库。返回 {record, action, conflict}，action: new / merged / conflict / provisional */
  add(input = {}) {
    const now = this.now();
    const text = norm(input.text);
    if (!text) return { record: null, action: 'empty', conflict: null };
    const layer = LAYERS.includes(input.layer) ? input.layer : 'episodic';
    const kind = SOURCE_KINDS.includes(input.source?.kind) ? input.source.kind : 'self';
    const source = {
      kind,
      who: norm(input.source?.who || ''),
      credibility: clamp(num(input.source?.credibility, this.credibility(kind))),
    };

    const rec = {
      id: input.id || this.nextId(now),
      layer,
      text,
      at: num(input.at, now),
      createdAt: now,
      updatedAt: now,
      source,
      importance: clamp(num(input.importance, this.defaultImportance(layer))),
      emotion: input.emotion && typeof input.emotion === 'object' ? { P: num(input.emotion.P), A: num(input.emotion.A), D: num(input.emotion.D) } : null,
      entities: uniq((input.entities?.length ? input.entities : extractEntities(text)).map(norm).filter(Boolean)).slice(0, 12),
      tags: uniq((input.tags || []).map(norm).filter(Boolean)),
      recallCount: 0,
      lastRecallAt: 0,
      lastDecayAt: Math.min(now, num(input.at, now)), // 补录很久以前的事，强度从那时候开始衰减
      strength: 1,
      validFrom: num(input.validFrom, num(input.at, now)),
      validUntil: input.validUntil == null ? null : num(input.validUntil, null),
      archived: false,
      archivedAt: 0,
      conflict: false,
      provisional: false,
      links: Array.isArray(input.links) ? input.links : [],
      meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    };

    const dup = this.findSimilar(rec, this.cfg.duplicateSimilarity || 0.92);
    if (dup) return { record: this.mergeInto(dup, rec), action: 'merged', conflict: null };

    const similar = this.findSimilarAll(rec, this.cfg.conflictSimilarity ?? 0.6);
    const conflicts = similar.filter((r) => contradiction(r, rec));

    if (conflicts.length) {
      const ownerConflicts = conflicts.filter((c) => c.source.kind === 'owner');
      const protectedByOwner = ownerConflicts.length && source.credibility < (this.cfg.ownerCredibilityFloor ?? 0.8);
      rec.conflict = true;
      rec.provisional = protectedByOwner;
      rec.links.push(...conflicts.map((c) => ({ to: c.id, type: 'contradicts' })));
      for (const c of conflicts) {
        c.links.push({ to: rec.id, type: 'contradicts' });
        c.conflict = true;
      }
      this.conflicts.push({
        id: rec.id,
        with: conflicts[0].id,
        texts: [rec.text, conflicts[0].text],
        at: now,
        provisional: protectedByOwner,
        asked: false,
      });
      this.push(rec);
      return { record: rec, action: protectedByOwner ? 'provisional' : 'conflict', conflict: conflicts[0] };
    }

    this.push(rec);
    return { record: rec, action: 'new', conflict: null };
  }

  push(rec) {
    this.records.push(rec);
    this._invalidate();
    if (this.records.length > this.maxRecords) this.trim();
  }

  /** 超出上限时，归档最旧的、最不重要的、没被保护的记忆（不删除） */
  trim() {
    const excess = this.records.length - this.maxRecords;
    if (excess <= 0) return 0;
    const victims = this.records
      .filter((r) => !r.archived && r.importance < (this.cfg.decay?.protectImportance ?? 0.7))
      .sort((a, b) => a.strength - b.strength || a.at - b.at)
      .slice(0, excess);
    for (const r of victims) {
      r.archived = true;
      r.archivedAt = this.now();
      r.meta = { ...r.meta, archivedBy: 'cap' };
    }
    return victims.length;
  }

  get(id) {
    return this.records.find((r) => r.id === id) || null;
  }

  update(id, patch = {}) {
    const r = this.get(id);
    if (!r) return null;
    if (typeof patch.text === 'string' && norm(patch.text)) r.text = norm(patch.text);
    if (patch.importance != null) r.importance = clamp(num(patch.importance, r.importance));
    if (patch.entities) r.entities = uniq(patch.entities.map(norm).filter(Boolean)).slice(0, 12);
    if (patch.source?.kind) r.source = { kind: patch.source.kind, who: norm(patch.source.who ?? r.source.who), credibility: clamp(num(patch.source.credibility, this.credibility(patch.source.kind))) };
    if (patch.validUntil !== undefined) r.validUntil = patch.validUntil == null ? null : num(patch.validUntil, null);
    if (patch.archived !== undefined) {
      r.archived = !!patch.archived;
      r.archivedAt = r.archived ? this.now() : 0;
    }
    r.updatedAt = this.now();
    this._invalidate();
    return r;
  }

  /** 只有主人能真正删除；别忘了“遗忘”只是归档 */
  remove(id) {
    const i = this.records.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.records.splice(i, 1);
    this.conflicts = this.conflicts.filter((c) => c.id !== id && c.with !== id);
    this._invalidate();
    return true;
  }

  archive(id) {
    return this.update(id, { archived: true });
  }

  restore(id) {
    const r = this.get(id);
    if (!r) return null;
    r.archived = false;
    r.archivedAt = 0;
    r.strength = Math.max(r.strength, 0.2);
    r.lastDecayAt = this.now();
    this._invalidate();
    return r;
  }

  byLayer(layer, { includeArchived = false } = {}) {
    return this.records.filter((r) => r.layer === layer && (includeArchived || !r.archived));
  }

  active(now = this.now()) {
    return this.records.filter((r) => !r.archived && !expired(r, now));
  }

  /** 工作记忆：最近的情景记忆（配上当前对话就是她“脑子里”的东西） */
  working(limit = this.cfg.workingLimit || 24, now = this.now()) {
    return this.byLayer('episodic')
      .filter((r) => !expired(r, now))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }

  between(from, to, opts = {}) {
    return this.active()
      .filter((r) => r.at >= from && r.at <= to && (!opts.layer || r.layer === opts.layer))
      .sort((a, b) => a.at - b.at);
  }

  // ----- 检索 -----
  /** 索引：idf + 每个记录的词项和向量缓存 */
  index() {
    if (this._idf) return this._idf;
    const df = new Map();
    let n = 0;
    for (const r of this.records) {
      if (r.archived) continue;
      n += 1;
      for (const t of new Set(this.tokensOf(r))) df.set(t, (df.get(t) || 0) + 1);
    }
    const idf = (t) => Math.log(1 + (n + 1) / ((df.get(t) || 0) + 0.5));
    this._idf = { df, n, idf };
    return this._idf;
  }

  tokensOf(r) {
    let t = this._tokens.get(r.id + r.text.length + ':' + r.text);
    if (!t) {
      t = tokens(r.text);
      this._tokens.set(r.id + r.text.length + ':' + r.text, t);
    }
    return t;
  }

  vectorOf(r) {
    const key = r.id + ':' + r.text;
    let v = this._vecs.get(key);
    if (!v) {
      v = this.embedder ? this.embedder(r.text) : null;
      if (!v) v = vectorOf(this.tokensOf(r), this.index().idf);
      this._vecs.set(key, v);
    }
    return v;
  }

  _invalidate() {
    this._idf = null;
    this._tokens.clear();
    this._vecs.clear();
  }

  setEmbedder(fn) {
    this.embedder = fn || null;
    this._vecs.clear();
    return this;
  }

  similarity(a, b) {
    return cosine(vectorOf(tokens(a)), vectorOf(tokens(b)));
  }

  findSimilarAll(rec, threshold) {
    const out = [];
    for (const r of this.records) {
      if (r.archived || r.layer !== rec.layer || r.id === rec.id) continue;
      const sim = this.similarity(r.text, rec.text);
      if (sim >= threshold) out.push({ r, sim });
    }
    return out.sort((a, b) => b.sim - a.sim).map((x) => x.r);
  }

  findSimilar(rec, threshold) {
    return this.findSimilarAll(rec, threshold)[0] || null;
  }

  mergeInto(existing, incoming) {
    const now = this.now();
    const better = incoming.source.credibility > existing.source.credibility + 0.05;
    if (better && existing.source.kind !== 'owner') {
      existing.text = incoming.text;
      existing.source = incoming.source;
      existing.entities = uniq([...existing.entities, ...incoming.entities]).slice(0, 12);
    }
    existing.importance = Math.max(existing.importance, incoming.importance);
    existing.strength = clamp(existing.strength + 0.08);
    existing.recallCount += 1;
    existing.lastRecallAt = now;
    existing.lastDecayAt = now;
    existing.tags = uniq([...existing.tags, ...incoming.tags]);
    existing.meta = { ...existing.meta, ...incoming.meta };
    existing.updatedAt = now;
    this._invalidate();
    return existing;
  }

  /**
   * 五路混合检索。
   * @param {string} query
   * @param {{limit?:number, layer?:string, timeRange?:object|null, now?:number, includeArchived?:boolean}} [opts]
   * @returns {{items:Array, mode:string, range:object|null, confidence:number, confident:boolean}}
   */
  search(query, opts = {}) {
    const now = opts.now ?? this.now();
    const q = norm(query);
    const cfg = this.cfg;
    const limit = Math.max(1, opts.limit ?? cfg.retrievalLimit ?? 12);
    let pool = this.records.filter((r) => (opts.includeArchived || !r.archived) && !expired(r, now));
    if (opts.layer) pool = pool.filter((r) => r.layer === opts.layer);

    const range = opts.timeRange === undefined ? parseTimeQuery(q, now) : opts.timeRange;
    if (range) {
      const items = pool
        .filter((r) => r.at >= range.from && r.at <= range.to)
        .sort((a, b) => b.at - a.at || b.importance - a.importance)
        .slice(0, limit)
        .map((r) => ({ ...r, score: 1, parts: { time: 1 } }));
      return { items, mode: 'time', range, confidence: items.length ? 1 : 0, confident: items.length > 0 };
    }

    if (!q) {
      const items = pool
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((r) => ({ ...r, score: 0, parts: {} }));
      return { items, mode: 'recent', range: null, confidence: items.length ? 0.5 : 0, confident: items.length > 0 };
    }

    const { idf } = this.index();
    const w = cfg.weights || {};
    const wv = num(w.vector, 0.3);
    const wk = num(w.keyword, 0.25);
    const we = num(w.entity, 0.15);
    const wi = num(w.importance, 0.2);
    const wf = num(w.freshness, 0.1);
    const halfLife = cfg.freshnessHalfLifeDays || 14;

    const qTokens = uniq(tokens(q));
    const qVec = vectorOf(qTokens, idf);
    const qEntities = extractEntities(q);
    const qSet = new Set(qTokens);
    let qIdfSum = 0;
    for (const t of qSet) qIdfSum += idf(t);

    const scored = [];
    for (const r of pool) {
      const rTokens = this.tokensOf(r);
      const rSet = new Set(rTokens);
      const sim = cosine(qVec, this.vectorOf(r));
      let hit = 0;
      for (const t of qSet) if (rSet.has(t)) hit += idf(t);
      const kw = qIdfSum ? hit / qIdfSum : 0;
      let ent = 0;
      // 实体这一路两边都算：问题里的实体命中记录，或者记录里的实体出现在问题里
      if (r.entities.length) {
        const hit = r.entities.filter((e) => q.includes(e)).length;
        ent = Math.max(ent, Math.min(1, hit / Math.min(r.entities.length, 3)));
      }
      if (qEntities.length) {
        let matched = 0;
        for (const e of qEntities) if (r.entities.some((x) => x === e || x.includes(e) || e.includes(x))) matched += 1;
        ent = Math.max(ent, matched / qEntities.length);
      }
      ent = clamp(ent);
      const imp = clamp(r.importance);
      const ageDays = Math.max(0, (now - r.at) / DAY);
      const fresh = Math.exp(-ageDays / halfLife);
      // 重要性、新鲜度只用来加权排序；一条完全不相关的内容不该靠它们混进结果
      if (sim + kw + ent <= 0.001) continue;
      let score = wv * sim + wk * kw + we * ent + wi * imp + wf * fresh;
      score *= 0.7 + 0.3 * r.source.credibility;
      if (r.provisional) score *= 0.85;
      if (score > 0.01) scored.push({ ...r, score, parts: { vector: sim, keyword: kw, entity: ent, importance: imp, freshness: fresh } });
    }
    scored.sort((a, b) => b.score - a.score || b.at - a.at);
    const items = scored.slice(0, limit);
    const confidence = items.length ? items[0].score : 0;
    const floor = cfg.confidenceFloor ?? 0.18;
    return { items, mode: 'semantic', range: null, confidence, confident: confidence >= floor };
  }

  /** 被回忆一次就加强一次（艾宾浩斯曲线的“复习”） */
  recall(ids = []) {
    const now = this.now();
    for (const id of ids) {
      const r = this.get(id);
      if (!r) continue;
      r.recallCount += 1;
      r.lastRecallAt = now;
      r.lastDecayAt = now;
      r.strength = clamp(Math.max(r.strength, 0.15) * 1.15 + 0.05);
    }
    return ids.length;
  }

  /** 遗忘：按经过的时间衰减强度，低于阈值就归档（原文保留，可以恢复） */
  decay(now = this.now()) {
    const cfg = this.cfg.decay || {};
    const base = cfg.baseStabilityDays ?? 30;
    const boost = cfg.recallBoost ?? 0.9;
    const threshold = cfg.archiveThreshold ?? 0.08;
    const protect = cfg.protectImportance ?? 0.7;
    let archived = 0;
    for (const r of this.records) {
      if (r.archived) continue;
      const from = r.lastDecayAt || r.at;
      const days = (now - from) / DAY;
      if (days <= 0.01) continue;
      const stability = base * (0.6 + r.importance) * (1 + r.recallCount * boost);
      r.strength = clamp(r.strength * Math.exp(-days / stability));
      r.lastDecayAt = now;
      if (r.strength < threshold && r.importance < protect) {
        r.archived = true;
        r.archivedAt = now;
        r.meta = { ...r.meta, archivedBy: 'decay' };
        archived += 1;
      }
    }
    return archived;
  }

  /** 合并相似记忆：同一件事说了一百遍，只留一条更完整的 */
  mergeSimilar(now = this.now()) {
    const threshold = this.cfg.mergeSimilarity ?? 0.86;
    let merged = 0;
    for (const layer of LAYERS) {
      const list = this.byLayer(layer).slice().sort((a, b) => b.importance - a.importance || a.at - b.at);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.archived) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (b.archived || contradiction(a, b)) continue;
          if (this.similarity(a.text, b.text) < threshold) continue;
          const keep = a.source.credibility >= b.source.credibility ? a : b;
          const drop = keep === a ? b : a;
          keep.importance = Math.max(keep.importance, drop.importance);
          keep.recallCount += drop.recallCount;
          keep.strength = clamp(Math.max(keep.strength, drop.strength) + 0.05);
          keep.entities = uniq([...keep.entities, ...drop.entities]).slice(0, 12);
          keep.tags = uniq([...keep.tags, ...drop.tags]);
          drop.archived = true;
          drop.archivedAt = now;
          drop.meta = { ...drop.meta, archivedBy: 'merge', mergedInto: keep.id };
          merged += 1;
        }
      }
    }
    return merged;
  }

  /** 主人处理一条矛盾：留下 keepId 那条，另一条标记为已被纠正 */
  resolveConflict(recordId, keepId) {
    const c = this.conflicts.find((x) => x.id === recordId || x.with === recordId);
    if (!c) return false;
    const dropId = keepId === c.id ? c.with : c.id;
    const drop = this.get(dropId);
    if (drop) {
      drop.conflict = false;
      drop.provisional = false;
      drop.meta = { ...drop.meta, resolved: 'superseded', supersededBy: keepId, resolvedAt: this.now() };
      drop.archived = true;
      drop.archivedAt = this.now();
      drop.strength = 0;
    }
    const keep = this.get(keepId);
    if (keep) {
      keep.conflict = false;
      keep.importance = clamp(Math.max(keep.importance, 0.7));
    }
    this.conflicts = this.conflicts.filter((x) => x !== c);
    this._invalidate();
    return true;
  }

  stats(now = this.now()) {
    const per = {};
    for (const layer of LAYERS) {
      const all = this.records.filter((r) => r.layer === layer);
      per[layer] = { name: LAYER_NAMES[layer], active: all.filter((r) => !r.archived).length, archived: all.filter((r) => r.archived).length };
    }
    const active = this.active(now);
    const times = this.records.map((r) => r.at).filter(Boolean);
    return {
      total: this.records.length,
      active: active.length,
      archived: this.records.length - active.length,
      conflicts: this.conflicts.filter((c) => !c.resolved).length,
      provisional: this.records.filter((r) => r.provisional && !r.archived).length,
      protected: active.filter((r) => r.importance >= (this.cfg.decay?.protectImportance ?? 0.7)).length,
      avgStrength: active.length ? active.reduce((a, r) => a + r.strength, 0) / active.length : 0,
      oldestAt: times.length ? Math.min(...times) : null,
      newestAt: times.length ? Math.max(...times) : null,
      perLayer: per,
    };
  }
}

function expired(r, now) {
  return r.validUntil != null && r.validUntil < now;
}

/** 两条记忆是不是在说反话：内容高度相似但一边有否定，或者同一个“喜欢/讨厌”的对象不同 */
function contradiction(a, b) {
  if (a.layer !== b.layer) return false;
  const na = /(不|没|别|讨厌|不喜欢|从不|不再)/.test(a.text);
  const nb = /(不|没|别|讨厌|不喜欢|从不|不再)/.test(b.text);
  if (na !== nb) {
    // “我不喜欢猫” vs “我喜欢猫”：去掉否定词后仍然很像才算矛盾
    const strip = (s) => s.replace(/(不|没|别|讨厌|不喜欢|从不|不再)/g, '');
    return cosine(vectorOf(tokens(strip(a.text))), vectorOf(tokens(strip(b.text)))) > 0.72;
  }
  return false;
}

function createBank(opts = {}) {
  return new MemoryBank(opts);
}

// ---------- 给大模型的提示词 ----------
function extractionMessages(recent, known, userName, name = '小鲸鱼') {
  const who = userName || 'TA';
  const convo = recent.map((m) => `${m.role === 'user' ? who : name}：${m.content}`).join('\n');
  const knownText = known.length ? known.slice(-40).map((f) => `- ${f}`).join('\n') : '（还没有）';
  return [
    {
      role: 'system',
      content: `你是${name}的记忆整理器。从对话里找出以后值得记住的事：关于${who}的事实（名字、喜好、经历、计划、在意的人和事、情绪）、两人之间的约定、${name}自己的新体验。
规则：
- 只写对话里明确出现的信息，不要推测。
- 已经记住的不要重复；如果新信息和已有记忆冲突，写进 corrections。
- 每条用一句完整的话，主语写清楚（用“${who}”或“我”指${name}）。
- importance 1-5：5=名字、重大事件、约定；3=喜好、日常经历；1=随口一提。
- entities 写这条记忆里的人名、地名、作品名、宠物名等专名，没有就空数组。
- 闲聊寒暄没有信息就返回空数组。
只输出 JSON：{"new":[{"text":"...","importance":3,"entities":["..."]}],"corrections":[{"old":"已有记忆原文","text":"更正后的内容"}]}`,
    },
    { role: 'user', content: `已有记忆：\n${knownText}\n\n最近对话：\n${convo}` },
  ];
}

function diaryMessages(date, dayMessages, userName, name = '小鲸鱼') {
  const who = userName || 'TA';
  const convo = dayMessages.map((m) => `${m.role === 'user' ? who : '我'}：${m.content}`).join('\n');
  return [
    {
      role: 'system',
      content: `你是${name}，一个住在电脑里的数字女孩，现在要睡觉了，写一篇今天的日记。第一人称，口语化，像真的女孩子写的私人日记，150 字以内。写今天和${who}聊了什么、你的感受；没什么事就写写今天的心情。不要标题，不要 markdown。`,
    },
    { role: 'user', content: `${date} 的聊天记录：\n${convo || '（今天没人找我说话）'}` },
  ];
}

module.exports = {
  DAY,
  LAYERS,
  LAYER_NAMES,
  SOURCE_KINDS,
  SOURCE_NAMES,
  MemoryBank,
  createBank,
  tokens,
  vectorOf,
  cosine,
  extractEntities,
  parseTimeQuery,
  expired,
  contradiction,
  extractionMessages,
  diaryMessages,
};
