// 生成内嵌 DSH 的 cordis.yml：按白名单，从模板 dsh/cordis.template.yml 填出来。
// 规矩：模型地址只能是本机的生命网关；YAML 里不放任何密钥；插件只能来自 ALLOWED_PLUGINS。

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', '..', '..', 'dsh', 'cordis.template.yml');

/** 这一期允许出现在配置里的插件，就是 E0 得出的最小清单 */
const ALLOWED_PLUGINS = Object.freeze(['@deepseek-ai/dsh-sdk-jsonrpc-server', '@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-agent-spine-demo']);

/** 阶段 G 的通道插件会加进这里；这一期是空的，所以 channels 只能传空数组 */
const ALLOWED_CHANNEL_PLUGINS = Object.freeze([]);

/** 能动电脑的插件：执行命令、读写文件、上网、子智能体、MCP、技能、热改配置。测试保证它们一个都不出现 */
const FORBIDDEN_PLUGINS = Object.freeze([
  'dsh-tool-bash', 'dsh-tool-pwsh', 'dsh-terminal', 'dsh-tool-str-replace-editor', 'dsh-fs-local', 'dsh-tool-web',
  'dsh-web-fetch', 'dsh-subagent', 'dsh-tool-jobs', 'dsh-mcp-client', 'dsh-tool-skill', 'dsh-tool-cordis',
]);

const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

/**
 * @param {{gatewayUrl:string, channels?:Array<{id:string, name:string, config?:object}>}} opts
 * @returns {string} cordis.yml 的内容
 */
function buildConfig({ gatewayUrl, channels = [] } = {}) {
  if (!LOCAL_URL.test(String(gatewayUrl || ''))) throw new Error(`DSH 的模型地址只能是本机的生命网关，收到的是：${gatewayUrl}`);
  for (const c of channels) {
    if (!ALLOWED_CHANNEL_PLUGINS.includes(c.name)) throw new Error(`这个通道插件不在白名单里：${c.name}`);
  }
  const channelYaml = channels.length ? channels.map((c) => `- id: ${c.id}\n  name: '${c.name}'\n`).join('\n') : '';
  return fs
    .readFileSync(TEMPLATE, 'utf8')
    .replace("'{{GATEWAY_URL}}'", `'${gatewayUrl}'`)
    .replace('# {{CHANNELS}}', channelYaml || '# （没有通道）');
}

/** 读回配置里的插件名（测试和内核页用；模板结构固定，按行取就够了） */
function pluginNames(yaml) {
  return [...yaml.matchAll(/^\s*name:\s*'([^']+)'/gm)].map((m) => m[1]);
}

/** 写到 <userData>/dsh/profile/cordis.yml，返回路径 */
function writeConfig({ userData, gatewayUrl, channels = [] }) {
  const dir = path.join(userData, 'dsh', 'profile');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'cordis.yml');
  fs.writeFileSync(file, buildConfig({ gatewayUrl, channels }), 'utf8');
  return file;
}

module.exports = { buildConfig, writeConfig, pluginNames, ALLOWED_PLUGINS, ALLOWED_CHANNEL_PLUGINS, FORBIDDEN_PLUGINS, TEMPLATE };
