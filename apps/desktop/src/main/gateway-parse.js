// 生命网关：从 DSH 发来的 DeepSeek 格式请求里，取出要她回答的那句话。
// DSH 的系统提示词和它自己维护的会话历史一律不要：她有自己的人设、身体和记忆。
// 请求长什么样见 docs/notes/dsh-spike.md 和 test/fixtures/dsh-chat-request.json。

/** 多模态内容（数组）只取文字部分 */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && (p.type === 'text' || p.type === 'input_text') && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}

/**
 * @param {{messages?: Array}} body  DeepSeek 格式的请求体
 * @param {Record<string,string|string[]|undefined>} [headers]  请求头（小写键名）
 * @returns {{kind:'chat', text:string} | {kind:'other', reason:string}}
 *   以后（阶段 G）chat 会多一个 from 字段：QQ 群里是谁在说话。这一期所有聊天都来自内核页，也就是主人本人。
 */
function parseRequest(body, headers = {}) {
  // DSH 的压缩插件发的摘要请求带这个头（我们没装压缩插件，留着以防以后装上）
  if (headers['x-deepseek-harness-compact']) return { kind: 'other', reason: 'compaction' };
  if (!body || !Array.isArray(body.messages)) return { kind: 'other', reason: 'no-messages' };
  if (body.response_format) return { kind: 'other', reason: 'structured' };
  const msgs = body.messages;
  const last = msgs[msgs.length - 1];
  // 最后一条不是用户说的（比如工具结果）就不是有人在跟她说话。网关从不返回 tool_calls，正常不会出现。
  if (!last || last.role !== 'user') return { kind: 'other', reason: last ? `last-is-${last.role}` : 'empty' };
  const text = textOf(last.content).trim();
  if (!text) return { kind: 'other', reason: 'empty-text' };
  return { kind: 'chat', text };
}

module.exports = { parseRequest, textOf };
