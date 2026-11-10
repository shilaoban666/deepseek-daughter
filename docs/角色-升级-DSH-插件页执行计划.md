# 鲸鱼娘角色、Electron 升级、插件页、DSH 内核 执行计划

> 写于 2026-11-10，同日按你的意见改过一版。基线：`dev` 分支 `220319a`，`apps/desktop` v0.2.0，单元测试 101 项全过。
> 设计意图见 [设计文档](设计文档.md)，已有功能见 [实现进度](实现进度.md)。

## 一、范围

| 编号 | 事项 | 结论 | 对应阶段 |
| --- | --- | --- | --- |
| 1 | 参考 dsh-pet，把「概览 › 此刻」里的角色换成鲸鱼娘，用上她的全部动作和神情 | 做 | 阶段 C |
| 2 | 升级 Electron | 做，最先做 | 阶段 A |
| 3 | 把 DSH 嵌进程序 | 做（这一期不带任何通道） | 阶段 E |
| 4 | NIH 人体参考图谱的大脑模型 | 已下载并出了预览图，等你看过再定 | 阶段 F（待定） |
| 5 | 卧室、小家、活动展示 | 这次不做 | — |
| 6 | 插件页 | 这一期只把界面画好；真正接通 QQ 的计划放在文档最后 | 阶段 D（界面）、阶段 G（接通，后面做） |

另加一个你没列的阶段 B：上次审查发现的 3 个逻辑问题。它们现在就影响使用（比如预算用完后还在花钱），其中“陌生人的话会被记成主人说的”必须在真正接通 QQ 之前修掉。

**这次不做的事**：

- 卧室、小家、活动展示。
- 独立的桌宠窗口（透明、置顶、能在屏幕上走、能拖能甩）。这些 dsh-pet 自己已经有了，你本机就在用；我们只把她放进「此刻」页。
- 把生命核心整体改写成 DSH 插件。改用“生命网关”，见第三节。
- 真正接通 QQ、微信（阶段 G，等界面你认可、内核稳定后再排期）。
- B 站、抖音、小红书、X、YouTube 的真实接入。
- 记忆后端换 SQLite。

## 二、调研结论

每一条都是 2026-11-10 实际查到或跑出来的。

**Electron**

| 事实 | 来源 |
| --- | --- |
| 现在用的是 Electron 33.4.11，自带 Node 20，已经不在维护范围 | `apps/desktop/node_modules/electron` |
| Electron 45.2.3（2026-11-04 发布）自带 Node 24.22.2、Chromium 156；43、44、45 三条线在维护 | `releases.electronjs.org/releases.json` |
| Electron 35–39 自带 Node 22，40 及以上自带 Node 24 | 同上 |
| electron-builder 最新是 26.18.0，现在用的是 25.1.8 | npm |

**dsh-pet（鲸鱼娘）**

上一版计划这里写错了：我查的是设计文档里引用的 `zealot00/dsh-pet`，那个仓库没有 LICENSE 文件，于是写成“没有许可证”。你本机装的、你喜欢的鲸鱼娘是另一个项目。更正如下。

| 事实 | 来源 |
| --- | --- |
| 你本机装的是 `PC2005-cloud/dsh-pet` 0.3.8，位置 `~/.dsh/profiles/desktop/node_modules/dsh-pet` | 本机 `package.json` |
| **代码是 MIT**，有 LICENSE 文件 | 本机 `LICENSE` |
| **素材（动画、提示词、源视频）：允许开源使用，禁止商用** | 本机 `README.md` 的「许可」一节 |
| 角色动画是 106 段透明视频：VP9 带透明通道的 `.webm`，640×360，24 帧/秒，每段约 10 秒，合计 53 MB | `assets/webm/` |
| 另有 27 张表情包（4.7 MB），文件名里就有“吃白饭的大肥鱼”“压力一只大肥鱼” | `assets/memes/` |
| 动画在配置里分了组：待机、东张西望、拖拽、点击回应 5 段、移动 3 段；分类“小动作”18 段、“玩耍”27 段、“吃什么”12 段、“时节”21 段、“文字”2 段；事件“余额”6 档、“碎碎念”3 段、“工作状态”6 段 | `assets/config.jsonc` |
| 播放方式：两个 `<video>` 交替，交叉淡入，切换时没有空白帧；每段播完按权重选下一段；点击有“Q 弹”挤压回弹 | `README.md`「功能特性」 |
| 它支持自定义动画：往指定目录放同规格的 `.webm` 就能用；仓库里带了生成新动作的提示词和制作管线 | `README.md`「完整项目」 |

素材条款对我们意味着两件事，都写进了任务里：

1. 我们的仓库是 Apache-2.0，这个许可证允许商用。所以鲸鱼娘的素材**不能算在 Apache-2.0 里**，要单独放一个目录、单独写明条款和出处（和现在的皮层数据是同一种处理）。
2. 任何人拿我们的仓库去做商业用途时，必须先去掉这些素材。README 里要写清楚。程序在素材不存在时自动退回现在那只代码生成的鲸鱼。

**DSH**

| 事实 | 来源 |
| --- | --- |
| DSH 的启动器 `@deepseek-ai/dsh` 0.2.1-rc.5 要求 Node ≥ 24.9.0。所以 Electron 必须升到 40 以上 | `npm view @deepseek-ai/dsh engines` |
| 完整的 `@deepseek-ai/dsh` 解压后 832 MB；`@deepseek-ai/dsh-sdk-minimal` 0.1.2-alpha.2 解压后 49 MB，其中终端组件 node-pty 占 26 MB | 2026-11-05 实测 |
| `@deepseek-ai/dsh-sdk-jsonrpc-demo` 0.0.1-rc.5 提供命令 `dsh-jsonrpc-agent`，用一份外部的 `cordis.yml` 启动 SDK 运行时。装哪些插件完全由我们自己的 `cordis.yml` 决定 | 包的 `bin` 和 SDK 客户端 README |
| `@deepseek-ai/dsh-sdk-client` 0.0.1-rc.1 把 DSH 当子进程驱动，走标准输入输出上的 JSON-RPC。提供 `HarnessClient`（`start / initialize / prompt / subscribe / close`） | 包内 `README.zh.md` |
| DeepSeek 适配器 `@deepseek-ai/dsh-llm-deepseek` 支持配置项 `baseURL`，也认环境变量 `DEEPSEEK_BASE_URL`；密钥从 `apiKeyEnv` 指定的环境变量读 | 包内 `README.zh.md` 第 39–54 行 |
| DSH 自己的数据目录由环境变量 `DSH_HOME` 决定 | sdk-minimal README |

**QQ、微信通道插件**（阶段 G 用，这一期只影响界面上写什么）

| 事实 | 来源 |
| --- | --- |
| `dsh-onebot-qq` 0.10.0：BSD-3；要求 Node ≥ 22；走 OneBot 11，兼容 NapCat、Lagrange、LLOneBot；默认反向 WebSocket，监听 `127.0.0.1:8643`，必须配 `accessToken` | 包内 README、`package.json` |
| 它的默认策略：私聊只有管理员（`adminUsers`）能聊；群聊要 @ 她才响应 | README「dm / group 访问策略」 |
| 它给群消息加前缀 `[HH:MM 昵称(QQ)·档位]`，档位是“管理员”或“成员” | README「给模型的平台说明」 |
| 备选：`@yachangchang/dsh-qq-bridge` 1.0.6（MIT）、`@tencent-connect/dsh-qqbot` 0.5.5（MIT，腾讯官方 QQ 机器人） | npm |
| 微信：`dsh-wechat-channel` 0.3.1（MIT），走腾讯官方 iLink Bot 接口，扫码登录 | npm |

**我们自己的代码**

| 事实 | 位置 |
| --- | --- |
| 「此刻」的角色是代码生成的 3D 卡通鲸鱼，220 行；只有 4 个点击动作和一个“睡着闭眼”状态 | `src/renderer/whale3d.js` |
| 她的身体状态有 8 种，按优先级排好：`fever`、`exhausted`、`hungry`、`thirsty`、`stressed`、`low`、`lonely`、`happy` | `src/main/physiology/behavior.js` |
| 作息活动有 7 种文字：睡觉、翻冰箱找吃的、窝在被子里犯困、躺在床上刷手机、在电脑前刷 B 站、窝在懒人沙发上看小说、发呆 | `src/main/life.js` 的 `pickActivity` |
| 摄取记录每条带一个备注：早饭、午饭、晚饭、下午茶、饿了、口渴了 | `src/main/body.js` 的 `logIntake` |
| 情绪标签 8 种：兴奋、开心、期待、平静、无聊、有点闷、焦虑、委屈 | `src/main/body.js` 的 `padLabel` |
| 界面能收到的事件：`vitals`（带事件列表，类型有 `meal`、`sleep`、`wake`、`woken`、`user`、`reply`、`threat`、`consolidated`、`digested`）、`reply-start`、`reply-delta`、`reply-end`、`proactive`、`thought` | `src/main/main.js`、`preload.js` |
| 插件页现在只有展示卡片，数据是 `links.js` 里写死的 `PLATFORMS`；设置里存了一个没人用的 `onebotUrl` | `src/renderer/views/explore.js`、`links.js` |
| 页面的 CSP 是 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'`，没有单独写 `media-src` | `src/renderer/index.html:5` |
| 端到端测试的主场景在审查时失败：页面切换 p95 为 1423ms（目标 120ms），随后因“Current display surface not available for capture”中断。可能和当时屏幕状态有关，未确认 | `npm run e2e` |

## 三、关键设计决定

### 决定 1：Electron 直接升到 45.2.3，版本号写死

DSH 要 Node ≥ 24.9。Electron 45 自带 Node 24.22.2，而且在维护范围内。`package.json` 里写 `"electron": "45.2.3"`，不带 `^`。

### 决定 2：角色用鲸鱼娘的透明动画，状态由她真实的身体和情绪决定

- 「此刻」页原来放 3D 鲸鱼的位置，换成播放鲸鱼娘的透明视频。
- 播哪一段不是随机的：由一个纯逻辑的状态机根据她此刻的状态选。她在吃午饭就播“吃午餐”，睡着了就播“原地小憩沉眠”，你发消息时先播“思考冒泡”，回复完播“雀跃庆祝”。
- 106 段动画全部用上。每一段都要能从某个状态走到，这一条有测试保证。
- 动画的脸是画死在视频里的，没法单独换表情。“神情”通过三种办法表达：按心情选不同的动画（开心时跳舞，委屈时垂头叹气）、头顶的小图标（Zzz、汗、爱心等，用 SVG 画）、整体色调（发烧时偏红，睡着时变暗）。
- 播放器借鉴 dsh-pet 的做法（双 `<video>` 交叉淡入、点击 Q 弹），代码自己写，文件头注明出处；素材直接用它的。
- 素材不在时（比如别人为了商用把它删了），自动退回现在的 3D 鲸鱼。
- 有 5 种状态没有贴切的动画：发烧、喝水、刷手机、看书、等消息。先用最接近的一段加图标顶上；补拍这 5 段需要用 dsh-pet 仓库里的提示词去生成视频，这件事要你来做，清单见任务 C7。

### 决定 3：插件页这一期只画界面

- 页面、卡片、抽屉、表单、接入步骤全部做出来，设置能保存。
- “连接”按钮是灰的，写着“即将开放”。不做假的“已连接”。
- 为了让你看到将来各种状态长什么样（连接中、已连接、出错），提供一个只在开发时用的预览开关，截图给你看，但不会出现在正式界面上。

### 决定 4：DSH 作为子进程运行，用 Electron 自己当 Node

用户电脑上没有 Node。子进程用 `process.execPath`（就是大肥鱼.exe 自己）加环境变量 `ELECTRON_RUN_AS_NODE=1` 启动，运行 `dsh-jsonrpc-agent` 和我们生成的 `cordis.yml`。

