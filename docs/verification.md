# 实机验证记录 · dsh-plugin-tower

> 环境：DSH Desktop，profile `desktop`。GUI 在过程中重启过两次，端口随之变化（64700 → 57212）。
> 记录时间：2026-11-21（Asia/Shanghai）。
> 规则：**只写看到的结果**。没验证的写进「未验证」，不冒充。

## 1. 安装态

| 项 | 值 |
|---|---|
| 包 | `dsh-plugin-tower@0.11.0` |
| Loader 行 | `include:dsh-tower`（bundle `dsh-plugin-tower`） |
| 模块代（当前） | `dsh-plugin-tower+0.11.0+196ce2876e54` |
| 历史模块代 | `0.1.0+fc656e3cdee5`、`0.1.0+681676529899`、`0.1.0+e52103ad2269`、`0.1.1+925f9d56b54d`、`0.1.2+6affd6c677dc`、`0.1.3+9a8aba3592e2`、`0.1.4+7456f05f6754`、`0.1.5+e046b59b0515`、`0.1.6+ffaede5583b8`、`0.2.0+0f0fa40a9051`、`0.2.1+50b17b476bed`、`0.3.0+191fc799cf0c`、`0.4.0+828a5b0628c3`、`0.5.0+d3a60a8835cc`、`0.6.0+5b1e3eb3ec55`、`0.7.0+9a7b7d37b267`、`0.7.1+5290074be3c2`、`0.7.2+e19cbf192cf9`、`0.8.0+9b10f97cb885`、`0.9.0+412c974b1ecf` |
| Config schema | 无（本插件不暴露配置项） |
| 用户补丁层 | **未被修改**（仅经 bundle 通道挂载） |

模块代目录内确认包含：`index.js` / `client.js` / `cordis.patch.yml` / `icon.svg` /
`locale/{zh,en}.json` / `README.md` / `docs/`（含 release 子目录）。

## 2. Client 半（已生效）

`Slots.listSubTree(root='sidebar.right.pane.tab')` 中占位者含：

```
{ "registrant": "tk", "key": "dsh-plugin-tower", "active": true }
```

`conversation.input.right` 中占位者含：

```
{ "registrant": "tk", "id": "dsh-tower-entry", "order": 40, "active": true }
```

安装前右栏 seat 有 16 个占用者，安装后 17 个。

**面板实际渲染已由用户截图确认**（0.1.0 代）：头部「塔台 全机运行值守」、四格计数条
（1 在飞 / 0 待处置 / 0 后台 / 0 定时）、航班卡（harness · bc835d33-c · 无目标 · 自由航行 ·
打开会话）、后台与定时的空态文案均正确显示。

## 3. Host 半 · 读通道（已生效，真实数据）

```
GET /dsh-tower/api?counts=1
{"ok":true,"counts":{"live":1,"running":1,"goals":0,"urgent":0,"waiting":0,"jobs":1,"schedules":0}}
```

- 重启前的一次采样：`live:4, running:1, jobs:1`，其中 `jobs:1` 命中的正是**执行该 curl 的 bash 作业本身**。
- `running` 由 `agents.turnBoundaryOf(session).openTurnStartSeq !== null` 判定，命中的是当时正在执行的会话。
- 完整包 `GET /dsh-tower/api` 另返回 `flights[]` 与 `schedules[]`；实测 `agentPreset` 取到
  `cordis` / `desktop-repair` / `standard`，`cwd` 正确折叠为 `harness` / `project`。

## 4. Host 半 · 写通道（**已随重启生效**，0.1.2 复测仍为 200/403/405）

0.1.0 代在重启前只注册了 resource 路由（宿主只服务 GET/HEAD），POST 一律 405。
把路由改成 node 风格 handler 后，**替换模块代需重启**才能加载；重启后实测（端口 57212）：

| 请求 | 结果 |
|---|---|
| `POST {"action":"nope"}` | `200` `{"ok":false,"error":"未知动作"}` |
| `POST` + `Origin: http://evil.example` | `403` `{"ok":false,"error":"origin-rejected"}` |
| `POST goal.pause`（不存在的会话） | `200` `{"ok":false,"error":"目标服务不可用，或该会话已不在运行"}` |
| `PUT` | `405` |

即：方法门、同源门、业务门在真机上全部按预期工作。

中间为了在不重启的前提下证明新代码成立，曾临时安装同代码、仅改前缀的探针
（`dsh-plugin-tower-probe` → `/dsh-tower-probe/api`）：GET 200、未知动作 200、跨源 403、死会话业务拒绝、PUT 405。
探针已 `remove_bundle` 并删除目录；profile 的 `bundles` 与 `dependencies` 中只有 `dsh-plugin-tower`。

## 5. 离线测试（可复算）

