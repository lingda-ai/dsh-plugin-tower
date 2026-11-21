# better-sidebar 生态目录 PR（可直接粘贴）

> 目标仓库：`omdsh-dev/DSH-better-sidebar`
> **前置已满足**：GitHub 镜像 **https://github.com/lingda-ai/dsh-plugin-tower** 已公开，
> `main` 与 tag `v0.7.2` 已同步，CI（`.github/workflows/verify.yml`）会展示产物闸门结果。

---

## 1. 为什么应当收录（写给维护者）

- 只依赖宿主原生 `sidebarRightTabs` 与 `sidebar.right.pane.tab` / `.title` 两个 keyed seat，
  **不调用 better-sidebar 的私有 API，也不强依赖它存在**——装与不装都能用。
- 是右栏目录里目前没有的一类：**跨会话的运行状态与干预**（其余多为每会话、只读的内容视图）。
- 零后端、零网络请求、无账号；轮询只在面板打开时进行（4s），关闭即卸载。

## 2. 改动一：`src/client/locales.ts`

### zh 块（`export const zh = {` 内）

在 `pluginDocsPanelName: 'dsh-docs-panel 全局文档',` 之后插入：

```ts
  pluginTowerName: 'dsh-plugin-tower 塔台值守',
  pluginTowerDesc: '跨会话看清 agent 的目标、后台作业与定时任务，并就地暂停/继续/完成、终止、立即执行；含静默检测、可选审计哈希链与值守报告；数据不出本机，不依赖 better-sidebar',
```

### en 块（`export const en: Record<keyof typeof zh, string> = {` 内）

在 `pluginDocsPanelName: 'dsh-docs-panel Global Docs',` 之后插入：

```ts
  pluginTowerName: 'dsh-plugin-tower Tower',
  pluginTowerDesc: 'Fleet-wide watch for every live agent: goals, background jobs and schedules, with in-place pause/resume/complete, kill and run-now; includes idle detection, an optional hash-chained audit log and a shift report. Local-only, no better-sidebar dependency',
```

> `en` 的类型是 `Record<keyof typeof zh, string>`，所以 **zh 里加的键必须在 en 里都有**；
> 其它语言文件是 `Record<string, string>`，无需改动。

## 3. 改动二：`src/client/plugins-tabs.ts`

在 `builtinTabPlugins` 中按 `id` 字母序插入（`dsh-plugin-*` 附近）：

```ts
  {
    id: 'dsh-plugin-tower',
    name: () => t('pluginTowerName'),
    url: 'https://github.com/lingda-ai/dsh-plugin-tower',
    description: () => t('pluginTowerDesc'),
    // 只用宿主原生右栏 seat，不依赖 better-sidebar 的私有 API；
    // 注册的是跨会话的运行值守 tab（目标/作业/定时 + 就地干预），无网络请求。
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-plugin-tower',
  },
```

提交前跑目录的数据完整性测试：

```bash
pnpm test tests/plugin-list.spec.ts
```

## 4. PR 标题与描述

**标题**

```
feat(catalog): add dsh-plugin-tower — fleet-wide agent watch tab
```

**描述**

```markdown
## What

Adds `dsh-plugin-tower` to the tab-plugin catalog. It renders a fleet-wide watch panel:
one card per live agent with its goal (phase, round n/m, blocked reason), background jobs
and schedule rows, plus in-place actions (pause / resume / complete a goal, kill a job,
run a schedule now). It also ships idle detection (20 min without events), an optional
SHA-256-chained local audit log, and a one-page Markdown shift report.

## Why it belongs here

- Registers through the host's native `sidebarRightTabs` + `sidebar.right.pane.tab` /
  `.title` seats only — no runtime dependency on better-sidebar, no private API use.
- Covers a slot the catalog does not have: cross-session operational state and
  intervention (other entries are per-session, read-only content views).
- Local-only: no network requests, no account, no disk writes unless the user opts into
  the audit log. Polling runs only while the panel is open (4s) and stops on unmount.

## Install line

`cd ~/.dsh && dsh plugin --profile web add dsh-plugin-tower` (npm, v0.7.2).

## Screenshot

<!-- 附一张右栏截图：状态行 + 航班卡 + 审计/报告分区 -->
```

## 5. 提交前检查

- [x] GitHub 仓库公开可访问（`lingda-ai/dsh-plugin-tower`，README 有安装段）
- [ ] 附一张截图（PR 描述里）
- [ ] `package.json` 的 `dsh.client.inject` 只列 `@deepseek-ai/dsh-client-ui-sidebar-right`
- [ ] 在干净 profile 装一次：tab 出现、面板有数据、动作可用
- [ ] 目录测试通过（`pnpm test tests/plugin-list.spec.ts`）
- [ ] 已过产物闸门：`node scripts/verify-artifact.mjs --pack --tests ./test`
