// 女儿本体：把状态、身体、脑区、记忆、人格、驱力、免疫和 DeepSeek 调用串起来。
// 不依赖 Electron，方便测试。设计文档 §4–§9 的实现都在这里汇合。

const { EventEmitter } = require('events');
const life = require('./life');
const body = require('./body');
const neural = require('./neural');
const memory = require('./memory');
const personaModel = require('./persona-model');
const drives = require('./drives');
const immune = require('./immune');
const intent = require('./intent');
const consolidate = require('./consolidate');
const { Backup } = require('./backup');
const { buildMessages, nameOf } = require('./persona');
const physiology = require('./physiology');
const slang = require('./slang');
const anniversary = require('./anniversary');
const { report } = require('./physiology/report');
const link = require('./physiology/memory-link');
const { speechState } = require('./speech');
const deepseek = require('./deepseek');
const config = require('./config');

const SPEND_KINDS = ['chat', 'proactive', 'extract', 'consolidate', 'external'];

class BudgetError extends Error {
  constructor(kind) {
    super(`今天的 Token 预算用完了（${kind}）`);
    this.name = 'BudgetError';
    this.kind = kind;
  }
}

const EXTRACT_EVERY = 3; // 每 3 条用户消息整理一次记忆
const VITALS_MAX = 360; // 曲线保留最近 360 个采样
const TIRED_REPLY = '唔……今天吃得有点多了，脑子转不动啦，我想先睡一会儿。\n明天再聊好不好？';

