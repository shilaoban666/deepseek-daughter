# Electron 33 → 45 升级记录

> 2026-11-10，对应执行计划阶段 A（[角色-升级-DSH-插件页执行计划](../角色-升级-DSH-插件页执行计划.md)）。

## 版本

| | 升级前 | 升级后 |
| --- | --- | --- |
| Electron | 33.4.11 | 45.2.3（版本号写死，不带 `^`） |
| 自带 Node | 20.18 | 24.22.2 |
| Chromium | 130 | 156.0.8078.80 |
| electron-builder | 25.1.8 | 26.18.0 |
| `engines.node`（跑单元测试用的系统 Node） | ≥ 20 | ≥ 22 |

为什么是 45：DSH 的启动器 `@deepseek-ai/dsh` 0.2.1-rc.5 要求 Node ≥ 24.9，Electron 40 起才自带 Node 24；45 是当前维护中的最新一条线。

## 前后数据

| | Electron 33 | Electron 45 |
| --- | --- | --- |
| 单元测试 | 101 / 101 | 101 / 101 |
| 端到端测试 | 47 / 47（修好遮挡问题后） | 53 / 53（多了“升级”场景 5 项和“组件版本”1 项） |
| 冷启动到界面就绪（端到端测试打印，4 个场景） | 1108–1428 ms，中位约 1280 ms | 951–1470 ms，中位约 1250 ms（装完后第一次启动 3249 ms） |
| 便携版 exe | 77.5 MB | 105.9 MB（只保留中文、英文语言包；不精简是 113.7 MB） |
| 解压后 | 276 MB | 317 MB |

体积增加全部来自 Electron 本身：主程序 181 → 239 MB，新增 `dxcompiler.dll` 25 MB，`resources.pak` 5.5 → 13 MB。我们自己的代码和资源（`resources/`）前后都是 7.3 MB。

## 破坏性变更对照（34–45，只列我们用到的接口）

来源：<https://www.electronjs.org/docs/latest/breaking-changes>

| 版本 | 变更 | 是否受影响 | 处理 |
| --- | --- | --- | --- |
| 35 | `webContents` 的 `console-message` 事件改成传一个对象 `{ level, message, lineNumber, sourceId, frame }`，`level` 变成字符串 | 受影响：`src/main/main.js`、`scripts/e2e-main.js` | 两处都改成新写法；测试里按 `level === 'error'` 收集错误 |
| 45 | `safeStorage.isEncryptionAvailable / encryptString / decryptString` 过时，46 删除 | 受影响：保存和读取 DeepSeek Key | 改用 `isAsyncEncryptionAvailable / encryptStringAsync / decryptStringAsync`；`loadSettings`、`saveSettings` 变成异步。官方说明旧接口加密的数据可以用新接口解开，“升级”场景验证了这一点 |
| 45 | 沙盒预加载脚本里去掉了 `Buffer`、`setImmediate` 等全局变量，`require` 只能加载 `electron` | 不受影响：`preload.js` 只用了 `contextBridge`、`ipcRenderer` | — |
| 45 | 沙盒预加载里的 `ipcRenderer` 改用原生 `EventEmitter` | 不受影响：只用了 `on`、`removeListener`、`invoke` | — |
| 45、39 | `window.open` 子窗口默认沙盒、弹窗总是可调大小 | 不受影响：`setWindowOpenHandler` 一律拒绝 | — |
| 43 | `nativeImage.toBitmap()` 默认转成 sRGB | 不受影响：端到端测试只比较亮度差 | — |
| 42 | macOS 通知改用 `UNNotification`，需要签名 | 不受影响：只发 Windows 版 | 以后做 macOS 版要注意 |
| 36 | `app.commandLine` 会把开关名转成小写 | 不受影响：我们的开关本来就是小写 | — |
| 34 | Windows 全屏时隐藏菜单栏 | 不受影响：本来就隐藏菜单栏 | — |

## 顺手修的两个测试工具问题（升级前就有）

1. **端到端测试主场景卡死或报“Current display surface not available for capture”。** 测试窗口被别的窗口完全挡住时，Windows 会停掉它的逐帧渲染，测性能的 `requestAnimationFrame` 永远等不到。`scripts/e2e-main.js` 里关掉了遮挡检测（`CalculateNativeWinOcclusion`）和后台节流；测帧率的探针最多等 6 秒，等不到就明确报“没有在渲染”，不再卡到超时。
2. **截图拍到的是上一个页面。** `npm run shots` 用的是隐藏窗口，它要到截屏时才重绘，所以第一次拿到的是旧画面。`src/main/main.js` 的截图流程改成每页连拍两次取第二张。

## 升级场景的旧存档

端到端测试的 `upgrade` 场景需要一份用旧版本 Electron 生成、带加密 Key 的存档，放在 `apps/desktop/.testdata/upgrade/`（不进仓库）。没有这个目录时场景自动跳过。

重新生成的方法：把 `package.json` 里的 Electron 临时换回旧版本，用 Electron 运行一个小脚本，脚本里设 `DFY_DATA_DIR` 指向该目录、`require('src/main/main.js')`，等界面就绪后执行 `window.fish.saveSettings({ apiKey: 'sk-upgrade-test-000000', daughterName: '升级测试', userName: '小明' })`，然后退出。

场景检查三件事：Key 还在、名字还在、发消息时请求头里带的正是 `sk-upgrade-test-000000`。

## 新增

设置页最下面加了“关于”卡片：大肥鱼版本、Electron、Node、Chromium。大肥鱼的版本直接读 `package.json`，因为 `app.getVersion()` 在用别的入口启动时会退回 Electron 自己的版本号。
