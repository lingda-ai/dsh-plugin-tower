# 塔台 · 架构与契约

> 面向二次开发或排查问题的人。使用说明见 [README](../README.md)。

## 1. 形态

一个 bundle 包，Host + Client 两半，只依赖宿主既有能力：

```
宿主 Web 服务
  └─ /dsh-tower/api            ← Host 半注册的唯一路由（同源、只读为主）
        ├─ GET  快照 / 报告 / 审计 / 作业日志 / 已收场
        └─ POST 一个动作（目标暂停·继续·完成 / 作业终止 / 定时立即执行 / 审计开关）

浏览器侧
  ├─ 右栏 tab 类型  tower.supervision     （sidebarRightTabs.register）
  ├─ 正文 seat      sidebar.right.pane.tab        key = dsh-plugin-tower
  ├─ 标题 seat      sidebar.right.pane.tab.title  key = dsh-plugin-tower
  └─ 输入框入口     conversation.input.right      id  = dsh-tower-entry
```

Client 入口必须是 **classic script**（`window.__ModuleLoader__.load({ id, factory })`），
不能出现 `import`/`export`——宿主会把所有插件的 `client.js` 原样拼接成一个脚本。

## 2. HTTP 契约

所有响应 `application/json`、`cache-control: no-store`。POST 只接受同源页面（有 `Origin` 就必须同源）。

| 方法与参数 | 返回 |
|---|---|
| `GET /dsh-tower/api` | 完整快照：`version` `caps` `policy` `counts` `attention` `flights` `schedules` `recent` `questions` `stream` |
| `GET /dsh-tower/api?counts=1` | 轻量包：`counts` + `attention` + `policy`（输入框角标用） |
| `GET ?job=<id>&session=<sid>&tail=4000` | 作业输出尾部：`total` `from` `truncated` `lossy` + `text`（只读，不动模型游标） |
| `GET ?closed=1&limit=8` | 已关闭会话的最后目标（只读复算持久化日志，不唤醒会话） |
| `GET ?history=1&limit=20&window=86400000` | 跨会话作业历史：`jobs` `total` `byStatus` `scanned` |
| `GET ?report=1&hours=24` | 值守报告：`markdown` + `generatedAt` + `windowHours` |
| `GET ?report=1&format=html&hours=24` | 同一份报告的**单文件网页**（内联样式、无外部依赖），带下载文件名 |
| `GET ?audit=1` / `?audit=1&verify=1` / `?audit=1&download=1` | 审计状态 / 重算哈希链 / 导出 ndjson |
| `POST {"action": …}` | `goal.pause\|resume\|complete`、`job.kill`、`schedule.run`、`audit.enable\|disable` |

失败语义：HTTP 状态只表达传输层（200/400/403/405/500），业务失败一律 `200 + {ok:false, error}`，
错误文案直接可读（中文）。动作带 `revision` 做乐观并发，冲突原样回传。

## 3. 数据来源

| 区块 | 宿主服务 | 缺失时 |
|---|---|---|
| 航班 / 在跑判定 | `agents.list()` `agents.get()` `agents.turnBoundaryOf()` | 航班区空 |
| 目标 | `goals.get()` / `pause` `resume` `complete` | 目标动作不可用，页脚报「目标不可用」 |
| 后台作业 | `jobs.list()` `kill()` `get()` `readAt()` | 后台区空、日志入口消失 |
| 定时 | `schedule.catalog()` `run()` | 定时区空 |
| 已收场 / 作业历史 | `sessionPersistence.list/open('read')` | 两区显示「无」并带原因 |
| 工作区名 / 事件时间 | `sessions.get()`；`turnBoundary.lastStepBoundary.seq` → `eventAt()` | 名称退化为短 id |
| 待答（谁在等你） | **事件流**：`ctx.on('session/event')` 折叠 `tool/call`(ask_user_question) → `tool/result` | 待答区为空，其余不受影响 |
| 成本（可选） | 只读 `~/.dsh/ledger/*.json`（不 import 账本） | 成本节整段消失 |

