# better-sidebar 生态目录 PR 文案

> 目标仓库：`omdsh-dev/DSH-better-sidebar`
> 收录位置：`src/client/plugins-tabs.ts` 的 `builtinTabPlugins`（右栏 tab 插件目录）+ `src/client/locales.ts` 两条文案。
> **硬前置**：`url` 字段需要 GitHub 仓库地址。Gitee 地址会被维护者要求补齐，见 `README.md` P3。

---

## 1. 为什么适合收录（写给维护者）

- 只依赖宿主原生 `sidebarRightTabs` 与 `sidebar.right.pane.tab` / `.title` 两个 keyed seat，
  **不调用 better-sidebar 的私有 API，也不强依赖 better-sidebar 存在** —— 装与不装都能用。
- 是"右栏 tab 生态"里目前没有的一类：**跨会话的运行状态与干预**（其余多为每会话、只读的内容视图）。
- 零后端、零网络请求、无账号；轮询只在面板打开时进行（4s，隐藏即停），面板关闭即卸载。

## 2. 代码片段（可直接粘贴）

在 `src/client/plugins-tabs.ts` 的 `builtinTabPlugins` 中，按 `id` 字母序插入：

```ts
  {
    id: 'dsh-plugin-tower',
    name: () => t('pluginTowerName'),
    url: 'https://github.com/<你的账号>/dsh-plugin-tower',
    description: () => t('pluginTowerDesc'),
    // 右侧栏「运行值守」：跨会话呈现活 agent 的目标/后台作业/定时任务，
    // 并就地暂停目标、终止作业、立即执行定时任务。仅用宿主原生右栏服务，
    // 无 better-sidebar 私有依赖；无网络请求。
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-plugin-tower',
  },
```

在 `src/client/locales.ts` 中，按现有 `pluginXxxName` / `pluginXxxDesc` 的格式补两条（zh / en 各一份）：

```ts
pluginTowerName: '塔台 · 运行值守',
pluginTowerDesc: '跨会话看清 agent 的目标、后台作业与定时任务，并就地暂停/继续/完成、终止、立即执行。',
```

```ts
pluginTowerName: 'Tower · fleet watch',
pluginTowerDesc: 'Goals, background jobs and schedules for every live agent, with in-place pause, kill and run-now.',
```

> 注意：目录列表有数据完整性测试（`tests/plugin-list.spec.ts`），提交前跑一次：
> `pnpm test tests/plugin-list.spec.ts`。

## 3. PR 标题与描述

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
run a schedule now).

## Why it belongs here

- Registers through the host's native `sidebarRightTabs` + `sidebar.right.pane.tab` /
  `.title` seats only — no runtime dependency on better-sidebar, no private API use.
- Covers a slot the catalog does not have: cross-session operational state and
  intervention (other entries are per-session, read-only content views).
- Local-only: no network requests, no account, no disk writes. Polling runs only while
  the panel is open (4s), and stops when it unmounts.

## Install line

`cd ~/.dsh && dsh plugin --profile web add dsh-plugin-tower` (npm).

## Screenshot

<!-- 附一张右栏截图：计数条 + 航班卡 + 待处置项 -->
```

## 4. 提交前检查

- [ ] GitHub 仓库可公开访问，README 有安装段与截图
- [ ] `package.json` 的 `dsh.client.inject` 只列 `@deepseek-ai/dsh-client-ui-sidebar-right`
- [ ] 在干净 profile 里装一次：tab 出现、面板有数据、动作可用
- [ ] 目录测试通过
