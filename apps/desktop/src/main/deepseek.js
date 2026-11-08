// DeepSeek API 客户端（OpenAI 兼容的 /chat/completions，支持流式输出）

const DEFAULT_BASE = 'https://api.deepseek.com';

class DeepSeekError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** 把 SSE 文本流拆成 data 负载。返回 [负载数组, 剩余未完成的文本]。 */
function parseSSE(buffer) {
  const events = [];
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop();
  for (const part of parts) {
    const data = part
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data) events.push(data);
  }
  return [events, rest];
}

function friendlyError(status, body) {
  if (status === 401) return 'API Key 不对，去设置里检查一下。';
  if (status === 402) return 'DeepSeek 账户余额不足，充值后再来找她。';
  if (status === 429) return '请求太频繁了，等一会儿再说。';
  if (status >= 500) return 'DeepSeek 服务器暂时出问题了，稍后再试。';
  return `DeepSeek 返回错误 ${status}：${String(body).slice(0, 200)}`;
}

/**
 * 调用一次对话。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} opts.model
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {boolean} [opts.json] 要求返回 JSON 对象
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {(delta:string)=>void} [opts.onDelta] 有它就走流式
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text:string, usage:{prompt_tokens:number, completion_tokens:number}|null}>}
 */
async function chat(opts) {
  const { apiKey, baseUrl = DEFAULT_BASE, model, messages, json, temperature, maxTokens, onDelta, signal } = opts;
  if (!apiKey) throw new DeepSeekError('还没有填 DeepSeek API Key。', 0);
  const stream = typeof onDelta === 'function';
  const body = { model, messages, stream };
  if (temperature != null) body.temperature = temperature;
  if (maxTokens != null) body.max_tokens = maxTokens;
  if (json) body.response_format = { type: 'json_object' };
  if (stream) body.stream_options = { include_usage: true };

  let res;
  try {
    res = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new DeepSeekError('连不上 DeepSeek，检查一下网络。', 0);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DeepSeekError(friendlyError(res.status, text), res.status);
  }

  if (!stream) {
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content ?? '', usage: data.usage ?? null };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage = null;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const [events, rest] = parseSSE(buffer);
    buffer = rest;
    for (const data of events) {
      if (data === '[DONE]') continue;
      let obj;
      try {
        obj = JSON.parse(data);
      } catch {
        continue;
      }
      if (obj.usage) usage = obj.usage;
      const delta = obj.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }
  }
  return { text, usage };
}

/** 查询账户余额：GET /user/balance。返回 { available, currency, total } */
async function balance({ apiKey, baseUrl = DEFAULT_BASE, signal }) {
  if (!apiKey) throw new DeepSeekError('还没有填 DeepSeek API Key。', 0);
  let res;
  try {
    res = await fetch(baseUrl.replace(/\/+$/, '') + '/user/balance', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal,
    });
  } catch {
    throw new DeepSeekError('连不上 DeepSeek，检查一下网络。', 0);
  }
  if (!res.ok) throw new DeepSeekError(friendlyError(res.status, await res.text().catch(() => '')), res.status);
  const data = await res.json();
  const info = (data.balance_infos || []).find((b) => b.currency === 'CNY') || (data.balance_infos || [])[0] || {};
  return { available: !!data.is_available, currency: info.currency || 'CNY', total: Number(info.total_balance || 0) };
}

/** 解析模型返回的 JSON，容忍外面包了 ```json 代码块。 */
function parseJSONLoose(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

module.exports = { chat, balance, parseSSE, parseJSONLoose, DeepSeekError, DEFAULT_BASE };