能力自检 `caps` 在快照里暴露六个布尔（`agents/goals/jobs/log/schedule/sessions`），
页脚据此显示「N 项不可用」——把「宿主没有」和「真的没有东西在跑」区分开。

## 4. 关键设计决策

1. **确定性优先**：待处置只由规则产生（目标受阻 / 暂停 / 作业失败 / 超时无事件），不含模型判断。
2. **一次点击一个动作**：不批量、不自动重试、不静默补偿；失败可见。
3. **乐观并发**：所有目标动作带 `revision`，被别处改过就报冲突，不覆盖。
4. **只读为主**：唯一写盘是用户显式开启的审计；关闭时连目录都不创建。
5. **账本双模**：账本快照有 `window` 就用窗口增量，否则用累计并**写明口径**；
   绝不把两种口径相加，`covered:false` 一路带出成「窗口可能不完整」。
6. **渲染兜底**：面板内部异常收敛成可读错误 + 重试，不白屏。
8. **预览自己渲染**：面板用组件内的小渲染器把报告 Markdown 排成 h2/列表/加粗，**不引第三方 Markdown 库**
   （只覆盖报告自己的语法，顺带避免 XSS 面）。
7. **待答靠事件推断**：宿主没有待答只读接口，改从会话事件流配对（`tool/call` ↔ `tool/result`，`turn/end` 兜底，30 分钟 TTL）。
   快照里的 `stream.{seen,lastAt,lastType}` 是这条通道的自检：`seen>0` 说明订阅真的通了。

## 5. 测试

| 文件 | 覆盖 |
|---|---|
| `test/smoke.mjs` | 快照投影、过滤、排序、动作分发、全服务缺失降级 |
| `test/route.mjs` | 方法门 / 同源门 / body 门 / 各端点契约 |
| `test/wiring.mjs` | 客户端装配：tab 类型 + 三个 seat + 边界 |
| `test/render.mjs` | 玩具 React 整棵渲染（有数据 + 空态 + 降级） |
| `test/closed.mjs` | 已关闭会话目标复算（事件折叠 / 缓存 / 跳过 live） |
| `test/history.mjs` | 作业历史（配对 / 窗口 / 状态汇总 / 缓存） |
| `test/idle.mjs` | 静默检测阈值与例外 |
| `test/notify.mjs` | 通知候选筛选（只弹 urgent、6h 去重） |
| `test/audit.mjs` | 哈希链：追加 / 校验 / 篡改检出 / 关闭停写 |
| `test/report.mjs` | 值守报告小节、中文标签、缺服务降级 |
| `test/policy.mjs` | 策略默认值 / 夹取 / 热更新 / 自动暂停 |
| `test/questions.mjs` | 待答队列：折叠 / 收口 / 兜底清除 / TTL / 只对在跑会话生效 |
| `test/markdown.mjs` | 报告预览渲染：标题/列表/加粗/无残留记号/尖括号转义 |
| `test/ledger-bridge.mjs` | 账本可选集成：缺席 / 坏文件 / 多币种 / 双模 / 静态隔离守卫 |

```bash
node test/smoke.mjs            # 单跑一个
node scripts/verify-artifact.mjs --pack --tests ./test   # 产物闸门（发布前必跑）
```

产物闸门会把仓库打成 tarball、解开，检查 manifest / patch / 入口 / 资源 / 隔离共 33 项，
再把上面 12 个测试文件拷进产物目录跑一遍。`prepublishOnly` 已接入同一条命令。

## 6. 发布

```bash
node scripts/verify-artifact.mjs --pack --tests ./test   # 本地闸门
npm publish --access public                              # prepublishOnly 会再跑一次
git push origin main --tags && git push github main --tags
```

CI：`.github/workflows/verify.yml` 在每次 push/PR 跑同一条闸门命令。