```
node test/smoke.mjs   → 21 条 PASS
node test/route.mjs   → 9 条 PASS
```

覆盖：目标/作业投影与 10 分钟窗口过滤、作业排序、运行态判定、子代理标记、
`urgent/waiting` 分级与排序、已结束定时任务过滤、`counts=1` 轻量包、
四个动作的分发参数、已关闭会话拒绝动作、未知动作拒绝、全服务缺失降级为空快照、
方法门 / 同源门 / 非法 body 门 / 405 Allow。

## 6. 展示资源

| 项 | 状态 |
|---|---|
| `icon.svg` | 1,314 B，XML 可解析，原创矢量（塔台+信标） |
| `locale/zh.json` | `meta.title=塔台`、`meta.description` 已写 |
| `locale/en.json` | `meta.title=Tower`、`meta.description` 已写 |
| 插件市场卡片里的图标与标题 | **未验证**（无浏览器控制；只确认资源文件与 meta 字段正确） |

## 7. 未验证（诚实清单）

1. **0.1.1 的新界面渲染**：空态三条上手引导、航班卡右侧元信息（预设 · 第 n 轮 · 已运行）只做了
   语法与结构校验，**没有在浏览器里看到**。刷新页面即可自查；若仍是旧界面，重启一次加载 0.1.1 代。
2. **对一个真实存在的 goal 执行暂停/继续/完成**：本机没有 goal。
   刻意**没有**用 `create_goal` 造一个来测 —— 那会给用户会话装上自动续轮，属于污染用户状态换验证。
   该链路目前由「服务契约（`GoalView`/`GoalRef`）+ 离线断言 + 真机业务门拒绝」支撑。
3. **`schedule.run` 的真实投递**：会创建/唤醒会话，同上不制造副作用。
4. 面板在窄宽度（< 300px）下的排版；多 agent（> 10）时的滚动性能。
5. 「刷新页面」能否直接换上 0.1.1 的 Client 代码（取决于宿主是按代路径缓存还是按 profile 链接读取）——
   两种都不影响正确性，只影响是否需要再重启一次。

## 7.5 0.1.2 界面重构（本轮）

改动：设计令牌接入宿主主题、状态行取代四格仪表、作用域（全机/本会话）、
航班卡重排与呼吸点、待处置「稍后 30 分钟」、空态三键复制、区块折叠、
骨架屏、渲染错误边界、真实 CSS（悬停/焦点环/滚动条/`prefers-reduced-motion`）。

- 已验证：`node test/wiring.mjs` 14 条（模块工厂 → tab 类型 → 三个 seat → 渲染边界全部装配成功）；
  语法检查通过；宿主令牌名已由 `Theme.listTokens` 核实（14 个 `--dsw-alias-*` / `--dsw-specific-sidebar-fill`）。
- **未验证**：新界面的实际观感与布局（无浏览器控制）。这是本轮唯一没有硬证据的部分，
  需要刷新页面后由你肉眼确认；若出现布局问题，渲染边界会给出可读错误而不是白屏。

## 7.6 0.1.3 作业日志尾部（真机已验证）

用一个真的在跑的后台作业（`bash-efdf11432ee54f1a`，40 行 `probe-line-N`）走通了整条读链路：

| 请求 | 结果 |
|---|---|
| `?job=bash-efdf11432ee54f1a&session=session-bc835d33-…&tail=300` | `ok`，`total=313`、`from=13`、`truncated=true`，文本尾部为真实的 `probe-line-14: writing` |
| 同上但 `session=` 换成一个不存在的会话 | `{"ok":false,"error":"job bash-efdf11432ee54f1a belongs to another session"}`（由 jobs registry 自己围栏） |
| 省略 `session` | 同样被拒（未拥有作业不可读） |
| `?job=`（空 id） | `{"ok":false,"error":"缺少作业 id"}` |

结论：`jobs.get` + `jobs.readAt` 的 caller 围栏、`from = total - tail` 的截断算法、
以及「只读不动游标」的语义都与契约一致（实测 `readAt` 不移动模型游标，模型侧读取不受影响）。
因为新代码需要重启才能加载到主插件，这里同样用**同代码探针**（`/dsh-tower-probe/api`）在真机上验证，
验证后已移除探针并删除目录。

## 7.7 0.1.4 布局收敛 + 键盘（截图驱动）

用户截图暴露两处：单张航班卡被拉满整个右栏（容器查询在真机上没生效，卡片成了空盒子）；
无目标的卡片只有「打开会话」一条死路。