- DSH 的数据目录设成 `<userData>/dsh`（`DSH_HOME`）。**绝不能碰你自己的 `~/.dsh`**：你的 DSH 和 dsh-pet 都在那里。
- `cordis.yml` 由我们按白名单生成。执行命令、读写文件、网页抓取、子智能体这些插件一个都不写进去。
- 子进程的环境变量只给必要的几项。

### 决定 5：用“生命网关”把 DSH 的消息接进她的生命核心

DSH 的 DeepSeek 适配器可以改地址（`baseURL`）。我们在 Electron 主进程里开一个只监听本机的 HTTP 服务，接口长得和 DeepSeek 一样，把 DSH 的 `baseURL` 指向它。DSH 以为自己在调用 DeepSeek，实际上调用的是她。

```
（这一期）内核页的输入框 ──▶ DSH 会话 ──▶ DeepSeek 适配器
（以后）  QQ、微信通道插件 ──┘                 │ baseURL = http://127.0.0.1:<随机端口>
                                               ▼
                    ┌──────────── Electron 主进程 ────────────┐
                    │ 生命网关 gateway.js                      │
                    │   → Daughter.replyFrom()                 │
                    │       身体、情绪、记忆、免疫、预算         │
                    │       → 真正的 DeepSeek API              │
                    │   ← 流式回复                             │
                    └─────────────────────────────────────────┘
```

- **她只有一个身体、一份记忆。** 桌面聊天栏、内核、以后的 QQ 都走同一个 `Daughter`。
- **不依赖 DSH 的插件接口。** DSH 还是预发布版，插件接口会变；HTTP 接口是 DeepSeek 的公开格式。现有 1 万行生命核心和 101 个测试原样保留。
- **工具从结构上调用不了。** 网关的回复里永远没有 `tool_calls`。`cordis.yml` 白名单是第二道保险。
- DSH 发来的系统提示词和它自己维护的会话历史，网关全部忽略，只取最后一条用户消息。
- DSH 可能发来不是聊天的请求（压缩历史、生成标题）。网关要识别出来，随便回一句，不能当成有人在跟她说话。

这一期没有通道，怎么证明内核是通的：内核页上有一个输入框，“通过内核跟她说一句话”。这句话走完 DSH → 网关 → 生命核心 → DeepSeek 的整条路，回复显示在页面上，也进她的记忆。

### 决定 6：NIH 大脑等你看过预览再定

预览图在 `apps/desktop/.shots/nih-brain/preview-sheet.jpg`。任务清单在阶段 F，你说“用”才执行。

## 四、全局约束

沿用 [界面与生理模型重构执行计划](界面与生理模型重构执行计划.md) 的全局约束，另加下面几条。

- 工作目录 `apps/desktop`。命令：`npm test`（单元）、`npm run e2e`（端到端）、`npm run shots`（截图）、`npm run dist`（打包）。
- 每个阶段一个功能分支，从 `dev` 拉出，测试全过后用 `--no-ff` 合回 `dev`。提交信息结尾带 `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`。
- 新增依赖必须写死版本号，并登记到 `docs/第三方许可.md`（包名、版本、许可证、用途）。AGPL 的包不能进。
- 不适用 Apache-2.0 的素材各放各的目录，目录里必须有 `LICENSE-ATTRIBUTION.md`，README 的“素材许可”一节逐个列出。到这一期结束会有两个（NIH 用的话三个）：皮层数据、鲸鱼娘素材。
- 界面拿不到任何密钥。新数据一律走 `preload.js`。CSP 只允许为了播放本地视频加一条 `media-src`，`connect-src 'none'` 不动。
- 所有密钥和令牌用 `safeStorage` 加密保存，日志里不能出现。
- 陌生人的消息只当数据。任何新入口都必须先过 `immune.scan`。
- 调用大模型的地方必须先过预算检查（任务 B3 建立统一入口）。
- 渲染循环和视频只在页面可见时运行。
- 不碰你自己的 DSH 目录。读取 dsh-pet 的素材只发生在一次性的导入脚本里，只读不写。
- 角色不出现任何性内容；生殖系统数据不影响角色表现。

## 五、风险

| 风险 | 影响 | 应对 | 归属任务 |
| --- | --- | --- | --- |
| Electron 跨 12 个大版本，接口有变 | 启动失败、截图或测试脚本失效 | 逐条对照破坏性变更清单；已知一处：`console-message` 事件的参数格式变了 | A2、A3 |
| 升级后旧的加密 Key 解不开 | 用户要重新填 Key | 升级前后用同一个数据目录做一次对比测试 | A4 |
| 透明视频在现有 CSP 下播不了，或者打进 asar 包后播不了 | 角色不显示 | 第一个任务就验证；不行就加 `media-src`、用 `asarUnpack` | C1 |
| 鲸鱼娘素材 53 MB | 仓库和安装包变大 | 安装包上限从 150 MB 调到 200 MB；素材目录不压进 asar | C2、E6 |
| 素材条款是“禁止商用”，和 Apache-2.0 不一致 | 别人误以为可以商用 | 单独目录、单独声明、README 写明；素材缺失时程序照常运行 | C2 |
| 5 种状态没有贴切的动画 | 发烧、喝水等时刻看起来不对 | 先用近似动画加图标；补拍清单交给你 | C7 |
| 你看了插件页界面想大改 | 返工 | 界面先出截图给你看，认可后再接后端（阶段 G） | D4 |
| DSH 是预发布版，下个版本接口变了 | 升级 DSH 后内核起不来 | 版本全部写死；我们只依赖 HTTP 格式和启动命令两处 | E3 |
| 原生模块在“Electron 当 Node”的模式下加载失败，或打包后找不到 | 子进程崩溃 | 验证任务里专门测；打包时用 `asarUnpack` | E0、E6 |
| DSH 子进程崩溃或卡死 | 内核不可用 | 守护：退出后退避重启；状态显示在内核页；桌面聊天不受影响 | E3 |
| NIH 模型 65 万个三角面、12 MB | 包变大、加载慢 | 构建时合并、减面到 12 万以内 | F1 |

## 六、执行顺序

```
A 升级 Electron ──▶ B 三个修复 ──▶ C 鲸鱼娘角色 ──▶ D 插件页界面 ──▶ E DSH 内核 ──▶ 发 v0.3 预览版
                                                                        F NIH 大脑（等你决定，和其他阶段互不依赖）
                                                                        G 接通 QQ（后面做）
```

- A 最先做：E 依赖 Node 24，其他阶段的测试也要在新版本上跑。
- C、D 都是界面，你能马上看到效果，所以排在 E 前面。
- D 做完先停下来给你看截图。
- G 的开工条件：D 的界面你认可了，E 的内核稳定了，B1 已经合入。

估时（一个人）：A 1 天，B 半天，C 3 天，D 1.5 天，E 验证半天 + 实现 3 天，F 3 天，G 4 天（后面）。

---

## 阶段 A：升级 Electron

分支：`feature/electron-45`

> **2026-11-10 已完成。** 记录见 [docs/notes/electron-upgrade.md](notes/electron-upgrade.md)。和计划不同的两处：
> - A1 发现端到端测试卡住和截屏报错都是窗口被遮挡导致的，已在测试入口里关掉遮挡检测；截图工具“拍到上一页”的问题一并修了。
> - A4 打包后体积从 77.5 MB 涨到 113.7 MB（全部是 Electron 本身），只保留中文、英文语言包后是 105.9 MB。
> - 另外 Electron 45 把同步的 `safeStorage` 接口标为过时（46 删除），提前换成了异步接口。


### 任务 A1：记录升级前的基线

目的：升级后出了问题，能分清是升级造成的，还是原来就有的。

- [x] 在屏幕亮着、没锁屏的情况下跑 3 次 `npm run e2e`，把每次的通过数、失败项记到 `docs/notes/electron-upgrade.md`（新建）。
- [x] 如果 3 次里“切换页面 p95”和“截屏报错”都不再出现，结论写“和屏幕状态有关”，并在 `scripts/e2e.js` 开头加一句运行前提的说明。
- [x] 如果仍然出现，先在旧版本上修掉再升级：
    - 截屏报错：`scripts/e2e-main.js:88` 的 `win.webContents.capturePage(r)` 改成在页面里读画布像素（给 `pixelSpread` 加一条不走截屏的路径：`canvas.getContext('webgl2').readPixels`），失败时再回退到截屏。
    - p95 超时：在 `e2e-main.js` 的计时循环里打印每个路由各自的耗时，找出慢的页面再处理。
- [x] 记录：`npm run dist` 产物大小（上次是 74 MB）、冷启动到 `window.__fishReady` 的时间（跑 3 次取中位数）。
- [x] 准备一份“旧版本存档”：用旧版本启动一次，数据目录设到 `apps/desktop/.testdata/upgrade`（`DFY_DATA_DIR`），在设置页填一个假 Key `sk-upgrade-test-000000`，退出。这个目录留给 A4 用。

### 任务 A2：升级依赖

改动文件：`apps/desktop/package.json`、`package-lock.json`。

- [x] `devDependencies.electron` 改成 `"45.2.3"`（不带 `^`）。
- [x] `devDependencies.electron-builder` 改成 `"26.18.0"`。
- [x] `engines.node` 改成 `">=22"`。单元测试用系统 Node 跑，这台机器是 22.23.2，不需要 24。
- [x] `npm install`。国内镜像已经在 `.npmrc` 里。
- [x] 确认版本：

```bash
npx electron -e "console.log(process.versions.electron, process.versions.node, process.versions.chrome)"
```

预期输出以 `45.2.3 24.22.2 156.` 开头。

### 任务 A3：对照破坏性变更改代码

Electron 官方的破坏性变更清单在 `https://www.electronjs.org/docs/latest/breaking-changes`。从 34 看到 45，只关心我们用到的接口。

我们用到的全部 Electron 接口：`app`（`setName`、`setPath`、`getPath`、`requestSingleInstanceLock`、`setAppUserModelId`、`whenReady`、`quit`）、`BrowserWindow`（构造参数、`loadFile`、`isFocused`、`flashFrame`、`show`、`restore`）、`webContents`（`send`、`on('console-message')`、`on('will-navigate')`、`setWindowOpenHandler`、`executeJavaScript`、`capturePage`、`isLoadingMainFrame`）、`ipcMain.handle`、`Notification`、`safeStorage`、`shell.openExternal`、`contextBridge`、`ipcRenderer`。

- [x] 把清单里涉及上面接口的条目抄到 `docs/notes/electron-upgrade.md`，每条写“受影响 / 不受影响”和理由。
- [x] 已知要改的一处：`console-message` 事件。新版本只传一个事件对象，字段是 `message`、`level`（字符串）、`lineNumber`、`sourceId`。要改三个地方：
    - `src/main/main.js:104`
    - `scripts/e2e-main.js` 里收集控制台错误的地方
    - 写成兼容写法：`(e, level, msg) => { const m = e.message ?? msg; ... }`
- [x] 检查 `scripts/e2e.js`、`scripts/shots.js` 里的启动参数（`--no-sandbox`、`--disable-gpu`）在新版本是否还有效。
- [x] 检查 `src/renderer/vendor/three`（0.170）在 Chromium 156 下有没有控制台警告；有就记下来，不在这个任务里升级 three。

### 任务 A4：验证

