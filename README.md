# 塔台 · Tower

**给「不止一个 agent 在跑」的人用的右侧栏值守台。**

DSH 里 agent 会自己继续跑：目标（goal）会自动续轮、后台作业会自己跑几分钟、定时任务会自己开新会话。
但人是靠**主动打开一个个会话**来确认它们状态的 —— 没人告诉你谁卡住了、谁在等你一句话、谁已经跑完了。

塔台把这件事从「轮询」变成「值守」：右侧栏一屏看清**在飞 / 待你处置 / 后台 / 定时**，并就地放行。

```
┌ 塔台  全机运行值守                                    ↻ ┐
│   4        1           1           0                  │  ← 在飞 / 待处置 / 后台 / 定时
├───────────────────────────────────────────────────────┤
│ 需要你                                                 │
│ ┃ ⛔ 目标受阻：缺少宿主接口凭证           3m 前  [打开会话] │
│ 航班                                                   │
│ ● harness   cordis                        bc835d33-c   │
│   把右侧栏插件做成可交付的产品                          │
│   第 7/20 轮   [打开会话] [暂停] [完成]                 │
│ ⏸ project    standard                     4eae8a7c-5   │
│   无目标 · 自由航行                                    │
│ 后台作业                                               │
│ [运行中] pnpm build        4.0KB  45s      [终止]      │
│ 定时航班                                               │
│ [已排程] 每日站会纪要      10m 后执行       [立即执行]   │
└ 本机只读快照 · 动作只在你点击后生效          10:27:41 ┘
```

## 它解决的具体问题

| 今天 | 塔台 |
|---|---|
| goal 只有 agent 侧工具，人在界面上**看不见也管不了** | 每个目标一张卡：阶段、第几轮、为什么受阻，可就地暂停/继续/完成 |
| 后台作业散在各会话，结束/失败没有统一去处 | 全机后台作业一列，运行中可终止 |
| 定时任务只能去设置页翻 | 下一次执行时间与「立即执行」 |
| 要判断「现在有没有事」，得逐个会话点开 | 一个数字：待你处置几件，红灯角标常驻输入框 |

> 依据：本机实时 slot 清单里，`goal` 这个词只出现在**工具名**中（`create_goal` / `update_goal`），
> 右栏 `sidebar.right.pane.tab` 的 16 个既有占用者没有一个呈现 goal。目标状态是当前 UI 的真空区。

## 入口（三处）

1. **输入框工具行**「塔台」按钮 —— 常驻，带待处置红角标；点击打开右侧栏并选中面板。
2. **右侧栏 tab** `tower.supervision`（chip 上同样带计数）。
3. **空白右栏引导页** 的「塔台」卡片。

## 安装

推荐在 DSH 内安装（Host + Client 一次到位）：

```
plugin_manager  action=install_bundle  target=<本目录绝对路径>
```

等价于在 profile 里加一行 bundle。手工挂载的补丁层是 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-tower
      name: 'dsh-plugin-tower'
