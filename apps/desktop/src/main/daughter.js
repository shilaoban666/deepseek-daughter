// 女儿本体：把状态、身体、记忆、DeepSeek 调用串起来。不依赖 Electron，方便测试。

const { EventEmitter } = require('events');
const life = require('./life');
const body = require('./body');
const memory = require('./memory');
const { buildMessages, nameOf } = require('./persona');
const deepseek = require('./deepseek');

const EXTRACT_EVERY = 3; // 每 3 条用户消息整理一次记忆
const VITALS_MAX = 360; // 曲线保留最近 360 个采样（默认 6 小时）

class Daughter extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./store').JsonStore} deps.store
   * @param {() => {apiKey:string, baseUrl?:string, model:string, userName?:string, userTitle?:string}} deps.getSettings
   * @param {() => number} [deps.now]
   */
  constructor({ store, getSettings, now = Date.now }) {
    super();
    this.store = store;
    this.getSettings = getSettings;
    this.now = now;
    this.state = store.load('state', () => life.initialState(now()));
    this.body = { ...body.initialBody(), ...store.load('body', {}) };
    this.history = store.load('history', []);
    this.facts = store.load('facts', []);
    this.diary = store.load('diary', []);
    this.usage = store.load('usage', {});
    this.vitals = store.load('vitals', []);
    this.balance = null;
    this.startedAt = now();
    this.beats = 0;
    this.sinceExtract = 0;
    this.busy = false;
    this.queue = Promise.resolve();
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

  mind() {
    return {
      thinking: body.thinkingState(this.body, this.state),
      pad: body.pad(this.body, this.state),
      systems: body.systems(this.body, this.state),
    };
  }

  /** 发给界面的生命状态 */
  vitalsSnapshot() {
    return {
      state: this.state,
      body: this.body,
      mind: this.mind(),
      vitals: this.vitals,
      usageToday: this.usage[life.dateKey(this.now())] || { prompt: 0, completion: 0, calls: 0 },
      balance: this.balance,
      uptimeMs: this.now() - this.startedAt,
      beats: this.beats,
    };
  }

  snapshot() {
    return {
      ...this.vitalsSnapshot(),
      history: this.history.slice(-200),
      facts: this.facts,
      diary: this.diary.slice(-30),
      meta: { regions: body.REGIONS, transmitters: body.TRANSMITTERS, drives: body.DRIVES },
    };
  }

  persist() {
    this.store.save('state', this.state);
    this.store.save('body', this.body);
    this.store.save('history', this.history);
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

  async call(messages, extra = {}) {
    const s = this.getSettings();
    const r = await deepseek.chat({ apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model, messages, ...extra });
    this.addUsage(r.usage);
    return r.text;
  }

  /** 推进身体，events 来自 life 或外部（user / reply / digested） */
  advance(events = []) {
    const now = this.now();
    const dtMin = Math.min(Math.max(0, (now - (this.body.lastTick || now)) / 60000), 24 * 60);
    const r = body.stepBody(this.body, this.state, dtMin, now, events);
    this.body = { ...r.body, lastTick: now };
    this.state = r.life;
  }

  sample() {
    const { pad } = this.mind();
    this.vitals.push({
      t: this.now(),
      satiety: Math.round(this.state.satiety),
      energy: Math.round(this.state.energy),
      social: Math.round(this.state.social),
      mood: Math.round(pad.P * 50 + 50),
      cortisol: Math.round(this.body.nt.cortisol),
      oxytocin: Math.round(this.body.nt.oxytocin),
    });
    if (this.vitals.length > VITALS_MAX) this.vitals.splice(0, this.vitals.length - VITALS_MAX);
  }

  feeling() {
    const { thinking, pad } = this.mind();
    const top = this.body.thoughts[this.body.thoughts.length - 1];
    const recentThought = top && this.now() - top.at < 60 * 60000 ? `，刚才在想“${top.text}”` : '';
    return `心情${pad.label}，思考状态是${thinking}${recentThought}。`;
  }

  /** 心跳：推进身体状态，处理睡觉写日记、主动找人 */
  async heartbeat() {
    this.beats += 1;
    const { state, events } = life.tick(this.state, this.now());
    this.state = state;
    this.advance(events);
    this.sample();
    for (const e of events) {
      if (e.type === 'sleep') this.writeDiary().catch((err) => this.emit('error', err));
    }
    this.persist();
    if (this.beats % 5 === 1) this.store.save('vitals', this.vitals);
    this.emit('vitals', this.vitalsSnapshot(), events);

    const reason = life.proactiveReason(this.state, this.now());
    if (reason && !this.busy && this.getSettings().apiKey) {
      await this.speakFirst(reason).catch((err) => this.emit('error', err));
    }
  }

  context(query, extra) {
    return {
      state: this.state,
      facts: memory.retrieve(this.facts, query, this.now()),
      diary: this.diary[this.diary.length - 1] || null,
      history: this.history,
      settings: this.getSettings(),
      now: this.now(),
      feeling: this.feeling(),
      extra,
    };
  }

  /** 用户发消息，流式返回她的回复 */
  reply(text) {
    return this.exclusive(async () => {
      const prevUserAt = this.state.lastUserAt;
      const { state, events } = life.onUserMessage(this.state, this.now());
      this.state = state;
      this.advance([...events, { type: 'user' }]);
      const userMsg = { role: 'user', content: text, at: this.now() };
      this.history.push(userMsg);
      this.persist();
      this.emit('vitals', this.vitalsSnapshot(), [...events, { type: 'user' }]);

      const extra = events.some((e) => e.type === 'woken') ? '【注意】你刚刚是被 TA 的消息吵醒的，还迷迷糊糊。' : undefined;
      const messages = buildMessages({ ...this.context(text, extra), lastUserAt: prevUserAt });
      const id = `a-${this.now()}`;
      this.emit('reply-start', id);
      let replyText;
      try {
        replyText = await this.call(messages, { temperature: 1.1, onDelta: (d) => this.emit('reply-delta', id, d) });
      } catch (err) {
        this.emit('reply-end', id, null, err.message);
        throw err;
      }
      const msg = { role: 'assistant', content: replyText.trim(), at: this.now(), id };
      this.history.push(msg);
      this.advance([{ type: 'reply' }]);
      this.persist();
      this.emit('reply-end', id, msg);
      this.emit('vitals', this.vitalsSnapshot(), [{ type: 'reply' }]);

      this.sinceExtract += 1;
      if (this.sinceExtract >= EXTRACT_EVERY) {
        this.sinceExtract = 0;
        this.extractMemories().catch((err) => this.emit('error', err));
      }
      return msg;
    });
  }

  /** 她主动开口 */
  speakFirst(reason) {
    return this.exclusive(async () => {
      const extra = `【你现在想主动找 TA 说话】原因：${reason}。TA 现在没在跟你聊天，你主动发一两句消息开个头，自然一点，可以说说你在干嘛、想到了什么，不要质问 TA 为什么不理你。`;
      const messages = buildMessages(this.context('', extra));
      const text = (await this.call(messages, { temperature: 1.2 })).trim();
      if (!text) return null;
      this.state = life.markProactive(this.state, this.now());
      const msg = { role: 'assistant', content: text, at: this.now(), id: `p-${this.now()}`, proactive: true };
      this.history.push(msg);
      this.advance([{ type: 'reply' }]);
      this.persist();
      this.emit('proactive', msg);
      this.emit('vitals', this.vitalsSnapshot(), [{ type: 'reply' }]);
      return msg;
    });
  }

  async extractMemories() {
    const recent = this.history.slice(-10);
    if (!recent.some((m) => m.role === 'user')) return;
    const raw = await this.call(memory.extractionMessages(recent, this.facts, this.getSettings().userName, nameOf(this.getSettings())), { json: true, temperature: 0.2 });
    this.facts = memory.mergeFacts(this.facts, deepseek.parseJSONLoose(raw), this.now());
    this.store.save('facts', this.facts);
    this.advance([{ type: 'digested', n: EXTRACT_EVERY }]);
    this.emit('facts', this.facts);
    this.emit('vitals', this.vitalsSnapshot(), []);
  }

  async writeDiary() {
    const date = life.dateKey(this.now() - 4 * 3600000); // 凌晨睡觉时写的算前一天
    if (this.diary.some((d) => d.date === date) || !this.getSettings().apiKey) return;
    const day = this.history.filter((m) => life.dateKey((m.at || 0) - 4 * 3600000) === date).slice(-60);
    const text = (await this.call(memory.diaryMessages(date, day, this.getSettings().userName, nameOf(this.getSettings())), { temperature: 1 })).trim();
    if (!text) return;
    this.diary.push({ date, text, at: this.now() });
    this.store.save('diary', this.diary);
    this.emit('diary', this.diary);
  }

  /** 查询 DeepSeek 余额（Token 钱包） */
  async refreshBalance() {
    const s = this.getSettings();
    if (!s.apiKey) return (this.balance = null);
    try {
      this.balance = { ...(await deepseek.balance({ apiKey: s.apiKey, baseUrl: s.baseUrl })), at: this.now() };
    } catch (err) {
      this.balance = { error: err.message, at: this.now() };
    }
    this.emit('vitals', this.vitalsSnapshot(), []);
    return this.balance;
  }

  /** 手动删一条记忆（主人有权管理她记住了什么） */
  forget(id) {
    this.facts = this.facts.filter((f) => f.id !== id);
    this.store.save('facts', this.facts);
    this.emit('facts', this.facts);
  }
}

module.exports = { Daughter };
