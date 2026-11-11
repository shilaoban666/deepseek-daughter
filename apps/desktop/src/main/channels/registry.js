// 她能住进的平台。界面（发现探索 › 平台插件）完全照这张表画。
// 这一期只做界面：设置能保存，连接功能下一期开放，所以没有任何平台会显示“已连接”。

const NAPCAT_URL = 'https://github.com/NapNeko/NapCatQQ';

/** 内容平台共用的两个开关 */
const contentFields = (canWrite = true) => [
  { key: 'read', label: '允许她来这里看内容', type: 'bool', default: true },
  ...(canWrite ? [{ key: 'write', label: '允许她发言（每次发之前要你同意）', type: 'bool', default: false }] : []),
];

const PLATFORMS = [
  {
    id: 'qq',
    name: 'QQ',
    group: 'chat',
    availability: 'soon',
    stage: '下一期',
    color: '#1d9bf0',
    mark: 'Q',
    desc: '在 QQ 上和她聊天，她也会主动找你。',
    does: ['和你私聊', '在你指定的群里，被 @ 时回复', '想你了主动在 QQ 上找你'],
    risk: '用 NapCat 登录的是你自己的 QQ 号，有被风控的可能，建议用小号。',
    fields: [
      { key: 'ownerQQ', label: '你的 QQ 号（大号）', type: 'digits', min: 5, max: 12, required: true, placeholder: '比如 12345678' },
      { key: 'groups', label: '允许她说话的群（群号，用逗号分开）', type: 'digits-list', min: 5, max: 12, placeholder: '不填就不进任何群' },
      { key: 'proactive', label: '允许她主动在 QQ 上找你', type: 'bool', default: true },
      { key: 'port', label: '监听端口', type: 'port', default: 8643, advanced: true },
    ],
    secret: { key: 'token', label: '连接令牌', hint: '填进 NapCat 的 Token 栏' },
    guide: [
      '准备一个 QQ 小号，用来给她住。',
      { text: '安装 NapCat，用小号登录。大肥鱼不下载、不内置 NapCat。', link: { label: 'NapCat 官方仓库', url: NAPCAT_URL } },
      '在 NapCat 的网络配置里新建“WebSocket 客户端”，地址填 ws://127.0.0.1:{port}，Token 点下面的“复制”粘贴进去。',
      '回到这里，填上你自己的 QQ 号（大号），点“连接”。',
      '用大号给小号发一句话。看到状态变成“已连接”并收到她的回复，就成功了。',
    ],
  },
  {
    id: 'wechat',
    name: '微信',
    group: 'chat',
    availability: 'soon',
    stage: '下一期',
    color: '#07c160',
    mark: '微',
    desc: '在微信里和你聊天。走腾讯官方的接口，扫码登录。',
    does: ['和你私聊', '想你了主动在微信上找你'],
    risk: '需要你的微信扫码授权；授权可以随时在手机上解除。',
    login: '扫码登录（开放后在这里显示二维码）',
    fields: [{ key: 'proactive', label: '允许她主动在微信上找你', type: 'bool', default: true }],
    guide: ['点“连接”，这里会出现一个二维码。', '用微信扫码，在手机上确认。', '给她发一句话，收到回复就成功了。'],
  },
  { id: 'bilibili', name: 'B 站', group: 'content', availability: 'planned', stage: '阶段 4', color: '#fb7299', mark: 'B', desc: '自己刷视频、看字幕“吃饭”，把看到的有意思的东西讲给你听。', does: ['看视频、读字幕和弹幕', '发评论（要你同意）'], risk: '用的是你提供的账号，发言过多可能触发风控。', fields: contentFields() },
  { id: 'novel', name: '小说', group: 'content', availability: 'planned', stage: '阶段 4', color: '#c9853f', mark: '书', desc: '读你推荐的小说，读完写读后感，记住剧情和人物。', does: ['读本地 txt、epub 或你给的链接', '每章写读书笔记'], risk: '只读你给她的书。', fields: contentFields(false) },
  { id: 'douyin', name: '抖音', group: 'content', availability: 'planned', stage: '阶段 5', color: '#25f4ee', mark: '抖', desc: '刷短视频，偶尔留言。', does: ['刷视频', '留言（要你同意）'], risk: '没有开放接口，只能模拟网页操作，风控风险高。', fields: contentFields() },
  { id: 'xiaohongshu', name: '小红书', group: 'content', availability: 'planned', stage: '阶段 5', color: '#ff2442', mark: '红', desc: '看笔记、收藏喜欢的东西。', does: ['看笔记', '评论（要你同意）'], risk: '没有开放接口，只能模拟网页操作，风控风险高。', fields: contentFields() },
  { id: 'x', name: 'X', group: 'content', availability: 'planned', stage: '阶段 5', color: '#8899a6', mark: 'X', desc: '关注感兴趣的话题。', does: ['刷动态', '发帖和回复（要你同意）'], risk: '读取需要付费的官方接口。', fields: contentFields() },
  { id: 'youtube', name: 'YouTube', group: 'content', availability: 'planned', stage: '阶段 5', color: '#ff0033', mark: '▶', desc: '看视频、学东西。', does: ['看视频、读字幕', '发评论（要你同意）'], risk: '发评论消耗每日配额。', fields: contentFields() },
];

