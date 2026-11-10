# DSH 嵌入实验（阶段 E0）

> 2026-11-10。实验目录在仓库外（会话临时目录），`DSH_HOME` 一律指到实验目录里的 `home/`。没有碰 `~/.dsh`。

## 先说结论

| 编号 | 问题 | 结论 |
| --- | --- | --- |
| 1 | Electron 45 当 Node 用能不能跑 DSH | **能**。`ELECTRON_RUN_AS_NODE=1` + `electron.exe` 运行 `dsh-jsonrpc-agent`，SDK 握手 350–420 ms |
| 2 | `baseURL` 指向本机后请求长什么样 | 标准 DeepSeek 流式请求，一个系统提示词 + 用户消息，见下文。夹具：`apps/desktop/test/fixtures/dsh-chat-request.json` |
| 3 | DSH 会不会自己发别的请求 | **不会**。连发 30 句（同一会话，历史涨到 60 条），30 个请求全是 `POST /chat/completions`，没有标题、压缩、余额、模型列表 |
| 4 | 最小配置需要哪些插件 | **3 个**：`dsh-sdk-jsonrpc-server`、`dsh-llm-deepseek`、`dsh-agent-spine-demo`（关掉它自带的 bash、任务、技能、工作区文件、目标）。没有终端组件，不需要找你商量 |
| 5 | 打包后能不能跑 | **能**（E6 实测）。打包后依赖解压 14 MB，便携版 exe 从 163.6 MB 变成 164.9 MB。要点见下面“打包” |
| 6 | 关闭和崩溃 | 父进程硬退出时，子进程因为标准输入断开自己退出，没有残留。杀子进程后的重启由我们的运行时负责，在 E3 的测试里验证 |

## 版本：计划里写的组合装不上，改用 0.0.1 这一条线

计划里写的是 `dsh-sdk-jsonrpc-demo@0.0.1-rc.5`、`dsh-sdk-client@0.0.1-rc.1`、`dsh-sdk-minimal@0.1.2-alpha.2`。前两个属于 0.0.1 线（要求 `dsh-invariants` 0.0.x），第三个属于 0.1 线（要求 0.1.x），npm 报 peer 冲突装不上。

DSH 每个包有三条发布线：`latest` 标签指向 0.0.1（2026-08 发布，互相一致），`next` 指向 0.2.2-rc.1（2026-11-04），中间还有 0.1.x。选择 **0.0.1 线**：

- 是 npm 的 `latest`，各包之间版本一致，一次装好。
- 0.2.2 线的 `dsh-sdk-client` 依赖整个 `@deepseek-ai/dsh`（解压 832 MB），不可接受。
- `dsh-sdk-minimal` 在这里只是参考它的插件清单，不需要装。

实际装的包（全部写死版本）：

```
@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5
@deepseek-ai/dsh-sdk-client@0.0.1-rc.1
@deepseek-ai/dsh-sdk-jsonrpc-server@0.0.1-rc.5
@deepseek-ai/dsh-llm-deepseek@0.0.1-rc.5
@deepseek-ai/dsh-agent-spine-demo@0.0.1-rc.5
```

npm 自动装上的 peer 依赖一共 56 个 `@deepseek-ai/*` 包加 8 个第三方包，`node_modules` 共 17 MB。许可证：DSH 各包 BSD-3-Clause，cordis 系列 MIT，第三方 MIT / ISC / Python-2.0（argparse）。没有 AGPL，没有原生模块（没有 node-pty）。

## 最小 cordis.yml 全文

```yaml
- id: jsonrpc
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DFY_GATEWAY_TOKEN
    baseURL: !!js process.env.DFY_GATEWAY_URL
    thinking: disabled
    models:
      - id: deepseek-chat
- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    includeHarnessIdentity: false
    persona: 'gateway'
    workspaceContext: false
    skills:
      enabled: false
    toolBash: false
    toolJobs: false
```

`agent-spine-demo` 按这份配置实际挂载的子插件（读了它的 `lib/index.js`）：计时器、LLM 服务、会话存储（内存）、会话标题（确定性后备，不调模型）、系统提示词、工具注册表（空）、智能体注册表、LLM 重试、通用后台任务注册表（没有执行器）、不变式检查、智能体循环。**没有挂载**：技能文件系统、工作区说明文件读取（AGENTS.md）、bash 工具和 shell 环境、技能工具、任务工具、目标。