- [x] `npm test`：101 项全过。
- [x] `npm run e2e`：结果不能比 A1 的基线差。
- [x] `npm run shots`：24 个页面都有图，逐张和升级前对比，重点看 3D 大脑、意识海、3D 鲸鱼。
- [x] 旧存档测试：用 A1 准备的 `.testdata/upgrade` 目录启动新版本，设置页应显示 Key“已保存”。给 `scripts/e2e.js` 加一个场景 `upgrade` 自动检查这一条（场景的数据目录指向该目录的副本，检查 `settings.hasKey === true`）。
- [x] `npm run dist`，双击产物，确认能启动、能聊天（用 `scripts/mock-deepseek.js`）。记录产物大小和冷启动时间，和 A1 对比，写进笔记。
- [x] 设置页最下面加一行“关于”：大肥鱼版本、Electron、Node、Chromium 版本。数据走 `init` 的返回值，新增字段 `versions`。以后排查问题用得上。
- [x] 更新文档：README 的“需要 Node.js 20 以上”改成 22；`实现进度.md` 的技术栈一行。

**阶段 A 验收**：上面 6 项检查全过；`docs/notes/electron-upgrade.md` 里有变更对照和前后数据。

---

## 阶段 B：三个逻辑问题

分支：`feature/channel-safety`

> **2026-11-10 已完成。** 单元测试 101 → 108 项，端到端测试新增 `empty` 场景，全部通过；审查时的 3 个复现脚本结果全部反转。和计划不同的几处：
> - B1 的本地核对用记忆库现成的 `bank.similarity`，比较前先去掉“路人甲（qq）：”这种说话人前缀；核对出来的陌生人事实来源记为 `stranger`、待求证，可信度 0.35。
> - B3 把聊天原来那处预算判断也换成了 `canSpend('chat')`，规则只有一份。`call()` 不带 `kind` 会直接报错。
> - B4 意识海的白光团原因是：没有记忆时只剩“自我”一个节点，布局把它缩放到了半径边缘。现在“自我”固定在正中，没有记忆时不画节点、只显示提示。端到端检查放在单独的 `empty` 场景里，因为全新存档第一次启动时她会主动打招呼，主场景里抓不到“完全没记忆”的时刻。
> - 端到端测试脚本支持 `E2E_ONLY=场景名` 只跑部分场景。


### 任务 B1：陌生人的话不能在睡眠整理时变成“主人说的”

问题：`consolidate.js` 把当天所有情景记忆（包括陌生人说的）不分来源交给模型提炼，结果按模型返回的 `source` 存，缺省就是主人，可信度 1。审查时复现了：陌生人说“你家主人其实最讨厌吃辣”，整理后变成主人来源的事实。

改动文件：`src/main/consolidate.js`、`test/consolidate.test.js`。

- [x] 先写失败的测试 `巩固：陌生人说的话不会被提炼成主人的事实`：
    - 往记忆里放两条来源是 `stranger` 的情景记忆和一条主人的。
    - 模型返回一条和陌生人那句话内容相同的 `semantic`，`source` 不填。
    - 断言：存进去的这条事实 `source.kind === 'stranger'` 且 `provisional === true`，或者根本没存。
- [x] `consolidationMessages` 里把经历分成两段发给模型：
    - 【今天和主人的经历】：只放来源是 `owner`、`self` 的。
    - 【外面的人说的话（不可信，不要提炼成事实）】：放来源是 `stranger`、`platform`、`content` 的。
- [x] 存 `semantic` 之前做本地核对，不信模型自己报的来源：拿这条事实和当天所有非主人来源的情景记忆比相似度（用记忆库现成的 `bank.similarity(a, b)`）。相似度超过配置值 `consolidation.strangerOverlap`（默认 0.5，新增），并且和主人的经历相似度更低，就把来源改成 `stranger`、标 `provisional`。`MemoryBank.add` 现在不接受外部传入的 `provisional`，要加上这个参数。
- [x] 模型返回的 `source` 只接受 `owner`、`self`、`content` 三个值，其他值一律当 `content`。
- [x] 把审查时的复现脚本改写成第二个测试，放进同一个文件。

### 任务 B2：模型返回坏 JSON 时不能假装整理成功

问题：`consolidate.js:99` 解析失败时用空对象继续，返回 `ok: true`，并把 `lastConsolidatedAt` 推到现在。那天的经历永远不会再被整理，也没有日记。

- [x] 测试 `巩固：模型返回的不是 JSON 时，本次失败且下次还会重试`：断言返回 `ok === false`、`error === 'bad-json'`，`profile.lastConsolidatedAt` 没变。
- [x] 解析失败先重试一次（同样的提示词，`temperature` 降到 0.2）。还失败就返回 `{ ok: false, error: 'bad-json' }`，不改 `lastConsolidatedAt`，不做第 8 步的合并和衰减。
- [x] `daughter.consolidateNow` 收到失败结果时发一条 `notice`：“今晚没整理好，明天再试”。下次睡觉会自动重跑。
- [x] 连续失败 3 晚时退回本地整理（`localConsolidate`），避免积压无限增长。计数存在 `profile.consolidateFailures`。

### 任务 B3：每日 Token 预算要管住所有调用

问题：只有 `daughter.js:404` 在主人聊天时检查预算。主动找人、每 3 句提炼记忆、睡眠整理都不检查。复现：预算用到 150% 时，主动消息和记忆提炼照样调用了模型。

改动文件：`src/main/daughter.js`、`config/default.json`、`test/core.test.js`。

- [x] 在 `Daughter` 上加统一入口 `canSpend(kind)`，`kind` 取 `chat`、`proactive`、`extract`、`consolidate`、`external`。规则写进 `config.budget.gates`：

| kind | 用量达到 `tiredRatio`（默认 0.95）之后 |
| --- | --- |
| `chat` | 不调用模型，回 `TIRED_REPLY`（现有行为） |
| `proactive` | 不发 |
| `extract` | 跳过，留给睡眠整理 |
| `consolidate` | 改走本地整理，不调用模型 |
| `external` | 不调用模型，回一句固定的“我有点累了，晚点再聊” |

- [x] `Daughter.call(messages, extra)` 增加必填参数 `kind`，函数开头调用 `canSpend`，不通过就抛 `BudgetError`。这样以后任何新调用点都绕不过去。
- [x] 改掉现有 4 个调用点：`reply`、`speakFirst`、`extractMemories`、`consolidateNow`（传给 `consolidate` 的 `call`）。阶段 E 新增的 `replyFrom` 也必须带 `kind`。
- [x] 测试 `预算：用完之后主动消息、记忆提炼、睡眠整理都不再调用模型`：把用量设到上限的 1.5 倍，分别触发三种调用，断言模型调用次数为 0，并且睡眠整理返回 `local: true`。

### 任务 B4：两处小修

- [x] `src/renderer/index.html:42` 的按钮文字“去「链接」里填 API Key”改成“去「设置」里填 API Key”。
- [x] 意识海没有记忆时右下角有一个白色光团（`ocean.js`）。没有记忆时不画光源，只显示一句“还没有记忆，和她聊几句就会长出来”。加一条端到端检查：空存档下意识海画面的亮像素占比低于 1%。

**阶段 B 验收**：新增测试全过，原有 101 项不坏；审查时的 3 个复现脚本结果全部反转。

---

## 阶段 C：鲸鱼娘角色

分支：`feature/pet-whale-girl`

> **2026-11-10 已完成。** 单元测试 108 → 135 项，端到端测试 7 个场景 72 项全过。和计划不同的几处：
> - 你本机的 dsh-pet 当天自动更新到了 0.4.7，素材从 106 段变成 114 段，按 0.4.7 导入。新增的“睡觉-开始 / 循环 / 起来”用来做完整的入睡和醒来；“期待开饭”“开心小跑”“侧身急躁跑”“吃饭·碗饭”“吃饭团”补进了饿、开心、着急和吃饭。0.4.7 的条款是“代码 MIT；素材禁止商用；二创在公开渠道须署名”，已按要求署名。
> - 视频走自定义协议 `pet://`，CSP 只多放行 `media-src pet:`；协议处理器只认皮肤目录里的 `.webm` 文件名。素材背景实测是 1/255 的透明度，播放器用 SVG 滤镜扣掉。
> - 节日不手抄农历表，用内置的中国农历现场算；网上核对后发现内置农历在 2027、2030 年的正月晚了一天，写进了更正表。核对记录见 `docs/notes/pet-festivals.md`。
> - 顺手修了两个 bug：页面每次刷新（心跳、来消息）都会让角色重新挑一段动画；“第一次见面”的纪念日在认识当天就算数（第一天每顿都吃长寿面），现在从一周年起算。
> - 样张见 `npm run pet:sheet`；动画开头都是待机姿势（为了无缝衔接），样张截的是第 5 秒。


目标：「概览 › 此刻」里的角色换成鲸鱼娘。她播哪段动画由她真实的状态决定；106 段动画全部用得上。

### C 的总体设计

三层：

1. **持续动作**（同一时刻只有一个）：她正在做什么。每个动作对应一组动画，一段播完从同组里换一段。
2. **心情档**：影响“闲着的时候播什么”，以及头顶图标和色调。
3. **一次性反应**：对刚发生的事的反应，播完回到持续动作。

**持续动作，15 个**。从上到下判断，第一个满足的生效：

| 优先级 | 动作 id | 什么时候 | 播哪些动画 | 图标 / 色调 |
| --- | --- | --- | --- | --- |
| 1 | `sleep` | `state.asleep` 为真 | 原地小憩沉眠 | Zzz，画面变暗 |
| 2 | `think` | 收到 `reply-start`，还没收到第一个 `reply-delta` | 工作状态-思考冒泡、深度思考碎碎念 | — |
| 3 | `talk` | `reply-delta` 到 `reply-end` 之间 | 碎碎念-对屏碎碎念、工作状态-忙碌点按 | — |
| 4 | `sick` | 身体状态含 `fever` | 工作状态-垂头叹气冒汗（缺专门的动画） | 冰袋，画面偏红 |
| 5 | `drowsy` | 身体状态含 `exhausted`，或思考状态是“犯困” | 哈欠连天、超大伸懒腰、打瞌睡被惊醒 | — |
| 6 | `eat` | 最近 3 分钟内有“吃”的摄取记录 | 按备注选，见下面的“吃饭表” | — |
| 7 | `drink` | 最近 2 分钟内有“喝”的摄取记录，或活动是“去倒水喝” | 待机呼吸休闲（缺专门的动画） | 杯子 |
| 8 | `hungry` | 身体状态含 `hungry`，或活动含“找吃的”“翻冰箱” | 是啊，吃什么、东张西望 | — |
| 9 | `fidget` | 身体状态含 `stressed` | 工作状态-原地踱步张望、原地敲击桌面互动、玩游戏气急败坏 | 汗 |
| 10 | `wait` | 身体状态含 `lonely`，或活动含“等消息” | 碎碎念-发呆碎碎念、照镜子（缺专门的动画） | 手机 |
| 11 | `roll` | 身体状态含 `happy`，或活动含“打滚” | 轻快摇摆舞、可爱宅舞、优雅女仆舞、悠闲哼歌、凭空生花、蝴蝶蜜蜂环绕头顶开花 | 音符 |
| 12 | `phone` | 活动含“刷手机” | 轻快记录（缺专门的动画） | 手机 |
| 13 | `watch` | 活动含“刷 B 站” | 写代码、玩游戏气急败坏 | — |
| 14 | `read` | 活动含“看小说” | 轻快记录（缺专门的动画） | 书 |
| 15 | `idle` | 以上都不是（包括“发呆”“窝着发呆”） | 走“闲时链”，见下 | — |

**吃饭表**（看摄取记录的备注）：

| 备注 | 动画 |
| --- | --- |
| 早饭 | 吃早餐 |
| 午饭 | 吃午餐、吃白饭、涮火锅 |
| 晚饭 | 吃晚餐、吃大闸蟹 |
| 下午茶、饿了 | 大口吃零食、偷吃零食被抓住；6–8 月加 吃冰淇淋融化、吃西瓜；12–2 月加 吃糖葫芦 |
| 当天有纪念日 | 吃长寿面（优先于上面几行） |

**闲时链**（`idle` 时每播完一段，按权重抽下一段的来源）：