- 栅格改为 `repeat(auto-fill, minmax(300px, 1fr))`，不再依赖 `@container`（不可靠的机制直接移除）。
- 无目标卡片新增「建目标」：一键复制起手式，粘到输入框即可。
- 状态行加 `·` 分隔；无作用域切换时补「全机」锚点，避免一行数字悬空。
- 面板内键盘：`↑↓`/`j k`、`Enter`、`Esc`；只在根节点获得焦点时生效，不劫持输入框。
- **新增 `test/render.mjs`（22 条）**：用玩具 React 整棵渲染面板，
  覆盖「有数据」（3 航班 / 受阻 / 失败作业 / 定时 / 子代理 / 当前标记）与「空快照」两态。
  这是本轮唯一能自动证明「不会白屏」的手段。

- 已验证：render 22 条 + wiring 14 条 + route 15 条 + smoke 21 条，全 PASS；语法检查通过。
- **未验证**：栅格收敛后的实际观感（需要肉眼确认单卡宽度与两列切换）。

## 7.8 0.1.5 密度 / 折叠记忆 / 最近处置

- **密度切换**：紧凑模式下 `.twr-root[data-density="compact"]` 收起卡片元信息、压缩内距与按钮高度；
  选择写 `localStorage`（`dsh-tower.density.v1`）。
- **折叠记忆**：后台 / 定时 / 最近处置的展开状态写 `dsh-tower.sections.v1`，未手动切换时仍按数据自动展开。
- **最近处置**：Host 侧内存 ring（上限 30，返回最近 20），只在动作**成功后**记录：
  `{ at, verb, sessionId, label, outcome }`。不推测、不补记；重启即清空，所以 UI 明写「本次运行内」。
  这是 L4 审计层的第一步——事件源已经是确定性的，后续只需落盘 + 哈希链。

已验证：route 20 条（新增「快照带处置记录 / 最新一条是刚才的暂停 / 记录带目标原文 / lean 包不带」）、
render 23 条（新增「最近处置」分区）、wiring 14 条、smoke 21 条，共 **78 条全 PASS**。

- **未验证**：紧凑模式在真实右栏下的观感（仍需肉眼），以及密度切换后卡片高度的实际差异。

## 7.9 0.1.6 能力自检（自诊断）

- Host 快照新增 `version`（从安装目录 `package.json` 读取，避免硬编码漂移）与 `caps`：
  `agents / goals / jobs / log / schedule / sessions` 六个布尔，按「服务存在 + 所需方法都在」判定。
- Client 页脚：`v0.1.6 · 本机只读快照…` + 接口状态（齐全=绿点；缺失=琥珀色「N 项不可用」可点开）。
- 目的：把「宿主没提供这个服务」和「确实没有东西在跑」区分开——前者以前表现为静默空区块，
  用户会误判，issue 也没法自带诊断。
- 已验证：route 23 条（版本号格式、caps 全绿、lean 包同样带 caps）、render 26 条
  （页脚版本号、降级时显示「3 项不可用」），连同 smoke 21 + wiring 14 共 **84 条全 PASS**。
- **未验证**：页脚降级条在真实缺失场景下的观感（本机六个服务都在，只能靠假快照渲染验证）。

## 7.10 0.2.0 已收场（v0.2「不漏」的目标部分）

实现：`GET /dsh-tower/api?closed=1&limit=8` —— 用 `sessionPersistence.list/open(read)` 只读打开
**已关闭会话**的持久化日志，按序复算最后一次 `goal/change`，按持久化 `revision` 缓存。
只在面板展开「已收场」时按需调用，所以 4s 轮询完全不碰磁盘。

事件契约不是猜的，来自 `@deepseek-ai/dsh-goal` 的构建产物（`lib/index.js` 已逐段读过）：
`goal/change` 的 `operation ∈ create|edit|pause|resume|complete|block|clear`，
轮次由 `user/message` 的 `source.kind === 'goal'` 推进。

### 真机验证（读链路）

用同代码探针跑真实持久化目录：

| 指标 | 结果 |
|---|---|
| 扫描会话 | 8 个（limit 12，实际候选 8） |
| 读到事件 | **4,668 条**，耗时 **303ms** |
| `goal/*` 事件 | **0 条**（这台机器从未创建过目标） |
| 读取错误 | 0 |

扫描中还观测到这些**以前不知道的持久化事件类型**（对下一步有用）：
`job/registered`、`job/settled`、`permission/preset`、`sandbox/mode`、`approval/policy`、
`model/selection`、`working-directory/change`、`session-log-deepseek/delivery-accepted`。

### 诚实边界

- **读取链路**（list → open(read) → 遍历 → 缓存）已在真机上验证，4,668 条真实事件。
- **goal 折叠逻辑**只在合成事件上验证过（`test/closed.mjs` 15 条），因为本机**没有任何真实 goal 事件**。
  我没有为了验证去 `create_goal` —— 那会给这个会话装上自动续轮，属于用污染用户状态换测试。