磁盘上仍会有 `dsh-tool-bash`、`dsh-shell`、`dsh-subprocess`、`dsh-sandbox` 这几个包（spine 在模块顶层 import 它们，所以是必需的 peer），但它们只提供接口定义，没有挂载，也没有任何执行器实现在包里。

## 请求长什么样（问题 2）

```http
POST /chat/completions
authorization: Bearer <DFY_GATEWAY_TOKEN>
accept: text/event-stream
user-agent: deepseek-harness/0.0.1-rc.5 (+https://github.com/deepseek-ai/deepseek-harness)
x-deepseek-harness-user-id: <匿名 id，存在 DSH_HOME/.anonymous-user-id>
x-deepseek-harness-session-id: <会话 id>
```

```json
{
  "model": "deepseek-chat",
  "messages": [{ "role": "system", "content": "gateway" }, { "role": "user", "content": "你好 0" }],
  "stream": true,
  "stream_options": { "include_usage": true },
  "thinking": { "type": "disabled" },
  "max_tokens": 256000,
  "tools": []
}
```

- 路径是 `baseURL` 后面直接接 `/chat/completions`（没有 `/v1`）。
- 适配器只用流式；必须以 `data: [DONE]` 结尾，否则报 `STREAM_CLOSED`；没有任何文字的回复会被当成 `EMPTY_RESPONSE` 自动重试。
- 第一次请求带 `tools: []`，之后的请求连 `tools` 字段都没有。
- 压缩请求会带请求头 `x-deepseek-harness-compact: 1`（我们没装压缩插件，30 句里一次都没出现）。网关仍按这个请求头把它判成非聊天。

## 对网关和运行时的影响

- 网关只会收到 `POST /chat/completions`。不需要实现余额、模型列表接口，其他路径一律 404。
- 同一会话里 DSH 会把历史全部带上（第 30 句时 60 条）。网关只取最后一条用户消息，所以不影响她；但为了不让 DSH 自己的内存一直涨，**每句话用新会话**（`run()` 不传 `sessionId`，SDK 默认就是新会话）。
- `DSH_HOME` 里只会写 `.anonymous-user-id` 一个文件。
- 子进程的工作目录要设成 `cordis.yml` 所在目录以外的一个空目录：启动时会读当前目录的 `.env`（`loadEnv`）。
- 插件按 `cordis.yml` 所在目录做 Node 模块解析，所以 `cordis.yml` 要放在能找到 `node_modules/@deepseek-ai/*` 的位置，或者在配置里写绝对路径。打包后的做法在 E6 决定。
- 客户端是 ES 模块，主进程（CommonJS）用 `await import()` 加载。
- `HarnessClient` 把子进程放在 `client.child`：运行时用它拿进程号、监听退出、把标准错误抄到 `dsh.log`。

## 打包（E6 实测）

- `asarUnpack` 加 `node_modules/**`：子进程是“大肥鱼.exe 当 Node”，它按普通 Node 规则从 `app.asar.unpacked` 里找模块，找不到 asar 里面的。生产依赖只有 DSH 这一套，所以整个 `node_modules` 解开。
- **electron-builder 不会带上 peer 依赖。** 第一次打包只带进去 8 个 DSH 包（一共要 56 个）。解决：把运行要用到的 64 个包（56 个 DSH + 8 个第三方）全部写进 `dependencies`，版本写死。单元测试“DSH 打包”从已安装的包重新算一遍依赖闭包，和 `dependencies` 对不上就失败。
- `build.files` 加 `dsh/**/*`（配置模板）。
- 打包后的便携版实测：内核页启动内核、通过内核说一句话，回复正常出现在页面和聊天栏；退出后没有残留进程。

## 插件名解析：子进程要加 `--expose-internals`

`cordis.yml` 放在数据目录（`<userData>/dsh/profile/`）里，那里没有 `node_modules`。DSH 的 `packaged-bin.js` 支持“按安装目录解析插件名”，但这条路要用到 Node 内部的模块加载器：要么装原生模块 `node-addon-require-builtin`，要么给 Node 加 `--expose-internals`（插件加载器里明确支持这两种）。我们不装原生模块，子进程的参数是 `--expose-internals packaged-bin.js <cordis.yml>`。不加的话，三个插件全部报“could not be resolved”，而且标准错误里没有更多细节。

## 踩到的坑

- npm 的 peer 冲突（见上面版本一节）。
- `DeepSeekHarness.run()` 不传 `sessionId` 时每次都开新会话，传了固定 id 就累积历史。