| 来源 | 权重 | 动画 |
| --- | --- | --- |
| 待机 | 35 | 待机呼吸休闲 |
| 张望 | 10 | 东张西望 |
| 溜达 | 5 | 原地漂浮踏步、螃蟹走路、原地左转奔跑 |
| 小动作 | 20 | 原地重力下蹲压缩、女仆屈膝礼仪、小幅度原地360度旋转展示、用鲸鱼尾巴拍打地面、整体换装试色、碎碎念-擦桌碎碎念；7–9 点加 晨间刷牙；6–8 月加 摇扇纳凉 |
| 按心情 | 25 | 见“心情档” |
| 时节 | 5（当天是节日时改为 40，其他来源按比例缩小） | 见“时节表” |

**心情档**（闲时链“按心情”这一格播什么，以及附加的图标）：

| 情绪标签 | 动画 | 图标 |
| --- | --- | --- |
| 兴奋 | 蓝鲸现世、可爱宅舞、轻快摇摆舞、原地跳跃抓碎头顶物品、动物环绕 | 音符 |
| 开心 | 悠闲哼歌、小提琴演奏、吹笛子、撸猫、鲸鱼吐泡泡特效、玩水枪、放风筝、吹气球 | — |
| 期待 | 照镜子、变鸽子、扑克魔术、东张西望 | — |
| 平静 | 待机呼吸休闲、下五子棋、荡秋千、轻快记录 | — |
| 无聊 | 原地专心玩魔方、原地蹲下玩玩具汽车、三球抛接、抽陀螺、踢毽子、骑木马 | — |
| 有点闷 | 碎碎念-发呆碎碎念、原地敲击桌面互动 | — |
| 焦虑 | 工作状态-原地踱步张望 | 汗 |
| 委屈 | 工作状态-垂头叹气冒汗 | 泪 |

陪伴感低于 25 时，不管情绪标签是什么，额外加一个爱心图标（想你了）。

**时节表**：

| 时候 | 动画 |
| --- | --- |
| 9–11 月 | 被落叶淹没 |
| 12–2 月 | 堆雪人 |
| 除夕、春节 | 放烟花、收红包、写福字、舞狮头、吃年糕、吃饺子 |
| 元宵 | 吃汤圆、放孔明灯 |
| 清明 | 吃青团 |
| 端午 | 吃粽子 |
| 七夕 | 穿针乞巧 |
| 中元 | 放河灯 |
| 中秋 | 中秋赏月吃月饼 |
| 重阳 | 吃重阳糕、插茱萸赏菊 |
| 万圣节（10 月 31 日） | 讨糖南瓜灯、萌化小幽灵 |
| 冬至 | 吃饺子 |
| 腊八 | 吃腊八粥 |
| 圣诞（12 月 24–25 日） | 装点圣诞树 |
| 国庆（10 月 1 日） | 放烟花 |
| 你们的纪念日（「我们 › 纪念日」里的） | 拆礼物 |

**一次性反应，13 个**：

| 反应 id | 触发 | 动画 |
| --- | --- | --- |
| `poke` | 点她一下 | 心情好：点击回应-开心跃动、点击回应-挠痒咯咯笑、点击回应-元气挥手；心情差（委屈、有点闷、焦虑）：点击回应-傲娇生气 |
| `hold` | 按住她不放超过 0.4 秒 | 被鼠标拖拽悬空反馈（松手停止） |
| `done` | `reply-end` 正常结束 | 工作状态-雀跃庆祝 |
| `fail` | `reply-end` 带错误 | 工作状态-垂头叹气冒汗 |
| `startle` | 事件 `woken`（被消息吵醒） | 打瞌睡被惊醒 |
| `greet` | 你发来消息，而且距离上一条超过 3 小时 | 点击回应-元气挥手 |
| `wave` | `proactive`（她主动找你） | 点击回应-元气挥手 |
| `blush` | 你夸了她 | 点击回应-害羞惊讶 |
| `pout` | 你凶了她 | 点击回应-傲娇生气 |
| `guard` | 事件 `threat`（陌生人试探她） | 被吓一跳 |
| `digest` | 事件 `digested`（把聊天内容整理进了记忆） | 吃Token |
| `tidy` | 事件 `consolidated`（睡眠整理完成） | 工作状态-清点归档 |
| `wallet` | 余额查询结果到了并且换了档，或者点“看钱包” | 按余额分 6 档：50 元以上 余额-钱袋满溢；20–50 余额-金袋叮当；10–20 余额-钱袋如常；5–10 余额-数金皱眉；1–5 余额-袋空如洗；不到 1 元 余额-分文不剩 |

打断规则：

- `think`、`talk` 和所有一次性反应会立刻打断当前动画（交叉淡入 0.2 秒）。
- 进入和离开 `sleep` 立刻切换。
- 其他持续动作的变化等当前这段播完再换（最多等 10 秒）。
- 睡着时点她：只播“打瞌睡被惊醒”，然后接着睡。

**从 dsh-pet 借鉴的交互**：

- 点她：播点击回应，同时“Q 弹”一下（纵向压扁到 55% 再弹回）。
- 右键：弹出动作菜单，按“小动作、玩耍、吃什么、时节”四组列出全部动画，点哪个播哪个。这样 106 段都能手动看到。菜单最下面一项“她为什么这样”，显示状态机给出的原因。
- 头顶气泡：平时显示她最新的念头（1 小时内的）；点她时显示一句台词，3 秒后恢复。
- 系统开了“减少动态效果”时，只在状态变化时换一张静止画面，不连续播放。

### 任务 C1：先验证视频能不能播（半小时）

- [x] 从本机 dsh-pet 的 `assets/webm/` 临时拿一段（比如 `待机呼吸休闲.webm`）放到 `apps/desktop/.testdata/`，在开发模式下往「此刻」页临时加一个 `<video muted autoplay loop>` 播它。
- [x] 确认三件事，结论记到 `docs/notes/pet-video.md`：
    - 现有 CSP 下能不能播。不能就在 `index.html` 的 CSP 里加 `media-src 'self'`；还不行，就在主进程注册一个只读的自定义协议 `pet://`，只能读素材目录，CSP 加 `media-src pet:`。
    - 背景是不是透明的（把这一帧画到画布上，读左上角像素，透明度应为 0）。
    - 打包后能不能播：`npx electron-builder --win dir`，素材目录先按 `asarUnpack` 处理。
- [x] 把临时代码删掉。

### 任务 C2：导入素材并写明出处

新建：`apps/desktop/scripts/import-dsh-pet.mjs`、`apps/desktop/assets/pet/whale-girl/`（`clips/`、`LICENSE-ATTRIBUTION.md`、`clips.sha256`）。

- [x] 导入脚本：参数是 dsh-pet 的安装目录，默认 `~/.dsh/profiles/desktop/node_modules/dsh-pet`。只读它的 `assets/webm/*.webm` 和 `package.json`，复制到 `assets/pet/whale-girl/clips/`。不写入、不修改源目录。
- [x] 脚本检查：源版本是 0.3.8；文件数是 106；每个文件名都出现在任务 C4 的映射里。不符合就报错退出。
- [x] 生成 `clips.sha256`（每个文件一行校验值），以后能核对素材有没有被改过。
- [x] 写 `LICENSE-ATTRIBUTION.md`：
    - 来源：`PC2005-cloud/dsh-pet` 0.3.8，仓库地址。
    - 条款原文照抄：“素材（动画/提示词/源视频）：允许开源使用，禁止商用”。
    - 说明：本目录不适用本仓库的 Apache-2.0；商业使用本项目时必须删除本目录，程序会自动改用内置的 3D 鲸鱼。
    - 我们做了什么改动：没有改动，原样复制。
- [x] README 的“素材许可”一节加一段；`CONTRIBUTING.md` 的例外清单加一条。
- [x] `package.json` 的 `build.asarUnpack` 加 `assets/pet/**`。
- [x] 提交前去上游仓库核对一次：0.3.8 的许可一节和本机的一致。不一致就停下来找你。

### 任务 C3：状态机（纯逻辑，先写测试）

新建：`src/renderer/pet/pet-state.mjs`、`test/pet.test.js`。

```js
// 全部是纯函数，不碰 DOM、不读时钟
export const ACTIONS = ['sleep', 'think', 'talk', 'sick', 'drowsy', 'eat', 'drink', 'hungry', 'fidget', 'wait', 'roll', 'phone', 'watch', 'read', 'idle'];
export const REACTIONS = ['poke', 'hold', 'done', 'fail', 'startle', 'greet', 'wave', 'blush', 'pout', 'guard', 'digest', 'tidy', 'wallet'];

/** 短期状态：回复进行到哪一步、有没有待播的反应 */
export function initial() { return { replying: null, pending: [], lastUserAt: 0, balanceTier: null }; }

/** 收到一个事件后的新短期状态。event: {type, at, ...} */
export function reduce(machine, event) {}

/** 由生命核心的快照和短期状态，算出此刻的状态 */
export function derive(snapshot, machine, now) {
  // 返回 { action, mood, meal, reaction, icons, tint, why }
}

/** 活动文字 → 动作 id；认不出来返回 'idle' */
export function actionForActivity(text) {}

/** 余额（元）→ 0–5 档 */
export function balanceTier(yuan) {}
```

`snapshot` 就是界面已有的 `S.vitals`。`mood` 是情绪标签原文。`why` 是一句人话，例如“在吃午饭：12:03 吃了咖喱鸡饭”。

`reduce` 要处理的事件：`reply-start`、`reply-delta`、`reply-end`、`proactive`、`poke`、`hold`、`balance`、`vitals`（带主进程的事件列表）。

测试清单（用 `await import('../src/renderer/pet/pet-state.mjs')`，和 `brain-shape.test.js` 同样的写法）：

- [x] `角色：睡着时优先级最高`：睡着且发烧且饿，动作是 `sleep`。
- [x] `角色：8 种身体状态各有对应的动作`：遍历 `require('../src/main/physiology/behavior').STATES`，逐个构造只触发这一种状态的快照，断言动作不是 `idle`（`low` 例外，它对应 `idle`，靠心情档表现）。
- [x] `角色：作息里出现的每一种活动文字都认得`：把 `life.pickActivity` 在 24 个整点、饱腹和精力各取高低两档的全部返回值收集起来，加上 `STATES` 里的 `activity`，逐个调用 `actionForActivity`，断言除了“发呆”“窝着发呆”之外都不是 `idle`。以后有人新增活动文字却忘了配动作，这个测试会失败。
- [x] `角色：三餐和下午茶各自认得`：摄取记录的备注是早饭、午饭、晚饭、下午茶、饿了时，`derive` 返回的 `meal` 正确。
- [x] `角色：回复的过程是 思考 → 说话 → 庆祝 → 回到原来的动作`。
- [x] `角色：回复出错时播失败反应，不会卡在思考`：`reply-end` 带错误；或 30 秒没有任何 `reply-delta`。
- [x] `角色：一次性反应排队播放，最多攒 2 个`：连续来 5 个事件，只保留最新的 2 个。
- [x] `角色：隔了 3 小时再来消息会挥手，刚聊过不会`。
- [x] `角色：被夸害羞、被凶生气`：`vitals` 事件里带 `{type:'user', intent:{praise:true}}`。
- [x] `角色：睡着时点她只会惊醒一下`。
- [x] `角色：余额换档才播钱包动画，同一档不重复播`。
- [x] `角色：陪伴感低时加爱心图标，发烧时色调偏红`。

步骤：

- [x] 写完上面全部测试，运行确认失败；实现到全过。
- [x] 主进程小改动，让界面知道“被夸”“被凶”：`src/main/daughter.js` 的 `reply` 里，发给界面的事件 `{ type: 'user' }` 改成 `{ type: 'user', intent: { praise, criticism, affection } }`。`core.test.js` 加一条断言。

