# 实机验证记录 · dsh-plugin-tower

> 环境：DSH Desktop，profile `desktop`。GUI 在过程中重启过两次，端口随之变化（64700 → 57212）。
> 记录时间：2026-11-21（Asia/Shanghai）。
> 规则：**只写看到的结果**。没验证的写进「未验证」，不冒充。

## 1. 安装态

| 项 | 值 |
|---|---|
| 包 | `dsh-plugin-tower@0.1.2` |
| Loader 行 | `include:dsh-tower`（bundle `dsh-plugin-tower`） |
| 模块代（当前） | 见 §1.1（0.1.2 安装后回填） |
| 历史模块代 | `0.1.0+fc656e3cdee5`、`0.1.0+681676529899`、`0.1.0+e52103ad2269`、`0.1.1+925f9d56b54d` |
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

## 4. Host 半 · 写通道（**已随重启生效**）

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

## 8. 你现在需要做的事

1. **刷新页面**看 0.1.1 的空态与航班卡信息。
2. 若界面没变化：**重启一次 DSH Desktop**，加载 `0.1.1+925f9d56b54d` 模块代。
3. 想看动作真跑起来：给某个会话建一个目标（对 agent 说「给这件事建一个目标」），
   塔台里就会出现目标卡与暂停/继续/完成按钮。
