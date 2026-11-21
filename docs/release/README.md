# 发布清单（W1–W2）· 目标：过 G1

> G1 判定：发布后 30 天，**安装 ≥ 300**（或 star ≥ 30 且 ≥ 5 条真实需求 issue）。
> 依据：`business-case.md` §8。没过程序化验证的渠道，不要算进 G1。

---

## 0. 为什么按这个顺序

实测分发是幂律的：头部插件月下载 38.5 万，同类工具 81。头部无一靠"被搜索"，全部靠**被装进默认组合**。
所以顺序是：**能被装 → 能被收录 → 能被看到 → 能被讨论**。反过来做（先写文章）＝把预算扔进漏斗底部。

---

## 1. 前置（半天内可完成）

| # | 事项 | 状态 | 说明 |
|---|---|---|---|
| P1 | Gitee 主仓 | ✅ 已完成 | `gitee.com/linzhengtong/dsh-plugin-tower`（私有） |
| P2 | 仓库可见性改为**公开** | ⬜ | 目录收录与外部安装都要求公开；改完把 README 里的安装行补上 |
| P3 | GitHub 镜像仓 | ⬜ | **better-sidebar 目录只收 GitHub URL**；缺它进不了默认组合 |
| P4 | npm 发布 `dsh-plugin-tower` | ⬜ | 名字已查：**未被占用**（registry 404）。标准安装路径是 npm，Git URL 安装对普通用户是门槛 |
| P5 | 打 tag `v0.1.5` + Release 说明 | ⬜ | 版本号已升到 0.1.1（空态与信息密度改进） |

> P3 没有 GitHub 账号也能先做 P4；两者都不阻塞 P5。

---

## 2. 逐项动作

### 2.1 仓库元数据（复制粘贴）

**About（Gitee / GitHub 一句话）**

```
DSH 右侧栏 Agent 运行值守台：跨会话看清谁在飞、谁卡住、谁等你，并就地放行（目标暂停/继续/完成、作业终止、定时立即执行）。
```

**topics**

```
dsh  deepseek-harness  dsh-plugin  dsh-better-sidebar  agent  agent-observability  goal  sidebar
```

**Release v0.1.5 说明**

```
## 塔台 v0.1.5

首个公开版本：右侧栏「全机运行值守」。

- 全机航班：每个活 agent 一张卡（工作区、模型预设、第 n 轮、运行时长、子代理标记）
- 目标：阶段 / 第 n/m 轮 / 受阻原因；就地 暂停 · 继续 · 完成（带 revision 乐观并发）
- 后台作业：运行中与 10 分钟内失败项；就地终止
- 定时航班：下一次执行时间；就地立即执行
- 待处置：确定性规则（目标受阻 / 目标暂停 / 作业失败），不是模型猜的
- 三个入口：输入框「塔台」按钮（带红角标）、右侧栏 tab（chip 计数）、空白右栏引导页
- 本地优先：不落盘、不出网、无账号；面板关闭即停止轮询

安装：
  dsh plugin --profile <profile> add dsh-plugin-tower

已知边界：只显示仍活着的 agent；替换版本需重启一次 Harness。
```

### 2.2 GitHub 镜像

```bash
# 有 GitHub 账号后
git remote add github git@github.com:<你的账号>/dsh-plugin-tower.git
git push github main --tags
```
（`gh` CLI 本机未安装；不装也能用上面的方式。）

### 2.3 npm 发布

```bash
# 需要 node/npm 与 npm 登录
npm login
npm publish --access public      # package.json 已无 private:true
```
发布后把 README 的安装行改为：
```bash
dsh plugin --profile <profile> add dsh-plugin-tower
```

### 2.4 better-sidebar 生态目录 PR

见 [`better-sidebar-catalog.md`](better-sidebar-catalog.md)：内含可直接粘贴的 `PluginEntry` 片段与 PR 描述。
**前置**：GitHub 仓（P3）+ npm 包（P4，可选但强烈建议）。

### 2.5 一键整合包 / 推荐位（最高杠杆）

对 `dsh-starter-kit` 这类整合包仓库提 issue/PR，一句话：

```
建议把 dsh-plugin-tower（右侧栏运行值守）作为可选预置项：它只依赖宿主原生右侧栏服务，
不装 better-sidebar 也能用；开源 Apache-2.0；无网络请求、无账号。
```

### 2.6 实测文

见 [`launch-post.md`](launch-post.md)（初稿，含需你替换的个人经历占位）。
发布渠道顺序：掘金 → 知乎 → 公众号/社群；同一篇，标题按渠道微调。

---

## 3. 数据回收（30 天）

| 指标 | 口径 | 采集 |
|---|---|---|
| 安装量 | npm 月下载 + Gitee/GitHub clone 数 | `https://api.npmjs.org/downloads/point/last-month/dsh-plugin-tower` |
| 关注度 | star / fork / watch | 仓库页 |
| 真实需求 | issue 数 − 机器人/自测 | 人工判定 |
| 激活与留存 | **无法自动采集**（零遥测） | 抽样访谈 + 可选匿名统计（v0.3 才做） |

**G1 判定表**

| 结果 | 判定 |
|---|---|
| 安装 ≥ 300 | 过 → 投入 L2/L3 |
| 安装 100–300 且 issue ≥ 5 条真实需求 | 有条件过 → 先做 L2 提醒再加渠道 |
| 安装 < 100 | 未过 → 不投商业版；保留开源，转"品牌资产" |

---

## 4. 发布前自检（贴进 Release）

- [ ] `node test/smoke.mjs` 21 条 PASS
- [ ] `node test/route.mjs` 20 条 PASS
- [ ] `node test/wiring.mjs` 14 条 PASS
- [ ] `node test/render.mjs` 23 条 PASS
- [ ] 重启后 `POST /dsh-tower/api` 返回 JSON（不是 405）
- [ ] 右栏 tab 可见、输入框按钮带角标
- [ ] 空态显示三条上手引导（新装用户第一眼）
- [ ] `icon.svg` 与 `locale/{zh,en}.json` 的 `meta` 在插件市场可见
- [ ] README 安装行与当前发布渠道一致（Git / npm 二选一写清）