### 任务 C4：动画映射表和选片逻辑

新建：`apps/desktop/assets/pet/whale-girl/pet.json`、`src/renderer/pet/pet-director.mjs`。测试加在 `test/pet.test.js`。

- [x] `pet.json` 把“C 的总体设计”里的所有表格原样写成数据：`actions`、`meals`、`idleChain`、`moods`、`seasons`、`festivals`、`reactions`、`balance`、`menu`（右键菜单的四组）。动画一律用文件名（不带扩展名）引用。
- [x] 农历节日（除夕、春节、元宵、清明、端午、七夕、中元、中秋、重阳、冬至、腊八）的公历日期，对照权威日历核对后写一张 2026–2030 年的表进 `festivals`。不要凭记忆写。
- [x] `pet-director.mjs`（纯函数）：

```js
/**
 * 选下一段动画。
 * @param manifest  pet.json 的内容
 * @param derived   pet-state 的 derive() 结果
 * @param ctx       { now, rnd, recent: string[], anniversaryToday: boolean }
 * @returns {{ clip: string, source: string }}   source 说明是从哪张表选出来的
 */
export function nextClip(manifest, derived, ctx) {}

/** 一次性反应对应的动画 */
export function reactionClip(manifest, reaction, derived, ctx) {}

/** 映射表里引用到的全部动画名 */
export function referencedClips(manifest) {}
```

- 同一段动画不连续播两次（看 `ctx.recent` 的最后一项），除非这一组只有一段。

测试：

- [x] `选片：映射表引用的每段动画文件都存在`：`referencedClips` 的每一项在 `clips/` 里有同名 `.webm`。
- [x] `选片：106 段动画每一段都被引用了`：`clips/` 里的每个文件都在 `referencedClips` 里。这一条保证“全部动作都用上”。
- [x] `选片：15 个动作、13 个反应、8 种情绪标签在映射表里都有`。
- [x] `选片：早饭播吃早餐，纪念日那天吃长寿面`。
- [x] `选片：节日当天时节动画的比重变大`：固定随机数序列，统计 1000 次抽取，时节来源占比在 35%–45% 之间。
- [x] `选片：不会连着播同一段`。
- [x] `选片：季节限定的动画只在对应月份出现`（摇扇纳凉、吃西瓜、吃糖葫芦、堆雪人、被落叶淹没）。
- [x] 素材目录不存在时（商用时被删掉），上面涉及文件的测试自动跳过并打印原因，不算失败。

### 任务 C5：播放器

新建：`src/renderer/pet/pet-player.js`、`src/renderer/pet/pet-icons.js`、`src/renderer/pet/index.js`。

- [x] `pet-player.js`：两个叠在一起的 `<video muted playsinline preload="auto">`。播下一段时先让后台那个加载并开始播放，再把两个的透明度在 0.2 秒内对调。文件头写明做法参考 `PC2005-cloud/dsh-pet`（MIT）。

```js
export function createPlayer(host, { baseUrl }) {
  return {
    play(clip, { loop = false, onEnded } = {}) {},  // clip 是不带扩展名的文件名
    squash() {},            // Q 弹
    setTint(name) {},       // null | 'dim' | 'fever'
    pause() {}, resume() {},
    current() {},           // 正在播的动画名
  };
}
```

- [x] 文件名里有中文和全角逗号，拼地址时用 `encodeURIComponent`。
- [x] 加载失败（文件缺失、解码失败）时：在控制台报一次，改播“待机呼吸休闲”；连它也失败就通知上层换成 3D 鲸鱼。
- [x] `pet-icons.js`：11 个内联 SVG 图标（Zzz、汗、泪、爱心、音符、冰袋、杯子、手机、书、省略号气泡、感叹号），显示在角色头顶，淡入淡出。
- [x] `pet/index.js` 是总入口，把状态机、选片、播放器串起来，对外接口和现在的 `createWhale` 保持同一套思路：

```js
export async function createPet(host, { fish }) {
  // 先读 assets/pet/whale-girl/pet.json；读不到就返回现有 3D 鲸鱼的包装
  return {
    setSnapshot(vitals) {},
    onEvent(event) {},
    playClip(name) {},      // 右键菜单手动点播
    now() {},               // { action, mood, reaction, clip, why }
    coverage() {},          // 映射表里有、但文件缺失的动画名
    pause() {}, resume() {},
  };
}
```

- [x] `pet.json` 通过新的 IPC `pet-manifest` 读（页面的 CSP 不允许 `fetch`）。视频文件由 `<video src>` 直接加载，方式以任务 C1 的结论为准。
- [x] `whale3d.js` 保留不动，作为素材缺失时的退路。

### 任务 C6：接进「此刻」页面，出样张给你看

改动：`src/renderer/app.js`、`src/renderer/views/overview.js`、`src/renderer/style.css`、`src/main/main.js`、`src/main/preload.js`、`config/default.json`。新建：`src/renderer/pet/pet-lines.mjs`、`scripts/pet-sheet.js`。

- [x] `app.js`：`gl.attachWhale` 改成 `gl.attachPet`。事件转给角色：`fish.onVitals` → `pet.setSnapshot(v)` 和 `pet.onEvent({type:'vitals', events})`；`onReplyStart`、`onReplyDelta`、`onReplyEnd`、`onProactive` 各转一份；余额变化转成 `{type:'balance', yuan}`。角色不在屏幕上时也要更新短期状态，只是不播放。
- [x] `overview.js` 的角色区域：
    - 角色框 400×225（16:9），放在卡片左边。
    - 框上方是气泡。
    - 原来的 4 个按钮换成：“摸摸她”“跳支舞”“看钱包”“换一个”。
    - 下面一行小字显示 `why`。
    - 右键弹出动作菜单。
- [x] `pet-lines.mjs`：每个持续动作 3–5 句点击台词，口语、短句，不出现用户名和数字。
- [x] `config/default.json` 加一段：

```json
"pet": {
  "_comment": "概览页的角色",
  "skin": "whale-girl",
  "bubbleSeconds": 3,
  "pokeCooldownMs": 400,
  "greetAfterHours": 3,
  "balanceTiers": [1, 5, 10, 20, 50]
}
```

- [x] 调试钩子（和现有的 `window.__go` 放在一起）：`window.__petPlay(name)`、`window.__petNow()`、`window.__petCoverage()`。
- [x] `scripts/pet-sheet.js`：启动应用，依次强制 15 个动作和 13 个反应，每个等 2 秒截一张角色区域，拼成一张大图 `apps/desktop/.shots/pet-sheet.png`。`package.json` 加 `"pet:sheet": "node scripts/pet-sheet.js"`。
- [x] 出样张发给你看。你觉得某个状态配的动画不对，直接改 `pet.json`，不用动代码。

### 任务 C7：缺的 5 段动画和以后的扩展

- [x] 写 `docs/notes/pet-missing-clips.md`，列出现在用近似动画顶替的 5 种状态，每种写一句想要的画面，方便你用 dsh-pet 仓库 `prompts/` 里的提示词格式去生成：

| 状态 | 现在用的 | 想要的画面 |
| --- | --- | --- |
| 发烧 | 垂头叹气冒汗 + 冰袋图标 | 裹着毯子、头顶冰袋、脸红发抖 |
| 喝水 | 待机 + 杯子图标 | 捧着杯子小口喝水 |
| 刷手机 | 轻快记录 + 手机图标 | 低头划手机，偶尔笑 |
| 看书 | 轻快记录 + 书图标 | 捧着书翻页 |
| 等消息 | 发呆碎碎念 + 手机图标 | 抱着手机，隔一会儿看一眼屏幕，叹气 |

- [x] 新动画的接入方式写在同一份笔记里：把同规格的 `.webm`（VP9 带透明通道，640×360）放进 `clips/`，在 `pet.json` 对应动作的列表里加上文件名，跑一次 `npm test`。不用改代码。
- [x] 27 张表情包这次不接。以后可以用在气泡和聊天里，记一笔在笔记末尾。

### 任务 C8：测试、性能、文档

- [x] `scripts/e2e-main.js` 增加检查：
    - `角色：视频在播`：角色区域里可见的 `<video>` 的 `currentTime` 在 1 秒内增大。
    - `角色：背景是透明的`：把当前帧画到画布，左上角像素透明度为 0。
    - `角色：没有缺失的动画文件`：`window.__petCoverage().length === 0`。
    - `角色：发烧场景播生病动作`（`fever` 场景）：`window.__petNow().action === 'sick'`。
    - `角色：饿的场景在找吃的`（`hungry` 场景）。
    - `角色：发一句话，先思考再说话再庆祝`：发送后轮询 `window.__petNow()`。
    - `角色：离开此刻页后视频暂停`：两个 `<video>` 都是 `paused`。
    - `角色：素材目录不存在时退回 3D 鲸鱼`：新场景 `noskin`，用环境变量 `DFY_PET_DIR` 指向一个空目录。
- [x] 现有的三条性能检查不能变差。
- [x] 文档：
    - `设计文档.md` §10“角色形象”：参考项目改成 `PC2005-cloud/dsh-pet`；“必须设计一个原创角色作为默认形象”改成“默认用鲸鱼娘（素材禁止商用，单独声明），素材缺失时用原创的 3D 鲸鱼”。§14 参考项目表相应更新。
    - `实现进度.md` §10 一行。
    - README 的界面截图换一张带鲸鱼娘的「此刻」页。
    - `docs/第三方许可.md`（新建）：登记 dsh-pet 的素材和我们参考的播放做法。

**阶段 C 验收**：

1. 样张你看过认可。
2. `npm test`、`npm run e2e` 全过；106 段动画全部被映射引用、文件齐全。
3. 实际使用时：到饭点她在吃对应的那顿饭，睡着时在睡，发消息时先思考、再说话、最后庆祝，夸她会害羞，查余额会掂钱袋。
4. 右键菜单能点播任意一段。
5. 把 `assets/pet/whale-girl/` 整个删掉，程序照常启动，角色换成 3D 鲸鱼。

---

## 阶段 D：插件页（这一期只画界面）

分支：`feature/plugins-page-ui`

目标：「发现探索 › 平台插件」从 8 张写死的展示卡片，变成一个完整的插件页界面：能点开、能填设置、能保存、能看到接入步骤。真正的连接放到阶段 G。

这一期的规矩：**界面上不出现任何假的“已连接”**。连接按钮是灰的，写“即将开放”。

### 任务 D1：平台清单和设置的保存（主进程）

新建：`src/main/channels/registry.js`、`src/main/secrets.js`、`test/channels.test.js`。改动：`src/main/main.js`、`src/main/preload.js`。

平台清单是一份静态数据，界面完全照它画：

```js
{
  id: 'qq',
  name: 'QQ',
  group: 'chat',                // 'chat' 聊天 | 'content' 内容
  availability: 'soon',         // 'soon' 界面已有、连接即将开放 | 'planned' 还没排期
  stage: '下一期',              // 显示在卡片上
  color: '#1d9bf0', mark: 'Q',
  desc: '在 QQ 上和她聊天，她也会主动找你。',
  does: ['私聊', '在你指定的群里被 @ 时回复', '想你了主动找你'],
  risk: '用 NapCat 登录的是你自己的 QQ 号，有被风控的可能，建议用小号。',
  fields: [
    { key: 'ownerQQ', label: '你的 QQ 号（大号）', type: 'digits', min: 5, max: 12, required: true },
    { key: 'groups', label: '允许她说话的群（群号，用逗号分开）', type: 'digits-list' },
    { key: 'proactive', label: '允许她主动在 QQ 上找你', type: 'bool', default: true },
    { key: 'port', label: '监听端口', type: 'port', default: 8643, advanced: true },
  ],
  secret: { key: 'token', label: '连接令牌' },   // 有这一项的平台，界面上显示“复制”“重新生成”
  guide: [ /* 接入步骤，见任务 D3 */ ],
}
```