```

**首次安装**通过 HMR 立即生效；**替换已安装版本**（同一个包名换了代码）需要重启一次 Harness
才能加载新的 Host 模块代 —— 这是 DSH 的模块代机制，不是本插件的选择。

## 接口

Host 半只暴露一个同源前缀路由 `/dsh-tower/api`，无配置项、无落盘、无出网。

| 方法 | 语义 |
|---|---|
| `GET /dsh-tower/api` | 完整快照：`counts` / `attention` / `flights` / `schedules` |
| `GET /dsh-tower/api?counts=1` | 轻量包：只要 `counts` + `attention`（输入框角标用，9s 一取） |
| `GET /dsh-tower/api?job=<id>&session=<sid>&tail=4000` | 某条后台作业的输出尾部：只读、不动模型游标，最多 8KB，带 `truncated`/`lossy` 标记 |
| `POST /dsh-tower/api` | 一个动作，一次一个 |

POST body 与动作：

```jsonc
{ "action": "goal.pause",    "sessionId": "...", "goalId": "...", "revision": 7 }
{ "action": "goal.resume",   "sessionId": "...", "goalId": "...", "revision": 7 }
{ "action": "goal.complete", "sessionId": "...", "goalId": "...", "revision": 7 }
{ "action": "job.kill",      "jobId": "bash-...", "sessionId": "..." }
{ "action": "schedule.run",  "scheduleId": "..." }
```

- 所有动作都要求**该会话仍有活 agent**，并用调用方给的 `revision` 做乐观并发；失败原样回传中文原因。
- POST 只接受同源页面（有 `Origin` 就必须同源），其它方法一律 `405` 并带 `Allow`。
- 没有批量、没有自动重试、没有静默补偿：一次点击一个动作。

## 界面与交互（0.1.2 重构）

- **设计令牌**：颜色全部取自宿主主题（`--dsw-alias-*`），自动跟随明暗主题，不硬编码色值。
- **状态行**：作用域（全机 / 本会话）+ 一句话计数，取代四格仪表 —— 没事时不占视觉预算。
- **航班卡**：状态点（运行时有呼吸环）、当前会话标记、目标进度条、右侧元信息（预设 · 第 n 轮 · 已运行）。
- **空态即入口**：三条起手式可一键复制，粘到输入框就能让面板立刻有东西可看。
- **稍后处理**：待处置项可「稍后 30 分钟」，只存本机 localStorage，不产生任何服务端状态。
- **渲染边界**：面板内部异常收敛成可读错误 + 重试，不会白屏（白屏会让人以为宿主坏了）。
- **卡片宽度收敛**：栅格用 `repeat(auto-fill, minmax(300px, 1fr))`，单张卡不会被拉成空盒子。
- **面板内键盘**：`↑↓` / `j k` 移动，「Enter」打开会话，「Esc」取消；只在面板获得焦点时生效，不劫持输入框。
- 悬停、焦点环、滚动条、骨架屏、减少动效偏好，全部走真实 CSS（组件内 `<style>`，`.twr-` 前缀）。

## 数据来源（全部为宿主既有服务）

| 区块 | 服务 |
|---|---|
| 航班 / 在跑判定 | `agents.list()`、`agents.get()`、`agents.turnBoundaryOf(session)` |
| 目标 | `goals.get(agent)`，动作走 `goals.pause/resume/complete` |
| 后台作业 | `jobs.list(sessionId)`、`jobs.kill()` |
| 定时 | `schedule.catalog()`、`schedule.run()` |
| 工作区名 | `sessions.get(id).header.cwd` |

任何一个服务缺失，对应区块降级成空数组，**不会让面板或宿主整体失败**。

## 隐私与安全

- 只在本机 loopback 上读、不写业务数据、不落盘、不上报。
- 快照里的字段全部来自你想要看到的那几项：工作区名、目标原文、作业标签；不读消息内容、不读文件内容。
- 面板展示的是「运行状态」，不是「对话录像」。

## 已知边界

- 只显示**仍然活着**的 agent。会话关闭后目标状态不可见（目标的持久快照在 session log 里，v1.1 计划补上只读回放）。
- 待处置由确定性规则产生（目标受阻 / 目标暂停 / 作业失败），不含模型判断。
- 轮询：面板打开 4s，仅入口按钮 9s；标签页隐藏时暂停。面板关闭即卸载，不留后台定时器。

## 开发

```bash
node --check index.js && node --check client.js
node test/smoke.mjs   # 21 条：快照投影、过滤、计数、排序、动作分发、全服务缺失降级
node test/route.mjs   # 9 条：方法门、同源门、body 门、405 Allow
node test/wiring.mjs  # 14 条：客户端模块装配（tab 类型 + 三个 seat + 渲染边界）
node test/render.mjs  # 22 条：用玩具 React 整棵渲染（有数据 + 空态），抓渲染期崩溃
```

`index.js` 的 `__internal` 只服务这两个离线测试，不参与宿主装配。

## 商业化

定位、竞品、定价与路线见 [`docs/product-brief.md`](docs/product-brief.md)。
实机验证记录与未验证边界见 [`docs/verification.md`](docs/verification.md)。

## 文档

按这个顺序读：

| 文档 | 回答什么 |
|---|---|
| [`docs/product-brief.md`](docs/product-brief.md) | **为什么是这个方向**：第一性原理、证据链、竞品矩阵、被否掉的四个方向 |
| [`docs/product-plan.md`](docs/product-plan.md) | **产品怎么长**：四层能力（观察/提醒/治理/审计）、设计原则、状态模型、v0.2–v2.0 路线与验收 |
| [`docs/business-case.md`](docs/business-case.md) | **值不值得做**：生态分发实测、市场测算、四种收入模型取舍、定价、盈亏平衡、90 天验证与 kill 标准 |
| [`docs/verification.md`](docs/verification.md) | **哪些已证明、哪些没有**：实机验证记录与未验证清单 |
| [`docs/release/README.md`](docs/release/README.md) | **怎么发出去**：W1–W2 渠道清单、G1 判定、发布前自检；含目录 PR 文案与实测文初稿 |