const byId = (id) => PLATFORMS.find((p) => p.id === id);

/** 用户填的值 → 规范后的值；错误用人话写 */
function validate(id, values = {}) {
  const p = byId(id);
  if (!p) return { ok: false, errors: { _: '没有这个平台' }, values: {} };
  const out = {};
  const errors = {};
  for (const f of p.fields) {
    const v = values[f.key];
    if (f.type === 'bool') {
      out[f.key] = v == null ? !!f.default : !!v;
    } else if (f.type === 'digits') {
      const s = String(v ?? '').trim();
      if (!s) { if (f.required) errors[f.key] = `请填${f.label.replace(/（.*）/, '')}`; continue; }
      if (!/^\d+$/.test(s) || s.length < f.min || s.length > f.max) { errors[f.key] = `QQ 号是 ${f.min} 到 ${f.max} 位数字`; continue; }
      out[f.key] = s;
    } else if (f.type === 'digits-list') {
      const list = String(Array.isArray(v) ? v.join(',') : v ?? '').split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
      const bad = list.filter((x) => !/^\d+$/.test(x) || x.length < f.min || x.length > f.max);
      if (bad.length) { errors[f.key] = `群号是 ${f.min} 到 ${f.max} 位数字，这些不对：${bad.slice(0, 3).join('、')}`; continue; }
      out[f.key] = [...new Set(list)];
    } else if (f.type === 'port') {
      const n = v == null || v === '' ? f.default : Number(v);
      if (!Number.isInteger(n) || n < 1024 || n > 65535) { errors[f.key] = '端口要在 1024 到 65535 之间'; continue; }
      out[f.key] = n;
    }
  }
  return { ok: !Object.keys(errors).length, errors, values: out };
}

/**
 * 给界面的清单：定义 + 当前设置 + 显示状态。令牌只给“有没有”，不给内容。
 * @param {object} saved  settings.channels
 * @param {(name:string)=>boolean} hasSecret
 */
function list(saved = {}, hasSecret = () => false) {
  return PLATFORMS.map((p) => {
    const values = saved[p.id] || null;
    const status = p.availability === 'planned' ? 'planned' : values ? 'saved' : 'unset';
    const defaults = validate(p.id, {}).values;
    return {
      ...p,
      values: { ...defaults, ...(values || {}) },
      status,
      secretSet: p.secret ? hasSecret(`channel:${p.id}:${p.secret.key}`) : false,
    };
  });
}

module.exports = { PLATFORMS, NAPCAT_URL, byId, validate, list };