- 因此「已收场」在本机目前会显示「没有带目标的已关闭会话」。这是**正确结果**，不是故障。

### 顺带确认的下一步

`job/registered` / `job/settled` 是**持久化**的 —— 这意味着 v0.2 剩下的「作业 24h 历史」
不需要新的宿主接口，同样可以从会话日志复算。这是下一版最省力的高价值项。

## 7.11 0.2.1 作业历史（真机已验证）

事件形状来自**真实持久化日志抽样**（探针读取，不是猜文档）：

```
job/registered { jobId, owner, kind, label, startedAt, toolCall }
job/settled    { …同上…, finishedAt, status:'completed'|'killed'|'failed', cause, detail }
```

实现：`GET /dsh-tower/api?history=1&limit=20&window=86400000`
—— 扫描最近 12 个会话的持久化日志，按 `jobId` 配对两条事件，只保留已收口且在窗口内的作业，
按结束时间倒序；每个会话的提取结果按 `revision` 缓存。只在展开「作业历史」时按需调用。

### 真机结果

| 指标 | 结果 |
|---|---|
| 扫描会话 | 12 个 |
| 24h 内已收口作业 | **610 条** |
| 返回 / 上限 | 8 / 8（limit=8） |
| 读取失败 | 0 |
| 耗时 | 541ms |
| 窗口参数 | `window=60000` → 60s 内 5 条（参数生效） |

状态、持续时间（`finishedAt - startedAt`）、`detail`（如 `exit code: 0`）均为真实值。

### 口径说明（写进 UI）

`total` 是**这 12 个被扫描会话内**的窗口总数，不是全局总数。所以面板文案写的是
「已扫描 {n} 个会话 · 共 {total} 条」，不假装是全量。

### 边界

- 只覆盖最近 12 个会话（按 createdAt 倒序）—— 更早的会话不在窗口内，这是刻意的成本取舍。
- 只列**已收口**的作业；正在跑的仍在「后台作业」区（实时数据）。
- `cause` / `producerReported` 字段已取到但暂不展示（先不增加噪音）。

## 7.12 0.3.0 静默检测 + 本地通知

### 静默检测（Host，可测）

规则：`goal.phase === 'active'`、当前没在跑、且 `lastEventAt` 距今 > **20 分钟** → 一条 `goal.idle`（waiting 级）。

`lastEventAt` 由 `agents.turnBoundaryOf(session).lastStepBoundary.seq` 反查 `session.eventAt(seq).time`，
比 `goal.updatedAt`（只在目标变更时更新）更接近「有没有动静」。

已验证：`test/idle.mjs` 8 条 —— 25 分钟无动静会报、1 分钟前有动静不报、正在跑不报、
已暂停不报（paused 自己会报）、阈值确为 20 分钟。

### 本地通知（Client，**无法在此环境验证**）

- 头部「通知」开关：点击 → `Notification.requestPermission()` → 授予后写本地偏好并**立即发一条确认通知**。
- 只在**窗口不在前台**（`document.hasFocus() === false`）时弹；只弹 `urgent`；同一 key 6 小时内不重复
  （`localStorage` 记录，跨刷新有效）。
- 点击通知：`window.focus()` + 打开右侧栏 + 跳到对应会话。
- 权限被拒/环境不支持时，页脚用琥珀色文字说明原因，而不是静默失败。

**能验证的**：候选筛选逻辑（`test/notify.mjs` 7 条）与渲染（render 30 条）。 
**不能验证的**：真实弹窗、系统权限弹框、点击通知的聚焦行为 —— 需要你在真实窗口里点一次。

## 7.13 0.4.0 审计落盘（L4 首片）

默认**关闭**；开启后把「人点过且成功」的动作追加到本地 JSONL，每条带前一条的 `sha256`，形成哈希链。

- 位置：`$DSH_HOME/.dsh/tower/audit.jsonl` + `audit.json`（只写插件自己的状态目录，不碰用户工作区）
- 记录：`{ seq, at, verb, sessionId, label, outcome, prev, hash }`
- `hash = sha256(prev|seq|at|verb|sessionId|label|outcome)`
- 接口：`?audit=1` 状态 / `?audit=1&verify=1` 重算整条链 / `?audit=1&download=1` 导出 / POST enable|disable
- 关闭时连目录都不创建（测试断言了这一条）

已验证 `test/audit.mjs` 12 条：
默认关闭 → 开启 → 写两条 → `prev` 指向正确 → 校验通过 → **改掉第一条的 label 被检出（at=1, reason=hash）**
→ **删掉首条被检出（at=1, reason=seq）** → 关闭后不再追加。

用临时 `DSH_HOME` 沙箱跑，**不会碰你真实的审计目录**。