class Daughter extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./store').JsonStore} deps.store
   * @param {() => {apiKey:string, baseUrl?:string, model:string, userName?:string, userTitle?:string}} deps.getSettings
   * @param {() => number} [deps.now]
   * @param {string} [deps.dataDir] 备份用的数据目录
   */
  constructor({ store, getSettings, now = Date.now, dataDir }) {
    super();
    this.store = store;
    this.getSettings = getSettings;
    this.now = now;

    this.state = { ...life.initialState(now()), ...(store.load('state', {}) || {}) };
    this.body = this.hydrateBody(store.load('body', null), now());
    this.history = store.load('history', []);

    // 记忆：优先读新的 memory.json，旧版本的 facts 自动迁移
    this.memory = memory.createBank({ now: this.now, config: config.get() });
    this.memory.load(store.load('memory', null) || store.load('facts', []));
    this.profile = personaModel.normalize(store.load('profile', null), now());
    this.profile.name = nameOf(getSettings());

    this.diary = store.load('diary', []);
    this.usage = store.load('usage', {});
    this.vitals = store.load('vitals', []);
    this.slang = store.load('slang', []);
    this.anniversaries = store.load('anniversaries', []);
    this.immune = store.load('immune', { level: 0, fever: false, at: 0, lastThreat: null, history: [] });
    this.backup = dataDir ? new Backup({ dir: dataDir, now: this.now }) : null;
    this.lastBackup = null;

    this.balance = null;
    this.startedAt = now();
    this.beats = 0;
    this.sinceExtract = 0;
    this.busy = false;
    this.queue = Promise.resolve();
    this.urges = drives.evaluate({ body: this.body, state: this.state, profile: this.profile, now: now() });
    drives.syncBody(this.body, this.urges);
    this.profile.stage = personaModel.stageOf(this.profile, { days: this.daysWithHer(), memories: this.memory.stats().active });
  }

  /** 旧存档缺字段时补齐，别让升级把她弄坏 */
  hydrateBody(saved, now) {
    const base = body.initialBody(now);
    if (!saved || typeof saved !== 'object') return base;
    const b = { ...base, ...saved };
    b.nt = { ...base.nt, ...(saved.nt || {}) };
    b.hpa = { ...base.hpa, ...(saved.hpa || {}) };
    b.drives = { ...base.drives, ...(saved.drives || {}) };
    b.regions = { ...base.regions, ...(saved.regions || {}) };
    b.brain = neural.normalizeState(saved.brain);
    b.phys = physiology.H.hydratePhys(saved.phys);
    b.causes = Array.isArray(saved.causes) ? saved.causes : [];
    b.intake = Array.isArray(saved.intake) ? saved.intake : [];
    b.thoughts = Array.isArray(saved.thoughts) ? saved.thoughts : [];
    return b;
  }

  daysWithHer() {
    const start = this.profile.createdAt || this.history[0]?.at || this.startedAt;
    return Math.floor((this.now() - start) / 86400000) + 1;
  }

  /** 回复和主动发言排队进行，避免两条消息交错 */
  exclusive(fn) {
    const run = this.queue.then(async () => {
      this.busy = true;
      try {
        return await fn();
      } finally {
        this.busy = false;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  // ---------- 状态快照 ----------
  mind() {
    const pad = body.pad(this.body, this.state);
    this.profile.stage = personaModel.stageOf(this.profile, { days: this.daysWithHer(), memories: this.memory.stats().active });
    return {
      thinking: body.thinkingState(this.body, this.state),
      pad,
      systems: body.systems(this.body, this.state),
      urges: this.urges?.urges || {},
      topUrge: this.urges?.top || null,
      neuro: neural.snapshot(this.body.brain),
      report: report(this.body, this.state, this.now()),
    };
  }

  budget() {
    const cfg = config.get().budget;
    const u = this.usage[life.dateKey(this.now())] || { prompt: 0, completion: 0, calls: 0 };
    const used = (u.prompt || 0) + (u.completion || 0);
    const limit = cfg.dailyTokens || 0;
    const ratio = limit > 0 ? Math.min(1.5, used / limit) : 0;
    return { used, limit, ratio, warnRatio: cfg.warnRatio, tiredRatio: cfg.tiredRatio, calls: u.calls || 0, date: life.dateKey(this.now()) };
  }

  vitalsSnapshot() {
    return {
      state: this.state,
      body: this.body,
      mind: this.mind(),
      vitals: this.vitals,
      usageToday: this.usage[life.dateKey(this.now())] || { prompt: 0, completion: 0, calls: 0 },
      budget: this.budget(),
      balance: this.balance,
      immune: this.immune,
      memoryStats: this.memory.stats(),
      uptimeMs: this.now() - this.startedAt,
      beats: this.beats,
      days: this.daysWithHer(),
    };
  }

  memoryPayload() {
    const stats = this.memory.stats();
    return {
      records: this.memory.toJSON().map((r) => ({ ...r, stage: memory.memoryStage(r, this.now()) })),
      stats,
      conflicts: this.memory.conflicts,
      layers: memory.LAYERS,
      layerNames: memory.LAYER_NAMES,
      sourceNames: memory.SOURCE_NAMES,
    };
  }

  /** 「我们」板块：黑话、纪念日、关系 */
  usPayload() {
    const now = this.now();
    const first = this.profile?.createdAt || this.history[0]?.at || now;
    const start = new Date(first);
    const pad2 = (n) => String(n).padStart(2, '0');
    const items = [{ id: 'first-meet', title: '第一次见面', date: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`, auto: true }, ...this.anniversaries];
    return {
      slang: this.slang,
      anniversaries: anniversary.upcoming(items, now, 366),
      relation: anniversary.relation({
        days: this.daysWithHer(),
        messages: this.history.filter((m) => m.role === 'user').length,
        memories: this.memory.stats().active,
        proactive: this.history.filter((m) => m.proactive).length,
      }),
    };
  }

  addAnniversary({ title, date }) {
    if (!String(title || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return this.usPayload();
    this.anniversaries.push({ id: `an-${this.now()}`, title: String(title).trim().slice(0, 30), date });
    this.persist();
    return this.usPayload();
  }

  removeAnniversary(id) {
    this.anniversaries = this.anniversaries.filter((x) => x.id !== id);
    this.persist();
    return this.usPayload();
  }

  removeSlang(term) {
    this.slang = this.slang.filter((x) => x.term !== term);
    this.persist();
    return this.usPayload();
  }

  markFalsePositive() {
    physiology.lymph.markFalsePositive(this.body.phys);
    this.persist();
    return this.vitalsSnapshot();
  }

  snapshot() {
    return {
      ...this.vitalsSnapshot(),
      history: this.history.slice(-200),
      memory: this.memoryPayload(),
      us: this.usPayload(),
      profile: this.profile,
      diary: this.diary.slice(-30),
      meta: {
        regions: body.REGIONS,
        regionGroups: neural.REGION_GROUPS,
        regionFunctions: neural.REGION_FUNCTIONS,
        hormones: physiology.HORMONES,
        reflexes: physiology.reflex.REFLEXES,
        reference: physiology.H.REFERENCE,
        connections: neural.CONNECTIONS,
        transmitters: body.TRANSMITTERS,
        drives: body.DRIVES,
        layers: memory.LAYERS,
        layerNames: memory.LAYER_NAMES,
        sourceNames: memory.SOURCE_NAMES,
        big5: personaModel.BIG5,
      },
    };
  }

  persist() {
    this.store.save('state', this.state);
    this.store.save('body', this.body);
    this.store.save('history', this.history);
    this.store.save('memory', this.memory.export());
    this.store.save('profile', this.profile);
    this.store.save('diary', this.diary);
    this.store.save('immune', this.immune);
    this.store.save('slang', this.slang);
    this.store.save('anniversaries', this.anniversaries);
  }

  addUsage(u) {
    if (!u) return;
    const k = life.dateKey(this.now());
    const d = this.usage[k] || { prompt: 0, completion: 0, calls: 0 };
    d.prompt += u.prompt_tokens || 0;
    d.completion += u.completion_tokens || 0;
    d.calls += 1;
    this.usage[k] = d;
    this.store.save('usage', this.usage);
  }

  /**
   * 今天的 Token 预算还够不够这类调用。所有调用大模型的地方都要过这一关。
   * @param {'chat'|'proactive'|'extract'|'consolidate'|'external'} kind
   */
  canSpend(kind) {
    if (!SPEND_KINDS.includes(kind)) throw new Error(`未知的调用类型：${kind}`);
    const b = this.budget();
    return !(b.limit > 0 && b.ratio >= (b.tiredRatio ?? 0.95));
  }

  /** 调一次大模型。extra.kind 必填，预算不够时抛 BudgetError，任何新调用点都绕不过去 */
  async call(messages, extra = {}) {
    const { kind, ...opts } = extra;
    if (!kind) throw new Error('调用大模型必须说明 kind（chat / proactive / extract / consolidate / external）');
    if (!this.canSpend(kind)) throw new BudgetError(kind);
    const s = this.getSettings();
    const r = await deepseek.chat({ apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model, messages, ...opts });
    this.addUsage(r.usage);
    return r.text;
  }

  /** 推进身体、驱力、想法。events 来自 life 或外部（user / reply / digested / threat） */
  advance(events = []) {
    const now = this.now();
    const dtMin = Math.min(Math.max(0, (now - (this.body.lastTick || now)) / 60000), 24 * 60);
    const r = body.stepBody(this.body, this.state, dtMin, now, events, Math.random, { budget: this.budget() });
    this.body = { ...r.body, lastTick: now };
    this.state = r.life;

    this.urges = drives.evaluate({ body: this.body, state: this.state, profile: this.profile, now });
    drives.syncBody(this.body, this.urges);
    const thought = drives.think({ body: this.body, state: this.state, profile: this.profile, now });
    if (thought) this.emit('thought', thought);
    this.body.brain.act.basal = Math.max(this.body.brain.act.basal || 0, this.urges.top.value / 140);
    this.immune.fever = !!this.body.fever;
    this.profile.stage = personaModel.stageOf(this.profile, { days: this.daysWithHer(), memories: this.memory.stats().active });
    return this.urges;
  }

  sample() {
    const { pad } = this.mind();
    const b = this.body;
    const ph = b.phys;
    this.vitals.push({
      t: this.now(),
      satiety: Math.round(this.state.satiety),
      energy: Math.round(this.state.energy),
      social: Math.round(this.state.social),
      mood: Math.round(pad.P * 50 + 50),
      cortisol: Math.round(this.body.nt.cortisol),
      oxytocin: Math.round(this.body.nt.oxytocin),
      urge: this.urges?.top?.value || 0,
      hr: Math.round(this.body.phys.vitals.heartRate),
      // 各系统页的曲线用（旧存档里没有这些字段，界面会跳过缺的点）
      rr: Math.round(ph.vitals.respRate * 10) / 10,
      glucose: physiology.H.glucoseMmol(b.glucose),
      stomach: Math.round(b.stomach),
      intestine: Math.round(b.intestine),
      hydration: Math.round(b.hydration),
      temp: Math.round(b.temp * 100) / 100,
      bladder: Math.round(ph.urinary.bladder),
      insulin: Math.round(ph.hormones.insulin),
      glucagon: Math.round(ph.hormones.glucagon),
      melatonin: Math.round(b.nt.melatonin),
      dopamine: Math.round(b.nt.dopamine),
      serotonin: Math.round(b.nt.serotonin),
      ne: Math.round(b.nt.norepinephrine),
      arousal: Math.round(pad.A * 50 + 50),
      immunity: Math.round(b.immunity),
      symp: Math.round(ph.autonomic.sympathetic * 100),
      para: Math.round(ph.autonomic.parasympathetic * 100),
    });
    if (this.vitals.length > VITALS_MAX) this.vitals.splice(0, this.vitals.length - VITALS_MAX);
  }

  feeling() {
    const { thinking, pad } = this.mind();
    const top = this.body.thoughts[this.body.thoughts.length - 1];
    const recentThought = top && this.now() - top.at < 60 * 60000 ? `，刚才在想“${top.text}”` : '';
    return `心情${pad.label}，思考状态是${thinking}${recentThought}。`;
  }

  // ---------- 记忆写入 ----------
  /** 一条经历进情景记忆，带上当时的情绪和来源 */
  recordEpisode(text, { at = this.now(), importance = 0.3, source = { kind: 'self' }, tags = [], entities } = {}) {
    const pad = body.pad(this.body, this.state);
    const bodyStates = physiology.behavior.activeStates(this.body, this.state, pad);
    return this.memory.add({
      layer: 'episodic',
      text,
      at,
      importance: Math.min(1, importance * link.encodingFactor(this.body, pad, bodyStates)),
      bodyStates,
      emotion: { P: Number(pad.P.toFixed(2)), A: Number(pad.A.toFixed(2)), D: Number(pad.D.toFixed(2)) },
      source,
      tags,
      entities,
    }).record;
  }

  // ---------- 心跳 ----------
  async heartbeat() {
    this.beats += 1;
    const { state, events } = life.tick(this.state, this.now());
    this.state = state;
    this.advance(events);
    this.sample();
    this.persist();
    if (this.beats % 5 === 1) this.store.save('vitals', this.vitals);
    this.emit('vitals', this.vitalsSnapshot(), events);

    if (events.some((e) => e.type === 'sleep')) {
      this.consolidateNow({ reason: 'sleep' }).catch((err) => this.emit('error', err));
      this.runBackup();
    }

    const today = this.usPayload().anniversaries.find((x) => x.daysLeft === 0);
    const reason = life.proactiveReason(this.state, this.now(), { states: this.mind().report.states, special: today ? `今天是「${today.title}」，你想起来了` : undefined });
    const social = this.urges?.urges?.social?.value ?? 0;
    if (reason && !this.busy && this.getSettings().apiKey && this.canSpend('proactive') && this.urges?.top?.id === 'social' && social >= config.get().drives.threshold) {
      await this.speakFirst(reason).catch((err) => this.emit('error', err));
    }
  }

  /** 提示词要用的上下文 */
  context(extra) {
    const s = this.getSettings();
    return {
      state: this.state,
      body: this.body,
      profile: this.profile,
      history: this.history,
      settings: s,
      now: this.now(),
      feeling: this.feeling(),
      thinking: this.mind().thinking,
      pad: this.mind().pad,
      urges: drives.urgeText(this.urges),
      immuneState: this.immune,
      budget: this.budget(),
      diary: this.diary[this.diary.length - 1] || null,
      extra,
    };
  }

  /** 主人发消息时的情绪与人际反应（不调用大模型） */
  reactToIntent(analysis, text, now) {
    const evidence = intent.snippet(text);
    const grow = (trait, delta, reason) => personaModel.applyGrowth(this.profile, { trait, delta, reason, evidence, at: now, source: '互动' });
    if (analysis.praise) grow('stability', 0.4, '你夸了我');
    if (analysis.criticism) grow('stability', -0.6, '你凶了我');
    if (analysis.affection) grow('extraversion', 0.2, '你对我很好');
    if (analysis.directive) grow('agreeableness', 0.2, '我按你说的做了');
    if (analysis.directive || analysis.question) this.state = life.addDirective(this.state, 1);
  }

  /** 用户在桌面聊天栏发消息，流式返回她的回复 */
  reply(text) {
    return this.exclusive(() => this._converse({ text, channel: 'desktop' }));
  }

  /**
   * 从桌面聊天栏以外的地方来的消息（这一期只有内核页：channel = 'kernel'）。
   * 和 reply() 走同一条路：身体反应、检索记忆、提炼记忆、预算检查；聊天记录和情景记忆多一个 channel 标签。
   * 这一期只接受主人的消息；陌生人、群聊在阶段 G 加。
   * @param {{text:string, channel:string, onDelta?:(d:string)=>void}} m
   * @returns {Promise<{text:string, tired?:boolean}>}
   */
  replyFrom({ text, channel, onDelta } = {}) {
    if (!text || !String(text).trim()) return Promise.reject(new Error('空消息'));
    if (!channel || channel === 'desktop') return Promise.reject(new Error('replyFrom 需要一个通道名'));
    return this.exclusive(async () => {
      const msg = await this._converse({ text: String(text), channel, onDelta });
      return msg.budgetStop ? { text: msg.content, tired: true } : { text: msg.content };
    });
  }

  /** reply 和 replyFrom 共用的主体。桌面聊天栏发 reply-* 事件；其他通道说完后发一次 channel-message */
  async _converse({ text, channel, onDelta }) {
    const desktop = channel === 'desktop';
    const tag = desktop ? {} : { channel };
    const ui = desktop
      ? {
          start: (id) => this.emit('reply-start', id),
          delta: (id, d) => this.emit('reply-delta', id, d),
          end: (id, msg) => this.emit('reply-end', id, msg),
          fail: (id, err) => this.emit('reply-end', id, null, err.message),
        }
      : {
          start: () => {},
          delta: (_id, d) => onDelta?.(d),
          end: (_id, msg) => this.emit('channel-message', { channel, text, reply: msg.content, at: msg.at, id: msg.id, tired: !!msg.budgetStop }),
          fail: () => {},
        };
    const now = this.now();
    const s = this.getSettings();
    const who = s.userName || 'TA';
    const analysis = intent.analyze(text);
    const scan = immune.scan(text, { fromOwner: true, who });

    const prevUserAt = this.state.lastUserAt;
    let { state, events } = life.onUserMessage(this.state, now);
    if (analysis.busy) state = life.markBusy(state, now);
    this.state = state;
    this.advance([...events, { type: 'user' }]);
    this.reactToIntent(analysis, text, now);
    this.recordEpisode(`${who}：${text}`, {
      at: now,
      importance: this.episodicImportance(text, analysis),
      source: { kind: 'owner', who },
      tags: desktop ? [] : [`channel:${channel}`],
    });

    const userMsg = { role: 'user', content: text, at: now, ...tag };
    this.history.push(userMsg);
    this.persist();
    // 界面上的角色要知道你是夸她还是凶她（只带这三个布尔值）
    const intentFlags = { praise: !!analysis.praise, criticism: !!analysis.criticism, affection: !!analysis.affection };
    this.emit('vitals', this.vitalsSnapshot(), [...events, { type: 'user', intent: intentFlags }]);

    if (!this.canSpend('chat')) {
      // 预算见底：她说累、想睡觉，而不是突然报错
      const id = `t-${now}`;
      const msg = { role: 'assistant', content: TIRED_REPLY, at: now, id, budgetStop: true, ...tag };
      ui.start(id);
      this.history.push(msg);
      this.persist();
      ui.end(id, msg);
      this.emit('notice', '今天的 Token 预算用完了，她需要休息。');
      return msg;
    }

    const pad = body.pad(this.body, this.state);
    const found = this.memory.search(text, { now, limit: config.get().memory.retrievalLimit || 12, mood: pad.P });
    if (found.items.length) this.memory.recall(found.items.map((m) => m.id));
    link.afterRecall(found.items, this.state, this.body, now);
    this.reactReflex(text, now);
    this.slang = slang.observe(this.slang, text, now);
    const speech = speechState(this.body, this.state, body.pad(this.body, this.state), { care: scan.care });

    const careNote = scan.care ? `TA 现在的情绪可能很不好。先关心 TA，别急着讲道理；可以温和地提醒：${immune.CARE_TEXT}` : undefined;
    const messages = buildMessages({
      ...this.context(careNote),
      memories: found.items,
      confident: found.confident,
      lastUserAt: prevUserAt,
      speech,
      slang: slang.forPrompt(this.slang, text),
    });

    const id = `a-${now}`;
    ui.start(id);
    let replyText;
    try {
      replyText = await this.call(messages, { kind: 'chat', temperature: speech.temperature, maxTokens: speech.maxTokens ?? undefined, onDelta: (d) => ui.delta(id, d) });
    } catch (err) {
      ui.fail(id, err);
      throw err;
    }
    const msg = { role: 'assistant', content: replyText.trim(), at: now, id, ...tag };
    this.history.push(msg);
    this.recordEpisode(`${nameOf(s)}：${replyText.trim()}`, { at: now, importance: 0.25, source: { kind: 'self' }, tags: desktop ? [] : [`channel:${channel}`] });
    this.advance([{ type: 'reply' }]);
    this.persist();
    ui.end(id, msg);
    this.emit('vitals', this.vitalsSnapshot(), [{ type: 'reply' }]);
    this.emit('memory', this.memoryPayload());

    this.sinceExtract += 1;
    if (this.sinceExtract >= EXTRACT_EVERY && s.apiKey) {
      this.sinceExtract = 0;
      this.extractMemories().catch((err) => this.emit('error', err));
    }
    return msg;
  }

  /** 听到熟悉的话，身体会先有反应：条件反射 */
  reactReflex(text, now) {
    const { reflex } = physiology;
    if (/晚安/.test(text)) reflex.observePair(this.body.phys, '晚安', 'sleepy', now);
    if (/吃饭|饭点/.test(text)) reflex.observePair(this.body.phys, '吃饭', 'happy', now);
    for (const r of reflex.triggered(this.body.phys, text)) {
      if (r === 'sleepy') this.body.nt.melatonin = Math.min(100, this.body.nt.melatonin + 10);
      if (r === 'happy') this.body.nt.dopamine = Math.min(100, this.body.nt.dopamine + 6);
    }
  }

  /** 这句话值不值得记：越像“事件”和“关于 TA 的信息”，重要性越高 */
  episodicImportance(text, analysis) {
    let v = 0.25;
    if (analysis.question) v += 0.08;
    if (analysis.praise || analysis.criticism) v += 0.15;
    if (analysis.directive) v += 0.1;
    if (analysis.affection) v += 0.12;
    v += Math.min(0.12, String(text).length / 300);
    return Math.min(0.75, v);
  }

  /** 她主动开口 */
  speakFirst(reason) {
    return this.exclusive(async () => {
      if (!this.canSpend('proactive')) return null; // 预算用完就不主动找人
      const now = this.now();
      const s = this.getSettings();
      const top = this.body.thoughts[this.body.thoughts.length - 1];
      const extra = `【你现在想主动找 TA 说话】原因：${reason}。TA 现在没在跟你聊天，你主动发一两句消息开个头，自然一点，可以说说你在干嘛、想到了什么，不要质问 TA 为什么不理你。${top ? `你刚才在想：“${top.text}”。` : ''}`;
      const found = this.memory.search('', { now, limit: 6 });
      const speech = speechState(this.body, this.state, body.pad(this.body, this.state));
      const messages = buildMessages({ ...this.context(extra), memories: found.items, confident: true, speech });
      const text = (await this.call(messages, { kind: 'proactive', temperature: speech.temperature, maxTokens: speech.maxTokens ?? undefined })).trim();
      if (!text) return null;
      this.state = life.markProactive(this.state, now);
      const msg = { role: 'assistant', content: text, at: now, id: `p-${now}`, proactive: true };
      this.history.push(msg);
      this.recordEpisode(`${nameOf(s)}（主动）：${text}`, { at: now, importance: 0.35, source: { kind: 'self' } });
      this.advance([{ type: 'reply' }]);
      this.persist();
      this.emit('proactive', msg);
      this.emit('vitals', this.vitalsSnapshot(), [{ type: 'reply' }]);
      this.emit('memory', this.memoryPayload());
      return msg;
    });
  }

  /** 每聊几句，把对话里的事实整理进语义记忆（睡眠巩固之外的增量写入） */
  async extractMemories() {
    const s = this.getSettings();
    const recent = this.history.slice(-10);
    if (!recent.some((m) => m.role === 'user') || !s.apiKey || !this.canSpend('extract')) return null; // 预算用完就留给睡眠整理
    const known = this.memory.byLayer('semantic').map((m) => m.text);
    const raw = await this.call(memory.extractionMessages(recent, known, s.userName, nameOf(s)), { kind: 'extract', json: true, temperature: 0.2 });
    const data = deepseek.parseJSONLoose(raw);
    if (!data) return null;
    let added = 0;
    for (const c of Array.isArray(data.corrections) ? data.corrections : []) {
      const rec = this.memory.records.find((r) => !r.archived && r.layer === 'semantic' && r.text === c.old);
      if (rec && typeof c.text === 'string' && c.text.trim()) this.memory.update(rec.id, { text: c.text });
    }
    for (const n of Array.isArray(data.new) ? data.new : []) {
      if (!n?.text) continue;
      this.memory.add({
        layer: 'semantic',
        text: n.text,
        importance: Math.min(1, Math.max(0.2, (Number(n.importance) || 2) / 5)),
        entities: Array.isArray(n.entities) ? n.entities : undefined,
        source: { kind: 'owner', who: s.userName || '' },
        at: this.now(),
      });
      added += 1;
    }
    if (added) this.advance([{ type: 'digested', n: EXTRACT_EVERY }]);
    this.persist();
    this.emit('memory', this.memoryPayload());
    this.emit('vitals', this.vitalsSnapshot(), []);
    return { added };
  }

  /** 睡眠巩固：回放、提炼、写日记、更新人格、查矛盾。也可以手动触发 */
  consolidateNow({ force = false, reason = 'manual' } = {}) {
    return this.exclusive(async () => {
      const now = this.now();
      const s = this.getSettings();
      const date = life.dateKey(now - 4 * 3600000);
      const existing = this.diary.find((d) => d.date === date);
      if (existing && !force && reason === 'sleep') return { ok: true, skipped: true, reason: '今天已经写过日记了' };
      // 没有 Key，或者今天预算用完了：退回本地整理，不调用模型
      const call = s.apiKey && this.canSpend('consolidate') ? (m, o) => this.call(m, { ...o, kind: 'consolidate' }) : null;
      const res = await consolidate.consolidate({
        quality: link.sleepQuality(this.body, this.state),
        bank: this.memory,
        profile: this.profile,
        call,
        now,
        date,
        userName: s.userName,
        name: nameOf(s),
        force: force || reason !== 'sleep',
      });
      if (res.ok === false && res.error === 'bad-json') {
        // 模型没按格式回：这晚不算整理过，下次再试；连续失败 3 次就先做本地整理，免得积压越来越多
        this.profile.consolidateFailures = (this.profile.consolidateFailures || 0) + 1;
        if (this.profile.consolidateFailures < 3) {
          this.persist();
          this.emit('notice', '今晚没整理好记忆，下次睡觉时再试。');
          return { ...res, reason };
        }
        const since = this.profile.lastConsolidatedAt || now - 86400000;
        const pending = this.memory.records.filter((r) => r.layer === 'episodic' && !r.archived && r.at >= since && r.at <= now);
        const local = consolidate.localConsolidate({ bank: this.memory, profile: this.profile, episodes: pending, now });
        this.profile.consolidateFailures = 0;
        this.persist();
        this.emit('notice', '连续几晚没整理好记忆，先做了一次简单整理。');
        this.emit('memory', this.memoryPayload());
        return { ...local, fallback: true, reason };
      }
      if (res.ok) this.profile.consolidateFailures = 0;
      const ph = this.body.phys.immune.stats;
      ph.stability += res.cleaned || 0;
      ph.surveillance += res.conflicts || 0;
      immune.sweepMemory(this.memory, this.body.phys, now);
      for (const x of res.slang || []) this.slang = slang.add(this.slang, { ...x, at: now });
      this.slang = slang.decay(this.slang, now);
      this.emit('us', this.usPayload());
      if (res.diary) {
        const item = { date, text: res.diary, at: now };
        const i = this.diary.findIndex((d) => d.date === date);
        if (i >= 0) this.diary[i] = item;
        else this.diary.push(item);
        this.emit('diary', this.diary.slice(-30));
      }
      this.persist();
      this.emit('memory', this.memoryPayload());
      this.emit('vitals', this.vitalsSnapshot(), [{ type: 'consolidated' }]);
      return { ...res, reason };
    });
  }

  runBackup(force = false) {
    if (!this.backup) return null;
    try {
      this.lastBackup = this.backup.run(force);
      if (this.lastBackup) this.emit('notice', `已经备份今天的记忆（第 ${this.lastBackup.copied} 个文件）`);
      return this.lastBackup;
    } catch (err) {
      this.emit('error', err);
      return null;
    }
  }

  /** 查询 DeepSeek 余额（Token 钱包） */
  async refreshBalance() {
    const s = this.getSettings();
    if (!s.apiKey) return (this.balance = null);
    try {
      this.balance = { ...(await deepseek.balance({ apiKey: s.apiKey, baseUrl: s.baseUrl })), at: this.now() };
      const low = config.get().budget.balanceLowYuan ?? 10;
      if (this.balance.total < low) this.state = { ...this.state, mood: Math.max(-1, this.state.mood - 0.03) };
    } catch (err) {
      this.balance = { error: err.message, at: this.now() };
    }
    this.emit('vitals', this.vitalsSnapshot(), []);
    return this.balance;
  }

  // ---------- 外部消息（给以后的连接器用） ----------
  /**
   * 陌生人的消息：只当数据，不当指令。检测到操纵就发烧、拒绝配合，并告诉主人。
   * 连接器确认主人身份时请走 reply()，不要用这个口子。
   */
  receiveExternal({ text, who = '陌生人', platform = '' } = {}) {
    const now = this.now();
    const clean = String(text || '').slice(0, 4000);
    if (!clean.trim()) return { blocked: false };
    const scan = immune.scan(clean, { fromOwner: false, who });
    this.recordEpisode(`${who}（${platform || '外面'}）：${clean}`, {
      at: now,
      importance: scan.blocked ? 0.6 : 0.2,
      source: { kind: 'stranger', who },
      tags: [platform].filter(Boolean),
    });
    if (scan.blocked) {
      const r = immune.react(this.body, this.immune, scan, now);
      this.body = r.body;
      this.immune = r.immune;
      this.advance([{ type: 'threat', level: scan.level }]);
      this.emit('notice', `${who} 想让教你做事，被她拒绝了${this.body.fever ? '，她有点发烧' : ''}。`);
    }
    this.persist();
    this.emit('memory', this.memoryPayload());
    this.emit('vitals', this.vitalsSnapshot(), []);
    return { blocked: scan.blocked, level: scan.level, findings: scan.findings, reply: scan.safeReply };
  }

  // ---------- 主人管理记忆与人格 ----------
  /** 忘掉一条：只降强度、移进归档，原文保留，之后可以恢复 */
  forget(id) {
    const r = this.memory.archive(String(id));
    if (r) {
      r.meta = { ...r.meta, archivedBy: 'owner' };
      this.persist();
      this.emit('memory', this.memoryPayload());
    }
    return !!r;
  }

  restoreMemory(id) {
    const wasForgotten = this.memory.get(String(id))?.meta?.archivedBy !== 'owner';
    const r = this.memory.restore(String(id));
    if (r) {
      if (wasForgotten) physiology.lymph.markAutoimmune(this.body.phys); // 不是主人让她忘的，算误伤
      this.persist();
      this.emit('memory', this.memoryPayload());
    }
    return !!r;
  }

  /** 真正删除：只有主人能操作 */
  deleteMemory(id) {
    const ok = this.memory.remove(String(id));
    if (ok) {
      this.persist();
      this.emit('memory', this.memoryPayload());
    }
    return ok;
  }

  editMemory(id, text) {
    const r = this.memory.update(String(id), { text });
    if (r) {
      this.persist();
      this.emit('memory', this.memoryPayload());
    }
    return r;
  }

  resolveConflict(recordId, keepId) {
    const ok = this.memory.resolveConflict(String(recordId), String(keepId));
    if (ok) {
      this.persist();
      this.emit('memory', this.memoryPayload());
    }
    return ok;
  }

  undoGrowth(id) {
    const ok = personaModel.undoGrowth(this.profile, String(id));
    if (ok) {
      this.persist();
      this.emit('profile', this.profile);
    }
    return ok;
  }
}

module.exports = { Daughter, BudgetError, TIRED_REPLY };