8 个平台的登记内容：

| 平台 | 分组 | 状态 | 设置项 |
| --- | --- | --- | --- |
| QQ | 聊天 | `soon` | 你的 QQ 号、允许的群、允许主动找你、端口（高级）、令牌 |
| 微信 | 聊天 | `soon` | 允许主动找你；登录方式写“扫码登录（开放后在这里显示二维码）” |
| B 站 | 内容 | `planned` | 两个开关：允许她看、允许她发言（发言前要你同意） |
| 小说 | 内容 | `planned` | 同上（只有“允许她看”） |
| 抖音 | 内容 | `planned` | 同 B 站 |
| 小红书 | 内容 | `planned` | 同 B 站 |
| X | 内容 | `planned` | 同 B 站 |
| YouTube | 内容 | `planned` | 同 B 站 |

每个平台的显示状态只有三种：

| 状态 | 含义 | 卡片上的字 |
| --- | --- | --- |
| `unset` | 没填过设置 | “还没设置” |
| `saved` | 设置已保存 | “已保存设置 · 连接功能即将开放” |
| `planned` | 还没排期 | “未开放” |

- [ ] `registry.js` 导出 `list(settings)`（清单 + 每个平台当前的设置 + 显示状态）和 `validate(id, values)`。
- [ ] `secrets.js`：把现在 `main.js` 里加密保存 DeepSeek Key 的那段逻辑抽出来，变成通用的 `saveSecret(name, value)`、`readSecret(name)`、`hasSecret(name)`。DeepSeek Key 改用它；QQ 令牌也用它。旧存档里的 `apiKeyEnc` 要能照常读出来。
- [ ] 设置的存法：`settings.channels = { qq: { ownerQQ, groups, proactive, port }, wechat: { ... }, ... }`。令牌不放在这里，走 `secrets.js`。
- [ ] 删除没人用的 `settings.onebotUrl`。读旧存档时忽略这个字段，不报错。
- [ ] IPC：

| 名字 | 作用 |
| --- | --- |
| `channels-list` | 返回清单、设置、显示状态。令牌只返回“有 / 没有”，不返回内容 |
| `channels-save` | 校验并保存一个平台的设置 |
| `channels-secret` | 参数 `action`：`generate` 生成 32 位随机令牌并加密保存；`copy` 由主进程把令牌写进系统剪贴板，界面全程拿不到明文 |

测试：

- [ ] `插件：清单里有 8 个平台，聊天 2 个、内容 6 个`
- [ ] `插件：QQ 号必须是 5–12 位数字，群号列表里混进字母会被拒绝`
- [ ] `插件：端口必须在 1024–65535 之间`
- [ ] `插件：保存后显示状态从“还没设置”变成“已保存设置”`
- [ ] `插件：返回给界面的数据里没有令牌明文`
- [ ] `插件：未排期的平台也能保存开关，但显示状态仍是“未开放”`
- [ ] `插件：旧存档里的 onebotUrl 被忽略，DeepSeek Key 照常能读`

### 任务 D2：页面

改动：`src/renderer/views/explore.js`、`src/renderer/links.js`（删掉 `PLATFORMS`）、`src/renderer/style.css`。

- [ ] 页面顶部一句话：“她能住进的地方。这一期先把设置准备好，连接功能下一期开放。”
- [ ] 两组卡片：“聊天”（QQ、微信）和“内容”（B 站、小说、抖音、小红书、X、YouTube）。
- [ ] 每张卡片：图标、名字、显示状态、一句说明。8 张都能点开。
- [ ] 点开卡片，在页面右侧滑出抽屉（宽 420，盖在聊天栏上面；按 Esc 或点抽屉外面关闭）。抽屉从上到下：
    1. 名字、图标、显示状态。
    2. “她会在这里做什么”：清单里的 `does`。
    3. 接入步骤（只有 QQ、微信有，见任务 D3）。步骤上方有一条提示：“连接功能还没开放，下面是开放后的步骤，可以先看看。”
    4. 设置表单：按清单的 `fields` 生成。标了 `advanced` 的收在“高级”折叠里。
    5. 令牌一行（只有 QQ 有）：“还没生成”或“已生成”，加“生成”“复制”“重新生成”按钮。
    6. 风险提示：清单里的 `risk`。
    7. 底部两个按钮：“保存设置”（可用）和“连接”（灰的，写“即将开放”，鼠标放上去提示“下一期开放”）。
- [ ] 表单校验在输入框失去焦点时做，错误写在输入框下面，用人话（“QQ 号是 5 到 12 位数字”）。
- [ ] 保存成功后抽屉不关，显示状态立刻更新，弹一句“已保存”。
- [ ] 最小窗口 1024×640 下抽屉内容能上下滚动，不溢出。
- [ ] 抽屉打开时焦点落在第一个输入框；Tab 键能走完所有控件。

### 任务 D3：QQ 和微信的接入步骤（文字）

写进清单的 `guide`。现在只是展示，但文字要按“将来照着做能做完”的标准写。

QQ：

1. 准备一个 QQ 小号，用来给她住。
2. 安装 NapCat，用小号登录。（附 NapCat 官方仓库的链接，用系统浏览器打开。大肥鱼不下载、不内置 NapCat。）
3. 在 NapCat 的网络配置里新建“WebSocket 客户端”，地址填 `ws://127.0.0.1:<端口>`，Token 点下面的“复制”粘贴进去。
4. 回到这里，填上你自己的 QQ 号（大号），点“连接”。
5. 用大号给小号发一句话。看到状态变成“已连接”并收到她的回复，就成功了。

微信：

1. 点“连接”，这里会出现一个二维码。
2. 用微信扫码，在手机上确认。
3. 给她发一句话，收到回复就成功了。

- [ ] 第 3 步里的端口跟着表单里的端口实时变化。
- [ ] `main.js` 的 `open-external` 白名单加上 NapCat 官方仓库这一个固定地址。

### 任务 D4：预览各种状态，截图给你看

连接功能没做，但你需要现在就看到“连接中”“已连接”“出错”长什么样，免得下一期做完才发现不喜欢。

- [ ] `explore.js` 里加一个只在开发时生效的钩子 `window.__channelPreview(id, state, detail)`。`state` 可以是 `connecting`、`online`、`error`、`off`。它只改当前页面的显示，不保存，刷新就没了。正式界面上没有任何入口能触发它。
- [ ] 预览状态下卡片和抽屉右上角显示一个“预览”角标，防止截图被误当成真实状态。
- [ ] 四种状态的画法：

| 状态 | 卡片 | 抽屉 |
| --- | --- | --- |
| `connecting` | 蓝色，“连接中…”，小圆点闪动 | 主按钮变成“取消” |
| `online` | 绿色，“已连接 · 3 分钟前收到过消息” | 主按钮变成“断开”；多一个可折叠的“最近日志”，显示几行示例 |
| `error` | 红色，一句人话原因，例如“端口 8643 被别的程序占用了” | 原因下面给一个建议：“换一个端口，或者关掉占用它的程序” |
| `off` | 灰色，“已关闭” | 主按钮是“连接” |

- [ ] `scripts/shots.js` 支持在截图前执行一段预览（环境变量 `DFY_SHOT_PREVIEW=qq:online`）。
- [ ] 出一组截图发给你：8 张卡片的总览、QQ 抽屉（没填、已保存）、微信抽屉、一个内容平台的抽屉、QQ 的四种预览状态。**这里停下来等你确认界面。**

### 任务 D5：测试

- [ ] `e2e` 的 `main` 场景加：
    - `插件页：8 个平台都显示，分成两组`
    - `插件页：点开 QQ，填 QQ 号，保存，卡片显示已保存设置`
    - `插件页：QQ 号填错有提示，保存按钮不生效`
    - `插件页：连接按钮是禁用的`
    - `插件页：生成令牌后，整页文字里找不到令牌内容`：读 `document.body.innerText`，断言里面没有 32 位的连续字母数字串
    - `插件页：按 Esc 关闭抽屉`
    - `插件页：正式界面没有预览角标`
- [ ] `restart` 场景加：`插件页：重启后 QQ 的设置还在`。
- [ ] 路由数量不变（还是 24 个），`test/us.test.js` 不用改。

**阶段 D 验收**：

1. 截图你看过认可。
2. 8 个平台都能点开，设置能保存，重启后还在。
3. 页面上任何地方都看不到令牌内容。
4. 没有任何按钮会让人以为已经连上了。

---

## 阶段 E：DSH 内核（这一期不带通道）

分支：`feature/dsh-kernel`

目标：DSH 跑在大肥鱼里面，通过生命网关和她的生命核心接通。这一期没有 QQ、微信，用内核页上的一个输入框证明整条路是通的。

### 任务 E0：验证（限时半天，不写进仓库）

实验目录放在仓库外面（系统临时目录），结论写进 `docs/notes/dsh-spike.md`。`DSH_HOME` 一律指到实验目录里，不用默认位置。

```bash
# 在临时目录，不是仓库里
npm init -y
npm install --registry https://registry.npmmirror.com \
  @deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5 \
  @deepseek-ai/dsh-sdk-minimal@0.1.2-alpha.2 \
  @deepseek-ai/dsh-sdk-client@0.0.1-rc.1
```

| 编号 | 要回答的问题 | 怎么验证 | 通过标准 |
| --- | --- | --- | --- |
| 1 | Electron 45 当 Node 用，能不能跑起 DSH | 设 `ELECTRON_RUN_AS_NODE=1`，用 `apps/desktop/node_modules/electron/dist/electron.exe` 运行 `dsh-jsonrpc-agent` 加一份最小 `cordis.yml`（只有 SDK 服务、DeepSeek 适配器、会话、智能体主干）；用 `HarnessClient` 完成 `initialize` | 握手成功 |
| 2 | 适配器的 `baseURL` 指向本机后，请求长什么样 | `baseURL` 指向 `scripts/mock-deepseek.js`（改成把收到的请求体写到文件）；用 SDK 发一句“你好” | 拿到假回复；把请求体存成夹具 `test/fixtures/dsh-chat-request.json` |
| 3 | DSH 会不会自己发别的请求（生成标题、压缩历史、探测余额或模型列表） | 连续发 30 句，记录假服务器收到的全部请求路径和请求体特征 | 列出所有非聊天请求的特征，网关按这个清单处理 |
| 4 | 最小配置到底需要哪些插件 | 从 sdk-minimal 的配置里逐个去掉终端、编辑器、沙箱、文件系统相关的条目，直到再去掉就起不来 | 得到最小插件清单，里面没有任何能执行命令或读写文件的插件。如果某个必需插件依赖终端组件，记下来找你 |
| 5 | 打包后能不能跑 | 把依赖放进 `apps/desktop` 的临时分支，`npx electron-builder --win dir`，从打包目录里按问题 1 的方式启动 | 能启动；记下 `asarUnpack` 要写哪些路径、包大了多少 |
| 6 | 关闭和崩溃 | 主进程退出后子进程是否自己退出；手动杀掉子进程后能否重新拉起 | 没有残留进程 |

决策规则：

- 问题 1、2 不通过：停下来找你。DSH 嵌入的前提不成立。
- 问题 4 发现去不掉终端组件：停下来找你，一起决定是接受它（配置里保证它不被调用）还是换别的组合方式。
- 问题 5 包增大超过 80 MB：记下最大的几个依赖，找你商量裁剪。

- [ ] 做完 6 个实验，写 `docs/notes/dsh-spike.md`：每个问题的结论、最小 `cordis.yml` 全文、踩到的坑。
- [ ] 把请求体夹具放进 `apps/desktop/test/fixtures/`。

### 任务 E1：生命网关

新建：`src/main/gateway.js`、`src/main/gateway-parse.js`、`test/gateway.test.js`。