诚实边界：这是「可校验」而不是「不可篡改」——文件在本机，有权限的人可以整条重写；
但重写必然破坏链，`verify` 会点名断点。真正的不可篡改需要外部锚定（时间戳服务/另一台机器），不在本版范围。

## 7.14 0.5.0 值守报告（L3 治理首片）

`GET /dsh-tower/api?report=1&hours=24` 把四类数据源压成一页 Markdown：
待处置 / 本次处置 / 后台作业历史 / 已收场会话 / 审计链状态。

- 纯读：不改状态、不写盘（除非审计本身已开启）
- 缺服务时对应小节写「无」，不报错
- **报告是给人看的**：verb / 作业状态 / 目标阶段都做了中文标签
  （第一版漏出 `pause`、`failed` 这种原始枚举，是测试断言抓到的，已修）
- 明确声明「不含对话内容」

已验证 `test/report.mjs` 16 条：标题在首行、带版本号、五个小节齐全、处置时间线含刚才的暂停、
历史作业用中文状态、已收场目标进入报告、审计关闭时写「未开启」、服务全缺仍能生成、结尾声明。

用临时 `DSH_HOME` 沙箱，不碰真实审计目录。

## 7.15 0.6.0 策略文件 + 与账本插件共存验证

### 策略文件

`$DSH_HOME/.dsh/tower/policy.json`（可选；不存在即用保守默认）。按 mtime 失效缓存，**改完即生效**。

| 字段 | 默认 | 作用 |
|---|---|---|
| `idleMinutes` | 20 | 多久无提交事件判为「可能空转」 |
| `historyHours` / `historyLimit` | 24 / 20 | 作业历史窗口与条数 |
| `notifyOnlyUrgent` | true | 通知是否只弹紧急项 |
| `autoPause.enabled` | **false** | 超时自动暂停目标 |
| `autoPause.afterIdleMinutes` | 45 | 自动暂停阈值 |

自动暂停的三条约束（都已断言）：只对 `phase==='active'`、当前没在跑、且 `lastEventAt` 超过阈值的目标动作；
每次动作记入处置历史与审计（`verb=auto-pause`）；冲突或不可暂停时静默跳过、不重试。

`test/policy.mjs` 13 条：默认值 / 下限上限夹取 / 非法类型退回 / 文件生效 / idleMinutes=5 时 10 分钟能报空转 /
默认关闭时不动手 / 开启后 60 分钟被暂停 / 快照报告 autoPaused / 记入处置 / **正在跑的目标不暂停**。

### 与账本（dsh-plugin-ledger）共存验证

两个插件同 profile、同右栏、同一宿主进程，实测互不干扰：

| 检查项 | 证据 |
|---|---|
| 右栏 tab 共存 | `sidebar.right.pane.tab` 共 17 个占用者，`@lingda-ai/ledger` 与 `dsh-plugin-tower` 均 `active: true` |
| 账本仍活着 | 账本快照 `~/.dsh/ledger/session-bc835d33-….json` 在检查时 **2 秒前**刚更新（12,210 字节） |
| 数据目录不重叠 | 账本写 `~/.dsh/ledger/`；塔台写 `~/.dsh/tower/`。检查时 `tower` **目录尚未创建** —— 印证「审计默认关闭时不落盘」 |
| 路由不冲突 | 塔台唯一路由 `/dsh-tower/api`；账本走 `workspaceFiles` 读工作区 JSON，不注册 HTTP 路由 |
| 样式不冲突 | 塔台所有类名 `.twr-` 前缀；账本自成一体 |

结论：**共存无回归**。塔台新增的 section 都在自己的 tab 内，不触碰账本的 tab 与其快照文件。

## 7.16 0.7.0 账本可选集成（隔离优先）

**隔离规则（三条硬规则，有测试守卫）**
1. 塔台不 import 账本、不加任何 dependency/peerDependency（`test/ledger-bridge.mjs` 静态检查 package.json 与源码里是否出现 `@lingda-ai`）；
2. 账本不感知塔台（塔台只读它已经写出的快照文件）；
3. 只读、可缺席：目录不在 / `version!==1` / 坏 JSON / 多币种 → 成本节整段消失，**不显示 ¥0、不报错**。

**四种部署矩阵**

| 部署 | 报告成本节 | 其余功能 |
|---|---|---|
| 只装塔台 | 不出现 | 完整 |
| 只装账本 | 不适用 | 完全不受影响 |
| 都装 | 出现 | 完整 |
| 都装但账本停了 | 出现并标「数据可能已过期」 | 完整 |

**双模口径（关键取舍）**
- 所有纳入的会话都带 `window` → 用窗口增量，报告写「窗口内增量」；
- 否则**统一退回 `totals` 累计**，报告写「自开始以来的累计（口径偏大）」；
- **绝不把两种口径相加** —— 有一条断言专门守这个（混合时 1.5+1.5=3.0，而不是 1.5+0.5）。

