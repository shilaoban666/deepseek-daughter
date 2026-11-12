// 生命网关：一个只监听本机、接口长得和 DeepSeek 一样的 HTTP 服务。
// DSH 的 DeepSeek 适配器把 baseURL 指到这里，以为自己在调用 DeepSeek，实际上是在和她说话：
//   DSH → POST /chat/completions → 取最后一句用户消息 → daughter.replyFrom() → 她的回复按 DeepSeek 的流式格式送回去。
//
// 几条规矩：
// - 只听 127.0.0.1，端口让系统分配；每次启动换一个随机令牌，令牌不对一律 401。这个令牌就是传给 DSH 的“API Key”。
// - 回复里永远没有 tool_calls：DSH 从结构上就调用不了任何工具。
// - 不是聊天的请求（压缩、结构化输出、工具结果）回一句固定的话，不碰她。
// - DSH 出错会重试同一个请求。同一会话同一句话 2 分钟内只让她听一次，重试拿到的是同一个结果。

const http = require('http');
const crypto = require('crypto');
const { parseRequest } = require('./gateway-parse');

const OTHER_REPLY = '（这里只收她的聊天。）';
const EMPTY_REPLY = '……';
const MAX_BODY = 2 * 1024 * 1024;
const DEDUPE_MS = 120000;

/**
 * @param {object} deps
 * @param {{replyFrom:(m:{text:string, channel:string, onDelta?:(d:string)=>void})=>Promise<{text:string, tired?:boolean}>}} deps.daughter
 * @param {(level:string, msg:string)=>void} [deps.log]
 * @param {number} [deps.timeoutMs]  单次请求最长等多久，超时返回 504
 * @param {string} [deps.channel]    这一期固定是 'kernel'
 */