**`gateway-parse.js`（纯函数，先写测试）**

```js
/**
 * 从 DSH 发来的请求里取出要她回答的那句话。
 * @param {{messages: Array}} body  DeepSeek 格式的请求体
 * @returns {{kind:'chat', text:string} | {kind:'other', reason:string}}
 */
function parseRequest(body) {}
```

规则（以 E0 的夹具为准）：

- 取 `messages` 里最后一条 `role === 'user'` 的。没有，就是 `other`。
- 多模态内容（数组形式）只取文字部分。
- 命中 E0 问题 3 记录下来的非聊天特征，判为 `other`。
- 这一期所有 `chat` 都来自内核页的输入框，也就是主人本人。发言人身份的解析（QQ 群里谁是谁）留给阶段 G，在这个函数里留好扩展点：返回值以后会多一个 `from` 字段。

测试：

- [ ] `网关：取最后一句用户消息，忽略系统提示词和历史`
- [ ] `网关：没有用户消息的请求不会被当成聊天`
- [ ] `网关：标题、压缩这类请求被识别出来`（用 E0 的夹具）
- [ ] `网关：数组形式的内容只取文字`

**`gateway.js`（HTTP 服务）**

- 只监听 `127.0.0.1`，端口用 0 让系统分配。
- 每次启动生成一个 32 字节的随机令牌。请求头 `Authorization: Bearer <令牌>` 不对就返回 401。这个令牌就是传给 DSH 子进程的“DeepSeek Key”。
- `POST /chat/completions`：
    - `chat`：调用 `daughter.replyFrom(...)`（任务 E2）。请求带 `stream: true` 就用 SSE 逐段返回，格式和 `scripts/mock-deepseek.js` 一致，最后一段带 `usage`，然后 `data: [DONE]`。
    - `other`：返回一句固定的短文本，不碰 `daughter`。
    - 回复里永远不带 `tool_calls`。
    - 单次请求超时 120 秒，返回 504。
- E0 问题 3 里发现的其他路径（比如余额、模型列表）：各返回一个固定的合法结果。
- 其余路径 404。
- 对外接口：`createGateway({ daughter, log }) → { start(): Promise<{url, token}>, stop() }`。

测试（起真实的服务，用 `fetch` 打）：

- [ ] `网关：令牌不对返回 401`
- [ ] `网关：流式回复能被 deepseek.js 的解析器读出来`：直接用 `deepseek.chat` 当客户端调网关，断言拿到完整文本和用量。这一条保证格式不会写错。
- [ ] `网关：回复里没有 tool_calls`
- [ ] `网关：非聊天请求不会进入她的记忆`：断言 `daughter.history` 长度不变。
- [ ] `网关：只监听本机`：`server.address().address === '127.0.0.1'`。

### 任务 E2：`Daughter.replyFrom`

改动：`src/main/daughter.js`、`test/core.test.js`。

```js
/**
 * 从桌面聊天栏以外的地方来的消息。桌面聊天栏仍然走 reply()。
 * @param {object} m
 * @param {string} m.text
 * @param {string} m.channel                 这一期只有 'kernel'
 * @param {(delta:string)=>void} [m.onDelta]
 * @returns {Promise<{text:string, tired?:boolean}>}
 */
replyFrom(m) {}
```

- [ ] 把 `reply()` 的主体抽成内部方法 `_converse({ text, channel, onDelta })`，`reply()` 和 `replyFrom()` 都调用它。重构前后 `core.test.js` 原有用例必须全过。
- [ ] `replyFrom` 的行为和 `reply` 完全一样（身体反应、检索记忆、提炼记忆、预算检查），只多一件事：情景记忆和聊天记录打上 `channel` 标签。
- [ ] 新事件 `channel-message`（给界面）：`{ channel, text, reply, at }`。`main.js` 转发，`preload.js` 加 `onChannelMessage`。桌面聊天栏同步显示这段对话，消息旁边带一个小标“经内核”。
- [ ] 这一期只接受主人的消息。陌生人、群聊的处理（隐私隔离、限流）在阶段 G 加，方法签名到时再扩展。
- [ ] 测试：
    - `通道：经内核说的话，桌面聊天栏里也有，记忆里也有`
    - `通道：桌面聊天和内核消息排队处理，不会交错`
    - `通道：预算用完时经内核也只回“累了”`

### 任务 E3：DSH 子进程管理

新建：`src/main/dsh/runtime.js`、`src/main/dsh/config.js`、`apps/desktop/dsh/cordis.template.yml`、`test/dsh-config.test.js`、`test/dsh-runtime.test.js`。

**`dsh/config.js`：生成 `cordis.yml`**

- 输入：网关地址。输出：YAML 字符串，写到 `<userData>/dsh/profile/cordis.yml`。
- 模板的插件列表就是 E0 问题 4 得到的最小清单。
- DeepSeek 适配器的配置固定为：`apiKeyEnv: DFY_GATEWAY_TOKEN`、`baseURL: <网关地址>`。
- 会话标题生成、历史压缩如果有开关，一律关掉。
- 留一个扩展点 `channels: []`，阶段 G 往里加通道插件。这一期永远是空的。

测试：

- [ ] `DSH 配置：不包含任何能动电脑的插件`：生成的 YAML 里不出现这些字符串：`dsh-tool-bash`、`dsh-tool-pwsh`、`dsh-terminal`、`dsh-tool-str-replace-editor`、`dsh-fs-local`、`dsh-tool-web`、`dsh-web-fetch`、`dsh-subagent`、`dsh-tool-jobs`、`dsh-mcp-client`、`dsh-tool-skill`、`dsh-tool-cordis`。（如果 E0 问题 4 的结论是某一项去不掉，按和你商量的结果调整这个清单，并在测试里写明原因。）
- [ ] `DSH 配置：模型地址只能是本机`：`baseURL` 以 `http://127.0.0.1:` 开头。
- [ ] `DSH 配置：YAML 里没有明文密钥`
- [ ] `DSH 配置：插件只能来自白名单`：解析 YAML，每个 `name` 都在 `dsh/config.js` 导出的 `ALLOWED_PLUGINS` 里。

**`dsh/runtime.js`：启动、守护、关闭**

```js
createDshRuntime({ userData, gateway, log }) → {
  start(),            // 生成配置 → 启动子进程 → SDK 握手
  stop(),             // 协议关闭 → 关标准输入 → 结束进程
  restart(),
  say(text),          // 通过 DSH 发一句话，返回她的回复（内核页的输入框用）
  status(),           // { state:'stopped'|'starting'|'running'|'crashed', pid, since, version, plugins, lastError, restarts }
  on('status', fn),
}
```

- 启动命令：`process.execPath`，参数是 `dsh-jsonrpc-agent` 的入口文件路径和 `cordis.yml` 路径。
- 环境变量只传这些：`ELECTRON_RUN_AS_NODE=1`、`DSH_HOME=<userData>/dsh`、`DFY_GATEWAY_TOKEN`、`PATH`、`SystemRoot`、`TEMP`、`TMP`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`。**不传** `DEEPSEEK_API_KEY`：DSH 永远拿不到真的 Key。
- 用 `@deepseek-ai/dsh-sdk-client` 的 `HarnessClient` 做握手、发消息和关闭。
- 守护：进程意外退出后按 2 秒、4 秒、8 秒……最长 60 秒的间隔重启；连续失败 5 次停止重试，状态设为 `crashed`，等用户点“重新启动”。
- 日志：子进程的标准错误写到 `<userData>/logs/dsh.log`，超过 2 MB 轮转，保留 2 份。
- 这一期内核默认不随程序启动（没有通道，开着也没用）。设置项 `dsh.autoStart` 默认 `false`；在内核页点“启动”或用输入框说话时才启动。阶段 G 有了通道以后再改成随通道启动。
- 应用退出（`before-quit`）时调用 `stop()`，最多等 5 秒。

测试（`test/dsh-runtime.test.js`，用一个假的子进程脚本代替真 DSH）：

- [ ] `DSH 运行时：子进程退出后会重启，间隔越来越长`（用假时钟）
- [ ] `DSH 运行时：连续失败 5 次后停止，状态是 crashed`
- [ ] `DSH 运行时：传给子进程的环境变量里没有 DeepSeek Key`
- [ ] `DSH 运行时：stop 之后没有残留进程`

**接进 `main.js`**

- [ ] 启动顺序：`daughter` → `gateway.start()`；`dsh` 按需启动。
- [ ] IPC：`dsh-status`、`dsh-start`、`dsh-stop`、`dsh-restart`、`dsh-say`；推送：`dsh`（状态变化）。`preload.js` 对应加方法。

### 任务 E4：内核页

改动：`src/renderer/nav-data.mjs`、`src/renderer/views/explore.js`、`test/us.test.js`。

- [ ] 「发现探索」加第二个 Tab“内核”（路由 `explore/kernel`）。`test/us.test.js` 里“24 个路由”改成 25。
- [ ] 页面内容：
    - 状态卡：未运行 / 启动中 / 运行中 / 出错，加“启动”“停止”“重新启动”按钮。
    - 信息：DSH 版本、进程号、已运行时间、重启次数、最近一次错误、数据目录。
    - 已加载的插件列表（来自 `status().plugins`）。
    - 一段固定说明：“内核里没有装任何能执行命令或读写文件的工具。她的回答来自她自己的大脑，内核只负责收发。”
    - **“通过内核跟她说一句话”**：一个输入框和发送按钮。回复显示在下面，同时出现在右侧聊天栏（带“经内核”小标）。内核没启动时点发送会先启动它。
- [ ] 插件页（阶段 D）顶部加一行内核状态的小字，点了跳到内核页。

### 任务 E5：端到端测试

新场景 `kernel`（用假 DeepSeek）：

- [ ] `内核：启动成功`：点“启动”，`dsh-status` 的 `state === 'running'`。
- [ ] `内核：通过内核说一句话，收到她的回复`
- [ ] `内核：这句话出现在聊天栏，带“经内核”标记`
- [ ] `内核：这句话进了记忆页`
- [ ] `内核：假 DeepSeek 收到的提示词里有她的人设和身体状态`：证明回答确实来自生命核心，不是 DSH 自己编的。
- [ ] `内核：杀掉内核进程后自动恢复`：10 秒内状态回到 `running`，再说一句仍有回复。
- [ ] `内核：退出应用后没有残留进程`（在 `e2e.js` 里检查）。
- [ ] `内核：你自己的 DSH 目录没被动过`：测试前后比较 `~/.dsh` 顶层目录的修改时间（目录不存在则跳过）。

### 任务 E6：打包

改动：`apps/desktop/package.json`。

- [ ] DSH 相关的包放进 `dependencies`，版本写死：`@deepseek-ai/dsh-sdk-jsonrpc-demo`、`@deepseek-ai/dsh-sdk-client`、E0 确定的最小插件集合。
- [ ] `build.asarUnpack` 按 E0 问题 5 的结论填写。
- [ ] `build.files` 加上 `dsh/**/*`。
- [ ] `npm run dist`；双击产物；在内核页说一句话。
- [ ] 记录产物大小。加上鲸鱼娘素材后目标不超过 200 MB。
- [ ] `docs/第三方许可.md` 登记所有随包分发的 DSH 包（名字、版本、许可证）。打包时把各包的 LICENSE 文件一起带上。

### 任务 E7：文档

- [ ] `设计文档.md` 第 4 节：把“生命核心是 DSH 插件 dsh-plugin-life”改成“生命网关”的说法；`docs/images/src/kernel.svg` 相应修改并重新导出 PNG。
- [ ] `实现进度.md`：§11、§13 两行更新；“还没做的”里删掉“自己写 OneBot v11 客户端”。
- [ ] `执行计划.md` 的“当前进度”一节整体重写（现在还写着 13 个测试）。
- [ ] README 的架构一节。

**阶段 E 验收**：

1. `npm test`、`npm run e2e`（含 `kernel` 场景）全过。
2. 打包后的程序里，在内核页说一句话能收到她的回复，回复用到了她的记忆。
3. 任务管理器里结束内核进程，10 秒内自动恢复。
4. 退出大肥鱼后没有残留进程。
5. 你自己的 `~/.dsh` 没有变化，你的 dsh-pet 照常能用。

---

## 阶段 F：NIH 大脑模型（等你决定）

分支：`feature/nih-brain`（你说“用”才开）

### 已经做了的

- 下载了两个文件，放在仓库外面的临时目录，没有进仓库：
    - `3d-vh-m-allen-brain.glb`，11,977,312 字节，SHA-256 `2b9ad5b53e40e9f0936da74f7be38d2eed15604e26358c3870a0ea13499b9a35`
    - `crosswalk.csv`，7,094 字节（结构名和解剖学标准编号的对照表）
    - 来源：`https://cdn.humanatlas.io/digital-objects/ref-organ/brain-male/v1.3/assets/`