已验证 `test/ledger-bridge.mjs` 22 条：缺席 / 累计 / 窗口 / 混合退回 / 多币种拒绝 / 坏文件跳过 /
48 小时前活跃的会话不进 24h / `includeCost=false` 关闭 / 陈旧标注 / 截断提示 / 静态隔离守卫。

**未验证**：真实账本文件里是否已存在 `window` 字段（当前没有，需先在账本侧加，见 integration-ledger.md §5 阶段 1）。

## 7.17 账本侧 window 增量（0.1.14）与塔台 0.7.1

### 账本改了什么

`store.windowTotals(sessionId, {hours, now})`：只读环上条目，按 `at >= since` 聚合
`cost / saved / entries / knownEntries / unknownEntries / currency / covered`。
快照新增 `window` 字段；`version` 保持 1（纯增量，老消费方忽略即可）。

关键诚实字段 **`covered`**：环里最老条目晚于窗口起点时，说明窗口起点前的条目已被淘汰 →
`covered=false`，消费方必须据此降级标注，而不是把残缺数字当完整。

- 仓库：`@lingda-ai/ledger` 0.1.3（实现）→ 用 `scripts/build-bundle.mjs 0.1.14` 重建自包含单包
- 测试：新增 `test/window.test.mjs` 5 例（窗口过滤 / unknown 不折 0 / covered 两态 / snapshot 仅在请求时带 / payload 透传）；
  全量 **256 例通过**
- 已装：`lingda-ai+dsh-plugin-ledger+0.1.14+96e7fde9f88e`

### 塔台 0.7.1 改了什么

读到账本 `covered=false` 时，报告追加「部分会话的窗口可能不完整（账本环已淘汰早期条目）」，
并把 `incomplete` 带进 `readLedgerCosts` 的返回值（`test/ledger-bridge.mjs` +3 条断言）。

### 未验证（需一次重启）

新代码要重启才进宿主。重启后可确认：账本快照文件里出现 `"window": {…}`，
且塔台的「值守报告」成本节口径从「累计」变成「窗口内增量」。

## 7.18 运行态核查：**装了 ≠ 生效**（2026-11-21 15:53 发现）

排查截图与 API 后发现一件比功能更严重的事：

| 事实 | 证据 |
|---|---|
| 宿主进程自 **14:18:24** 起未重启 | `ps -o lstart` 显示主进程启动时间；当前 15:53，已连续运行 1h35m |
| 运行中的塔台是 **0.1.6** | `GET /dsh-tower/api?counts=1` 返回 `"version":"0.1.6"` |
| 0.2.0 → 0.7.1 全部只落到磁盘 | profile 的 `generationProjection`、pnpm override、node_modules 链接都指向 0.7.1，但进程未加载 |
| 界面缺失印证 | 用户截图没有「通知」（0.3.0）、「审计」（0.4.0）、「已收场」（0.2.0）、「值守报告」（0.5.0） |
| 账本同理 | 运行中的账本仍是旧代；快照文件仍由旧代码每 3 秒重写（mtime=当前），所以「40 分钟前」是**面板自身没刷新**，不是账本停了 |

**根因**：`plugin_manager` 的 remove/install 会切换「代」，但**宿主进程已经加载的模块不会热替换**。
必须**完全退出 App 再打开**（不是刷新页面、不是切换会话）。刷新只会重载浏览器模块，Host 半仍是旧代。

### 如何确认自己跑的是哪一代（两条命令/两处可见）

```bash
# 1) Host 半（权威）
curl -s http://127.0.0.1:<当前端口>/dsh-tower/api?counts=1 | python3 -c "import sys,json;print(json.load(sys.stdin)['version'])"

# 2) 浏览器半：面板页脚左侧的 v 号
```

两者必须都等于当前发布版本（0.7.1）；不一致时以「Host 返回的 version」为准，并重启 App。

### 教训

之前的「需要重启」只是口头约定，从未被程序化验证——而**一次没重启，就足以让 7 个版本的迭代全部不可见**。
后续每次升级，必须先用上面第 1 条命令确认版本，再谈界面变化。

## 7.19 重启后实机复核（0.7.1）+ 报告可读性修正（0.7.2）

**重启后确认**（这次是真重启，宿主进程时间戳与 API 一致）：

| 检查 | 结果 |
|---|---|
| Host 版本 | `GET /dsh-tower/api?counts=1` → `"version":"0.7.1"`；面板页脚 `v0.7.1` |
| 新界面 | 通知 / 审计 / 作业历史 / 已收场 / 值守报告 全部出现 |
| 账本写入 | 快照文件含 `window: { hours:24, cost, saved, entries, covered:false, … }` |
| **端到端成本** | 报告「成本（来自账本）」：`合计 ¥0.0840 / 5 次调用 · 缓存已省 ¥3.14`，口径写的是**窗口内增量**，并带「窗口可能不完整」提示 |

