# 实机验证记录 · dsh-plugin-tower

> 环境：DSH Desktop，profile `desktop`。GUI 在过程中重启过两次，端口随之变化（64700 → 57212）。
> 记录时间：2026-11-21（Asia/Shanghai）。
> 规则：**只写看到的结果**。没验证的写进「未验证」，不冒充。

## 1. 安装态

| 项 | 值 |
|---|---|
| 包 | `dsh-plugin-tower@0.4.0` |
| Loader 行 | `include:dsh-tower`（bundle `dsh-plugin-tower`） |
| 模块代（当前） | `dsh-plugin-tower+0.4.0+828a5b0628c3` |
| 历史模块代 | `0.1.0+fc656e3cdee5`、`0.1.0+681676529899`、`0.1.0+e52103ad2269`、`0.1.1+925f9d56b54d`、`0.1.2+6affd6c677dc`、`0.1.3+9a8aba3592e2`、`0.1.4+7456f05f6754`、`0.1.5+e046b59b0515`、`0.1.6+ffaede5583b8`、`0.2.0+0f0fa40a9051`、`0.2.1+50b17b476bed`、`0.3.0+191fc799cf0c` |
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

## 8. 你现在需要做的事

1. **刷新页面**看 0.1.1 的空态与航班卡信息。
2. 若界面没变化：**重启一次 DSH Desktop**，加载 `0.1.1+925f9d56b54d` 模块代。
3. 想看动作真跑起来：给某个会话建一个目标（对 agent 说「给这件事建一个目标」），
   塔台里就会出现目标卡与暂停/继续/完成按钮。