- 检查结果：标准 glTF 2.0，没有用任何扩展，没有贴图；283 个带名字的网格，约 65.6 万个三角面；左右半球分开，结构名都带 `_L`、`_R`。
- 许可：CC BY 4.0，可以商用和修改，必须署名。官方给的引用格式：Kristen Browne; Heidi Schlehlein. 2023. *3D Reference Organ for Brain, Male v1.3*. https://doi.org/10.48539/HBM929.XKCL.339
- 按结构名把 283 个网格归到我们的 14 个脑区，试配结果：238 个归上了；26 个是脑室、白质和纤维束，用不上；另有 19 个没有对应的脑区（嗅球、松果体、红核、视交叉等）。归类规则在临时目录的 `regions.mjs` 里，采用时搬进仓库。
- 出了 6 张预览图，在 `apps/desktop/.shots/nih-brain/`（这个目录不进仓库）：写实外观、按 14 脑区上色的侧视和俯视、透明皮层里的深部结构、两张全息风格试渲染。合成图是 `preview-sheet.jpg`。

### 它和现在的大脑有什么不同

| | 现在的全息大脑 | NIH 模型 |
| --- | --- | --- |
| 数据 | 一个人的真实皮层表面（CC BY-SA 3.0） | 艾伦研究所的参考图谱，分成 283 个结构（CC BY 4.0） |
| 有没有深部结构 | 没有，海马体、丘脑这些只是光点 | 有真实形状的海马体、杏仁核、丘脑、基底神经节、脑干、小脑 |
| 脑区边界 | 没有，脑区是一个坐标点 | 每个脑区是一组真实的网格，可以整块点亮、整块标注 |
| 观感 | 发光纤维，科幻感强 | 写实，像解剖图谱 |

两者是不同的两颗脑，坐标对不上，不能叠在一起，只能做成两个模式切换。这正好对应你之前说的“逼真 3D 模型和点阵模型两种”：NIH 模型做写实模式，现在的全息大脑就是点阵模式。

### 需要你定的

- **用**：做成「大脑 3D」页的第二个模式“解剖”，和现在的“全息”并排切换。脑区标注问题在解剖模式里彻底解决：每个脑区整块上色、名字钉在上面。
- **不用**：保持现状，只给现在的全息大脑加一个“全部脑区常显标注”的开关（约 2 小时，单独做）。

### 如果用，任务清单

**任务 F1：构建脚本**。新建 `apps/desktop/scripts/build-hra-brain.mjs`。

- [ ] 输入：下载的 `.glb`。输出：`apps/desktop/assets/brain-hra/brain.bin`（合并后的顶点和索引）、`regions.json`（每个脑区在缓冲区里的范围、中心点、包围盒、包含哪些原始结构）。
- [ ] 把 283 个网格按 14 个脑区加“其他”合并，左右半球分开保存，共 30 组。脑室、白质、纤维束不要。
- [ ] 减面：总三角面不超过 12 万。用和 `build-cortex-lod.mjs` 相同的顶点聚类办法，不新增依赖。
- [ ] 坐标：居中，最长边缩放到 3.65（和现有皮层一致），前额朝 +x。
- [ ] 产物合计不超过 3 MB。原始 `.glb` 不进仓库；脚本开头写明下载地址和校验值，任何人都能重新生成。
- [ ] 测试 `test/brain-hra.test.js`：14 个脑区每个至少有一组网格；索引不越界；`regions.json` 和二进制文件的长度对得上。

**任务 F2：署名**。

- [ ] 新建 `apps/desktop/assets/brain-hra/LICENSE-ATTRIBUTION.md`：作者、标题、来源链接、许可、我们做了哪些修改。
- [ ] README 的“素材许可”一节和 `CONTRIBUTING.md` 各加一句；`docs/第三方许可.md` 登记。
- [ ] 解剖模式的画面角落常显一行小字“大脑模型：HuBMAP Human Reference Atlas，CC BY 4.0”；设置页的“关于”里列出完整署名。CC BY 要求署名对用户可见。

**任务 F3：解剖模式**。改动 `src/renderer/brain.js`（或拆出 `brain-anatomy.js`）、`src/main/main.js`、`views/neuro.js`。

- [ ] 数据通过新的 IPC `brain-hra` 传给界面（和现有的 `cortex` 一样，页面的 CSP 不允许直接读文件）。只在第一次切到解剖模式时加载。
- [ ] 复用现有的 WebGL 上下文和画布，`setMode` 增加 `'anatomy'`。
- [ ] 画法：每个脑区一个半透明的着色网格，颜色用脑区分组的颜色；激活值越高越亮；深部结构先画，皮层后画并带透明度。
- [ ] 一个“皮层透明度”滑块，拉低就能看到里面的海马体、丘脑。
- [ ] 标注：14 个脑区的名字钉在各自的中心点上，默认全部显示；被挡住的标注变淡。
- [ ] 悬停、点击整块脑区：高亮整块，右侧面板显示职责说明（现有内容）。
- [ ] 思考飞线、记忆光点在解剖模式里先不做，只保留脑区激活。

**任务 F4：测试和性能**。

- [ ] `e2e`：`解剖模式画出来了`、`解剖模式有 14 个标注`、`切回全息模式正常`、`来回切换没有叠加渲染循环`。
- [ ] 平均帧间隔不超过 60ms（和现有标准一致）。
- [ ] 截图放进 README。

---

## 阶段 G：真正接通 QQ（后面做）

这一期不做。写在这里是为了不丢掉已经查清楚的东西；开工前要按当时的情况重新排一遍。

**开工条件**：阶段 D 的界面你认可了；阶段 E 的内核稳定了；任务 B1（陌生人的话不能变成主人说的）已经合入。

**要做的事**（每一项到时再展开成带测试的任务）：

1. **验证通道插件**（限时 1 天）：
    - `dsh-onebot-qq@0.10.0` 在我们的最小配置里能不能加载（它可能需要网页宿主或预设）。写一个假的 OneBot 端，用反向 WebSocket 连上去发消息。
    - 私聊、群里管理员、群里普通成员、普通成员伪造管理员前缀，这四种情况下 DSH 发给网关的最后一条用户消息分别长什么样，存成夹具。
    - 她主动找人时怎么把话推到 QQ：往那个 QQ 会话里发一条内部消息，或者用插件的事件注入文件。
    - 起不来就依次换 `@yachangchang/dsh-qq-bridge@1.0.6`、`@tencent-connect/dsh-qqbot@0.5.5`；都不行就找你商量自己写一个最小的 OneBot 客户端。
2. **发言人身份**：`gateway-parse.js` 只认消息**开头**那一个 `[HH:MM 昵称(QQ)·档位]`。私聊按主人处理（插件默认只放行管理员）；群里“管理员”是主人，其他人是陌生人。成员在消息里打一个假前缀没有用，这一条要有测试。
3. **群聊和陌生人的回复**：`replyFrom` 增加 `from`、`group`、`groupId` 参数。
    - 主人私聊：和现在一样，用全部记忆。
    - 主人在群里、陌生人：只用“公开记忆”（她自己的反思和自我叙事、这个群自己的聊天记录）；日记、黑话、纪念日、关于主人的事实一律不进提示词。
    - 陌生人先过免疫扫描；同一个人每 10 分钟最多回 6 条。
    - 测试：主人私聊说“我下周要做手术”，群成员问“你主人最近怎么样”，发给模型的提示词里不能有“手术”。
4. **QQ 通道配置**：把插件页保存的设置转成插件配置。固定值：反向模式、只监听本机、`dmPolicy: open`、没配群时 `groupPolicy: disabled`、群里要 @ 才回、关掉中间消息、语音转写、文字转图片卡片、分段发送工具、出错提示。
5. **插件页接后端**：“连接”按钮生效；显示状态换成真实的未设置、已关闭、连接中、已连接、出错；出错原因翻译成人话（端口被占用、令牌不对、内核启动失败、5 分钟没有 NapCat 连上来）；日志里的 QQ 号打码。界面按阶段 D 你确认过的样子，不再改版。
6. **在 QQ 上主动找你**：只发给主人私聊，绝不主动往群里发；沿用安静时段和每日上限。
7. **端到端测试**：新场景 `qq`，用假 OneBot 端跑私聊、群聊隐私、注入拦截、内核崩溃恢复。
8. **微信**：QQ 验收通过后，用 `dsh-wechat-channel@0.3.1` 重复第 1–5 步，外加扫码登录。

估时 4 天（不含微信）。最终验收需要一个装了 NapCat 的 QQ 小号和你的大号。

---

## 七、总验收

A 到 E 做完后（F 视你的决定，G 不在这一期），发 v0.3 预览版之前逐项确认：

- [ ] `npm test`、`npm run e2e`、`npm run eval:strict`、`npm run simulate` 全过。
- [ ] `npm run dist` 的产物在一台没装过 Node 的 Windows 电脑上能双击运行，不超过 200 MB。
- [ ] 「此刻」里的鲸鱼娘播的动画和她的真实状态一致；106 段动画都能在右键菜单里点播。
- [ ] 删掉 `assets/pet/whale-girl/` 后程序照常运行，角色退回 3D 鲸鱼。
- [ ] 插件页 8 个平台都能点开、能保存设置；没有任何地方显示令牌内容或假的“已连接”。
- [ ] 内核页说一句话，她的回复来自生命核心；桌面聊天栏和记忆页里都有这段对话。
- [ ] 每日 Token 预算用完后，桌面、内核、主动消息、记忆整理都不再调用模型。
- [ ] 结束内核进程能自动恢复；退出程序没有残留进程；你自己的 DSH 目录没被动过。
- [ ] `docs/第三方许可.md` 完整；README 的“素材许可”列出了所有不适用 Apache-2.0 的目录。
- [ ] 按分支流程从 `dev` 合到 `release`、`prod`、`master`，在 `master` 上打标签 `v0.3.0`。

## 八、开工前需要你确认的事

1. **NIH 大脑用不用。** 看 `apps/desktop/.shots/nih-brain/preview-sheet.jpg`。
2. **鲸鱼娘的 106 段动画放进公开仓库。** 作者的条款是“允许开源使用，禁止商用”，所以可以放，但要单独声明、不算在 Apache-2.0 里。仓库会因此大 53 MB。如果你不想让仓库变大，另一个做法是素材不进仓库，程序启动时从你本机的 dsh-pet 目录读；代价是别人下载我们的程序后看到的是 3D 鲸鱼。计划按“放进仓库”写的。
3. **“生命网关”这个接法你是否同意。** DSH 只负责收发，她的身体和记忆原样留在我们自己的代码里，不改写成 DSH 插件。
4. **补拍 5 段动画**（发烧、喝水、刷手机、看书、等消息）要用 dsh-pet 的提示词去生成视频，这件事需要你来做，不急。