`covered:false` 是真实情况（重启后内存环只有少量条目），塔台照实标注——这正是加这个字段的目的。

**账本面板一度显示「还没有成本快照」**：不是坏，是时序——截图时间 16:00:59，而重启后快照文件到 16:02:22 才由下一次模型调用触发落盘；面板每 5s 轮询，之后即恢复。

**0.7.2 修的是报告可读性**：24h 内 731 条已收口作业原来会直接铺 20 行日志，把一页交接变成日志墙。
现在改为「汇总 → 失败明细（最多 5 条）→ 省略条数」：结论先行，失败优先。

## 7.20 产物级验收（0.7.2 npm 包）

不再只验仓库，而是**验发出去的那一份**：`scripts/verify-artifact.mjs`。

对 `npm i dsh-plugin-tower@0.7.2` 装出来的目录跑 33 项检查，全部通过：

- manifest：name/version/非 private/bundle.patch/client.platform/client.inject/exports/icon/engines
- patch：insert 行、`name` 与包名一致、行 id = `dsh-tower`
- Host：语法、`apply`/`inject=['webServer']`、可被 Node 真正 import、`__internal` 含报告与账本读写
- client：第一条语句是 `__ModuleLoader__.load`、**只调用一次**（剥注释后判断）、无 import/export、id 正确
- 资源：icon 是 SVG 且 <256KiB、zh/en 都有 `meta`
- **隔离**：Host/client 源码都不出现 `@lingda-ai`，manifest 不含账本依赖
- **把仓库 12 个测试文件拷进产物目录再跑一遍 → 全过**

同时支持 `--pack`：直接从仓库打 tarball 再验，不依赖 registry，用作发布前闸门。

**仍未验证**：在**干净 profile** 里真正 boot 一次（本机无法在不影响现有 profile 的前提下创建第二个
profile——需要 App 的 profile 切换器或 `dsh` CLI）。这一条只能由人或新机器完成。

## 7.21 0.8.0 待答队列（谁在等你）

产品承诺的三件事里，「谁等你」一直缺着——宿主没有待答只读接口，面板只能看到目标受阻与作业失败。

**做法**：从会话事件流推断。`ctx.on('session/event')`（根 ctx 订阅）上折叠：
`tool/call`(name=`ask_user_question`) 建立 → `tool/result` 同 `callId` 收口 → `turn/end` 兜底清本会话 → 30 分钟 TTL 过期。
问题原文从 `args.questions[0].question` 取（args 可能是对象，也可能是 JSON 字符串，两种都测了）。

事件形状不是我猜的：账本的采集层生产代码就在读 `tool/call` 的 `name` 与 `callId`。

- 待答在待处置里**排最前**（agent 正卡着，不回答就不动）；
- 只对**仍在运行**的会话报（会话已关，问题也就不成立）；
- 快照新增 `questions` 与 `stream: {seen, lastAt, lastType}`——后者是这条通道的自检，
  `seen > 0` 即证明订阅真的通了（重启后可直接用 API 验证）。

已验证 `test/questions.mjs` 15 条：折叠 / 字符串 args / 非该工具不入队 / 收口 / 兜底清除 / TTL / 只对在跑会话 / 排序 / 自检字段。

**未验证**：真实触发一次 `ask_user_question` 时的端到端表现（需要真的有人被问）。
重启后可先用 `stream.seen > 0` 证明订阅活着。

## 7.22 0.9.0 报告预览排版 + 可分享 HTML

截图暴露的问题：报告预览是 `<pre>` 原样 Markdown，`##`、`-`、空行全都露出来，读起来像源码。

- **面板侧**：组件内小渲染器把报告排成 h1/h2/列表/加粗/分隔线，**不引第三方 Markdown 库**
  （只覆盖报告自己的语法，同时把 XSS 面压到最小——尖括号一律按文本经 React 转义）。
- **分享形式**：新增 `GET /dsh-tower/api?report=1&format=html&hours=24`，
  返回**单文件网页**（内联样式、无外部依赖、跟随系统浅/深色），带 `content-disposition` 下载名。
  队友不用装任何东西，双击就能看——这比导出一个 JSON「镜面」有用得多。

已验证：
- `test/markdown.mjs` 10 条（标题/列表/加粗/无残留记号/尖括号转义）
- `test/report.mjs` +5 条（`markdownToHtml` 的 h1/h2/li/strong/hr + `<script>` 被转义）
- `test/route.mjs` +4 条（`format=html` 的 content-type、下载名、完整文档、独立样式）
- 合计 **257 条**；产物闸门 33 项 + 14 个测试文件全过

