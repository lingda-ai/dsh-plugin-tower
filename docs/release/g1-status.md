# G1 发布看板（30 天安装 ≥ 300）

> 判定口径见 `business-case.md` §8。本看板只记**可验证的事实**与**卡在谁身上**。

## 已完成（有证据）

| 项 | 证据 |
|---|---|
| npm 发布 | `npm view dsh-plugin-tower version` → **0.7.2**；`npm i dsh-plugin-tower@0.7.2` 实测通过 |
| 产物闸门 | 33 项检查 + 产物内 12 个测试文件全过（`scripts/verify-artifact.mjs --pack`） |
| 仓库公开 | Gitee 页面 HTTP **200**（原为私有） |
| 版本标签 | `v0.7.2` 已推送（annotated tag） |
| 仓库测试 | 12 个文件 / 223 条断言 |
| 跨插件链路 | 账本 `window` → 塔台报告「窗口内增量」，实机验证（¥0.0840 / 5 次调用） |

## 卡住（需要账号或人）

| 项 | 缺口 | 谁做 | 具体动作 |
|---|---|---|---|
| **GitHub 镜像** | `api.github.com/repos/linzhengtong/dsh-plugin-tower` → **404**；目录 PR 只收 GitHub URL | 你 | 建空仓后：`git remote add github git@github.com:<账号>/dsh-plugin-tower.git && git push github main --tags` |
| 目录 PR | 依赖 GitHub 镜像 | 我（可代写，提交需你账号） | 用 `better-sidebar-catalog.md` 里的两处粘贴 + PR 描述 |
| 实测文 | 有初稿，缺你的真实经历与配图 | 你 | 填 `launch-post.md` 的 `[你的经历]` 占位，截 2 张图 |
| 整合包收录 | 需要先有 GitHub 仓 | 你/我 | 向 starter-kit 类仓库提 issue（文案在 `release/README.md` §2.5） |
| **干净 profile 走查** | 本机无法创建第二个 profile（无 `dsh` CLI） | 你 | 在新 profile 或新机器装一次，走「空态→建目标→暂停→报告→审计开关」 |

## 判定

- 现在**还不能算过 G1**：安装量的分母从这里发出后才会开始计。
- 唯一能立刻推进的：**建 GitHub 镜像**（5 分钟），之后目录 PR 才可以提。
- 建议顺序：GitHub 镜像 → 目录 PR → 实测文 → 看 30 天安装量。