function createGateway({ daughter, log = () => {}, timeoutMs = 120000, channel = 'kernel', now = Date.now } = {}) {
  let server = null;
  let token = null;
  let url = null;
  const recent = new Map(); // 去重：key → { at, promise }
  let lastError = null;
  let counts = { chat: 0, other: 0, unauthorized: 0, retries: 0 };
  let startedAt = null;
  const recentLog = []; // 最近 60 次请求 {at, kind, ms, ok, chars}。只有数字，没有内容
  const record = (kind, since, ok = true, chars = 0) => {
    recentLog.push({ at: now(), kind, ms: Math.max(0, now() - since), ok, chars });
    if (recentLog.length > 60) recentLog.shift();
  };

  function authorized(req) {
    const h = String(req.headers.authorization || '');
    const want = Buffer.from(`Bearer ${token}`);
    const got = Buffer.from(h);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  function sendJSON(res, status, obj) {
    if (res.headersSent) return res.end();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  const errorBody = (message, type = 'server_error') => ({ error: { message, type, code: null } });

  /** DeepSeek 流式格式的一段 */
  function chunk(id, model, delta, finish = null) {
    return `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  }

  /** 用量写 0：真实的 Token 已经记在她自己的账上，DSH 那边不重复计 */
  const USAGE = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  /** 一次完整回复（stream=false，或者重试时直接把结果整段送回去） */
  function respondWhole(res, body, text) {
    const id = `dfy-${crypto.randomBytes(6).toString('hex')}`;
    const model = body.model || 'deepseek-chat';
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.write(chunk(id, model, { role: 'assistant', content: '' }));
      res.write(chunk(id, model, { content: text }));
      res.write(chunk(id, model, {}, 'stop'));
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(now() / 1000), model, choices: [], usage: USAGE })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    sendJSON(res, 200, { id, object: 'chat.completion', created: Math.floor(now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: USAGE });
  }

  function dedupeKey(req, text) {
    const session = String(req.headers['x-deepseek-harness-session-id'] || '');
    return crypto.createHash('sha256').update(`${session}\n${text}`).digest('hex');
  }

  function prune() {
    const t = now();
    for (const [k, v] of recent) if (t - v.at > DEDUPE_MS) recent.delete(k);
    while (recent.size > 50) recent.delete(recent.keys().next().value);
  }

  /** 聊天：交给她。流式时一边说一边往回送 */
  async function handleChat(req, res, body, text) {
    prune();
    const key = dedupeKey(req, text);
    const seen = recent.get(key);
    if (seen) {
      counts.retries += 1;
      const t0 = now();
      log('info', '同一句话的重试，直接给上次的结果');
      try {
        const r = await seen.promise;
        record('retry', t0, true, (r.text || '').length);
        return respondWhole(res, body, r.text || EMPTY_REPLY);
      } catch (err) {
        record('retry', t0, false);
        return sendJSON(res, 503, errorBody(err.message));
      }
    }

    counts.chat += 1;
    const t0 = now();
    const id = `dfy-${crypto.randomBytes(6).toString('hex')}`;
    const model = body.model || 'deepseek-chat';
    const stream = !!body.stream;
    let started = false;
    let sent = '';
    const begin = () => {
      if (started || res.writableEnded) return;
      started = true;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.write(chunk(id, model, { role: 'assistant', content: '' }));
    };
    const onDelta = stream
      ? (d) => {
          if (!d || res.writableEnded) return;
          begin();
          sent += d;
          res.write(chunk(id, model, { content: d }));
        }
      : undefined;

    const promise = Promise.resolve().then(() => daughter.replyFrom({ text, channel, onDelta }));
    promise.catch(() => {}); // 超时以后才失败的话，别变成未处理的 rejection
    recent.set(key, { at: now(), promise });
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('她想了太久，没有回答'), { timeout: true })), timeoutMs);
    });
    try {
      const r = await Promise.race([promise, timeout]);
      const text = (r && r.text) || EMPTY_REPLY;
      lastError = null;
      record('chat', t0, true, text.length);
      if (!stream) return respondWhole(res, body, text);
      begin();
      // 她的回复会 trim，流式送出去的片段可能多了首尾空白；没送出任何字（比如“累了”的固定回复）就整段补上
      if (!sent.trim()) res.write(chunk(id, model, { content: text }));
      res.write(chunk(id, model, {}, 'stop'));
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(now() / 1000), model, choices: [], usage: USAGE })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (err) {
      lastError = err.message;
      record('chat', t0, false);
      log('warn', `回复失败：${err.message}`);
      if (started) {
        // 已经开始流式输出了，没法再改状态码：把已经说出的部分正常收尾
        res.write(chunk(id, model, {}, 'stop'));
        return res.end('data: [DONE]\n\n');
      }
      sendJSON(res, err.timeout ? 504 : 503, errorBody(err.message));
    } finally {
      clearTimeout(timer);
    }
  }

  function handle(req, res) {
    if (!authorized(req)) {
      counts.unauthorized += 1;
      record('unauthorized', now(), false);
      return sendJSON(res, 401, errorBody('令牌不对', 'authentication_error'));
    }
    const path = (req.url || '').split('?')[0];
    if (req.method !== 'POST' || path !== '/chat/completions') return sendJSON(res, 404, errorBody('没有这个接口', 'not_found'));

    let size = 0;
    const parts = [];
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) tooBig = true;
      else parts.push(c);
    });
    req.on('end', () => {
      if (tooBig) return sendJSON(res, 413, errorBody('请求太大'));
      let body;
      try {
        body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
      } catch {
        return sendJSON(res, 400, errorBody('请求不是 JSON', 'invalid_request_error'));
      }
      const parsed = parseRequest(body, req.headers);
      if (parsed.kind !== 'chat') {
        counts.other += 1;
        record('other', now());
        log('info', `非聊天请求（${parsed.reason}），不打扰她`);
        return respondWhole(res, body, OTHER_REPLY);
      }
      handleChat(req, res, body, parsed.text).catch((err) => {
        log('error', err.stack || String(err));
        sendJSON(res, 500, errorBody('网关出错了'));
      });
    });
  }

  return {
    /** @returns {Promise<{url:string, token:string}>} */
    start() {
      if (server) return Promise.resolve({ url, token });
      token = crypto.randomBytes(32).toString('base64url');
      server = http.createServer(handle);
      server.keepAliveTimeout = 5000;
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          url = `http://127.0.0.1:${server.address().port}`;
          startedAt = now();
          log('info', `生命网关已启动：${url}`);
          resolve({ url, token });
        });
      });
    },
    stop() {
      if (!server) return Promise.resolve();
      const s = server;
      server = null;
      url = null;
      token = null;
      recent.clear();
      return new Promise((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections?.();
      });
    },
    address: () => server?.address() || null,
    info: () => ({ url, running: !!server, since: startedAt, lastError, counts: { ...counts }, recent: recentLog.map((x) => ({ ...x })) }),
  };
}

module.exports = { createGateway, OTHER_REPLY };