## 7.23 0.9.1 沙箱测试闸门（把两次教训固化）

同一个月里踩了两次同一类坑：**测试/发布依赖了开发者本机的状态**。

1. 账本 CI 连红三次：`archive` e2e 隐式读 `~/.dsh/ledger/pricing.json` 才算出价；
2. 塔台同类：测试若读真实 `$DSH_HOME`，本机有 `policy.json` 时
   「默认闲置阈值 20 分钟」的断言就会本机失败、CI 通过。

固化方式：
- `scripts/run-tests.mjs`：每个测试进程注入**全新 `HOME` 与 `DSH_HOME`**（含 XDG），跑完清理；
- `npm test` 与产物闸门都走它；产物内测试同样在沙箱 env 里跑；
- 产物包现在包含 `scripts/` 与 `test/`，装完可以自己 `npm test` 复验。

**负向验证**：把 `DSH_HOME` 指向含 `{"idleMinutes":5}` 的目录裸跑 `test/route.mjs` →
`FAIL: 快照带策略（默认 20 分钟）`；同一条测试走沙箱跑者 → 46 条全过。闸门不是摆设。

## 7.24 0.10.0 团队共享策略（L3 另一半）

团队要的是「同一套判定规则」，个人要的是「自己的通知偏好」。两者不能互相冲掉。

- 新增 `TOWER_POLICY` 环境变量：指向一份团队策略文件（可放在受版本控制的仓库里）；
- 合并顺序 **内置默认 ← 本机 ← 团队**：团队只覆盖显式写了的键，嵌套对象按子键合并；
- 来源可见：快照带 `policySources`（路径/是否可用）与 `policyWarnings`，
  报告里写「来源：本机 + 团队共享」，页脚在策略解析失败时显示「策略有警告」。

**过程中抓到一个典型死法**：`resolve` 没有 import，`try/catch` 把它吞成了 `null`，
于是「团队策略永远不生效」且**没有任何报错**——所有测试还都过（因为都在测本机层）。
补上 import 后立刻暴露；同时把 `size` 加进缓存键（同一毫秒内改写两次时 mtime 不变，只看 mtime 会读旧值）。

测试 `test/team-policy.mjs` 13 条：覆盖同名键 / 未提及键保留 / 子键合并 / 合法大值不被乱改 /
越界夹到 1440 / 坏文件时本机仍生效且有告警 / 来源入快照。合计 **15 个文件 272 条**。

## 7.25 0.11.0 批次 A：诚实与安全

三件事都是「看起来能用、实际不对」的问题，不影响演示，影响可信度。

**① 「建目标」名不副实**
按钮原来只调 `onCopy()`，复制一句提示词到剪贴板，却写着「建目标」。
核对宿主服务发现 `goals.create(agent, { objective, maxGoalRounds })` 一直存在——
于是改成真建：行内输入 → `goal.create` 动作（去空白、≤500 字、轮次夹到 1..50）。
老宿主没有 `create` 时，按钮**诚实退化**为「复制建目标指令」，不再假装建好。
能力位 `caps.goalCreate` 决定显示哪一种。

**② 破坏性动作零确认**
`goal.complete` / `job.kill` 原来一点就发。300px 右栏 + 鼠标误点就能终止正在跑的作业。
改成两段确认：第一次只上膛（按钮变「确认完成？」），4 秒内再点才执行，超时自动复位。

**③ 审计会无限增长、且没有「谁」**
- 单文件超过 5MB 轮转成 `audit.jsonl.1`（保留一份备份）；链是**每文件一条**，不跨文件续接；
  `TOWER_AUDIT_MAX_BYTES` 可覆盖上限（测试用它把阈值压到 400B 来验证轮转）。
- 记录带 `v: 2` 与 `actor: { user, host }`；**哈希口径随之升级**（v2 纳入 actor，
  v1 老记录按原口径校验，因此历史日志仍可验证，而「谁」一旦被改会被检出）。

测试：`actions` 10 条（真调用/去空白/夹取/拒绝/能力位）、`audit` +3（v2/actor/状态）、
`audit-rotate` 6 条（轮转/上界/链仍可校验）。合计 **17 个文件 294 条**；产物闸门通过。

**未验证**：界面上真点一次「建目标」和两段确认（需要人点，且要重启后在真实宿主里）。

## 8. 你现在需要做的事

1. **刷新页面**看 0.1.1 的空态与航班卡信息。
2. 若界面没变化：**重启一次 DSH Desktop**，加载 `0.1.1+925f9d56b54d` 模块代。
3. 想看动作真跑起来：给某个会话建一个目标（对 agent 说「给这件事建一个目标」），
   塔台里就会出现目标卡与暂停/继续/完成按钮。
