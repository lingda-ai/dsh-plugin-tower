# 实机验证记录 · dsh-plugin-tower 0.1.0

> 环境：DSH Desktop，Web GUI `http://127.0.0.1:64700`，profile `desktop`。
> 记录时间：2026-11-21（Asia/Shanghai）。
> 规则：**只写看到的结果**。没验证的写进「未验证」，不冒充。

## 1. 安装态

| 项 | 值 |
|---|---|
| 包 | `dsh-plugin-tower@0.1.0` |
| Loader 行 | `include:dsh-tower`（bundle `dsh-plugin-tower`） |
| 模块代 | `dsh-plugin-tower+0.1.0+fc656e3cdee5` |
| Config schema | 无（本插件不暴露配置项） |
| 用户自己的补丁层 | **未被修改**（仅经 bundle 通道挂载） |

模块代目录内已确认包含：`index.js` / `client.js` / `cordis.patch.yml` / `icon.svg` /
`locale/{zh,en}.json` / `README.md` / `docs/`。

## 2. Client 半（已生效）

`Slots.listSubTree(root='sidebar.right.pane.tab')` 中，占位者列表含：

```
{ "registrant": "tk", "key": "dsh-plugin-tower", "active": true }
```

即：右栏 tab 的**正文 seat 已登记且处于 active**。安装前该 seat 有 16 个占用者，安装后 17 个。

## 3. Host 半 · 读通道（已生效，真实数据）

```
GET /dsh-tower/api?counts=1
{"ok":true,"counts":{"live":4,"running":1,"goals":0,"urgent":0,"waiting":0,"jobs":1,"schedules":0}}
```

- `live: 4` —— 与宿主 `agents.list()` 实际活 agent 数一致（3 个普通会话 + 本会话）。
- `running: 1` —— 由 `agents.turnBoundaryOf(session).openTurnStartSeq !== null` 判定，命中的正是**当时正在执行的这个会话**。
- `jobs: 1` —— 命中的正是**执行这条 curl 的那个 bash 后台作业**（作业标签即命令原文）。
  这是自指的巧合，也是一次干净的真机证明：面板确实看到了「正在跑的东西」。
- 完整包 `GET /dsh-tower/api` 另返回 `flights[]`（含 `cwdName`、`agentPreset`、`turn`、`goal`、`jobs`）
  与 `schedules[]`；实测 `agentPreset` 正确取到 `cordis` / `desktop-repair` / `standard`，
  `cwd` 正确折叠为 `harness` / `project`。

## 4. Host 半 · 写通道（**需重启后生效**；已用同代码探针证明）

对当前**已安装**模块代发 POST，返回 `405`（`Allow: GET, HEAD, POST` 由宿主方法门产生）。
原因：替换已安装包需要重启 Harness 才能加载新的 Host 模块代 —— 这是 DSH 的模块代机制。

为在**不重启**的前提下证明新代码在真机上成立，临时装了同一份代码、只改前缀的探针
（`dsh-plugin-tower-probe` → `/dsh-tower-probe/api`，全新安装可通过 HMR 立即生效）：

| 请求 | 结果 |
|---|---|
| `GET /dsh-tower-probe/api?counts=1` | `200`，快照与主插件一致 |
| `POST {"action":"nope"}` | `200` `{"ok":false,"error":"未知动作"}` |
| `POST` + `Origin: http://evil.example` | `403` `{"ok":false,"error":"origin-rejected"}` |
| `POST goal.pause`（不存在的会话） | `200` `{"ok":false,"error":"目标服务不可用，或该会话已不在运行"}` |
| `PUT` | `405`，响应头 `allow: GET, HEAD, POST` |

探针已移除（`remove_bundle`），其目录已删除；profile 的 `bundles` 与 `dependencies` 中
现在只有 `dsh-plugin-tower` 一个条目。

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
| `icon.svg` | 1314 B，XML 可解析，原创矢量（塔台+信标） |
| `locale/zh.json` | `meta.title=塔台`、`meta.description` 已写 |
| `locale/en.json` | `meta.title=Tower`、`meta.description` 已写 |
| 渲染后的图标/标题（插件市场卡片、设置里的插件行） | **未验证**：本会话无浏览器控制能力，不做视觉断言 |

## 7. 未验证（诚实清单）

1. **浏览器内的点击链路**：入口按钮 → `layout.openRightbar()` → `sidebarRight.openTab('tower.supervision')`
   是否真的选中 tab；`openTab` 的两种调用形态（裸 kind / 带 `{params}`）哪一种生效，未在真机点击中确认。
2. **对一个真实存在的 goal 执行暂停/继续/完成**：本机当前没有任何 goal。
   刻意**没有**用 `create_goal` 造一个来测 —— 那会给用户的会话装上自动续轮，
   属于污染用户状态换验证，不做。该链路当前由「服务契约（`GoalView`/`GoalRef`）+ 离线断言」支撑。
3. **`schedule.run` 的真实投递**：会创建/唤醒会话，同上不制造副作用。
4. 面板在窄宽度（< 300px）下的排版；多 agent（> 10）时的滚动性能。
5. 重启后新模块代的自动加载（需用户重启一次，见 README）。

## 8. 用户需要做的一件事

**重启一次 DSH Desktop**（或下次启动应用）。
重启后 Host 路由从「GET-only」切换到「GET+POST」，三个动作按钮才会真正生效；
Client 半也会加载本代代码（`openSession` 的直接寻址修正）。
