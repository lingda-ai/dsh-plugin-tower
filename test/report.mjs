/**
 * 值守报告测试：把四个数据源压成一份 Markdown，且缺服务时不炸。
 * 用临时 DSH_HOME 隔离（审计状态不落到真实目录）。
 * 运行：node test/report.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tower-report-'))
process.env.DSH_HOME = sandbox
const { __internal } = await import('../index.js')

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const now = Date.now()
const agent = { id: 'session-a' }
const goal = {
  id: 'g1', revision: 1, objective: '把右侧栏插件做成可交付产品', phase: 'active',
  maxGoalRounds: 20, roundsStarted: 3, activation: 'armed', createdAt: now - 3600000, updatedAt: now - 60000,
}
const ctx = {
  get(name) {
    if (name === 'agents') {
      return {
        list: () => [agent],
        get: (id) => (id === 'session-a' ? agent : undefined),
        turnBoundaryOf: () => ({ openTurnStartSeq: null, lastStepStartSeq: 1, lastStepBoundary: null, lastTurn: 3 }),
      }
    }
    if (name === 'goals') {
      return {
        get: () => goal,
        pause: (a, ref) => Object.assign({}, goal, { phase: 'paused', revision: ref.revision }),
        resume: (a, ref) => Object.assign({}, goal, { phase: 'active', revision: ref.revision }),
        complete: (a, ref) => Object.assign({}, goal, { phase: 'complete', revision: ref.revision }),
      }
    }
    if (name === 'jobs') {
      return {
        list: () => [{ id: 'bash-1', label: 'pnpm build', status: 'failed', startedAt: now - 5000, finishedAt: now - 1000, output: { total: 10 } }],
        kill: () => 'requested',
        get: () => ({ id: 'bash-1', label: 'pnpm build', output: { total: 10 } }),
        readAt: () => ({ chunks: [], next: 0, lossy: false }),
      }
    }
    if (name === 'sessions') return { get: () => ({ header: { id: 'session-a', createdAt: now - 3600000, cwd: '/tmp/projects/tower', isSeeded: false }, eventAt: () => ({ time: now - 60000 }) }) }
    if (name === 'schedule') return { catalog: async () => [] }
    if (name === 'sessionPersistence') {
      return {
        list: async () => [{ header: { id: 'session-old', createdAt: now - 7200000, cwd: '/tmp/projects/old' }, revision: 'r1' }],
        open: async () => ({
          read: async () => ({
            events: [
              { type: 'goal/change', time: now - 6000000, data: { kind: 'goal/change', version: 1, operation: 'create', goal: { id: 'g0', revision: 1, objective: '整理迁移脚本', phase: 'complete', maxGoalRounds: 5 }, roundsStarted: 2, createdAt: now - 6000000, updatedAt: now - 6000000 } },
              { type: 'job/registered', time: now - 300000, data: { jobId: 'bash-h1', label: 'pnpm test', startedAt: now - 300000 } },
              { type: 'job/settled', time: now - 290000, data: { jobId: 'bash-h1', label: 'pnpm test', startedAt: now - 300000, finishedAt: now - 290000, status: 'failed', detail: 'exit code: 1' } },
            ],
          }),
          close: async () => {},
        }),
      }
    }
    return null
  },
}

// 先真的执行一次动作，让「本次处置」有内容
const paused = await __internal.handleAction(ctx, { action: 'goal.pause', sessionId: 'session-a', goalId: 'g1', revision: 1 })
assert(paused.ok === true, '准备数据：暂停动作成功')

const report = await __internal.buildShiftReport(ctx, 24)
assert(report.ok === true, '报告生成成功')
const md = report.markdown
assert(md.indexOf('# 值守报告') === 0, '标题在首行')
assert(md.indexOf('塔台版本：') >= 0, '带版本号')
assert(md.indexOf('## 一、待处置') >= 0, '有待处置小节')
assert(md.indexOf('## 二、本次处置') >= 0, '有本次处置小节')
assert(md.indexOf('暂停') >= 0, '处置时间线里有刚才的暂停')
assert(md.indexOf('## 三、后台作业') >= 0, '有后台作业小节')
assert(md.indexOf('共 1 条：已完成 0 · 失败 1') >= 0, '作业小节先给汇总结论')
assert(md.indexOf('失败明细') >= 0 && md.indexOf('pnpm test') >= 0, '有失败时优先摊开失败明细')
assert(md.indexOf('exit code: 1') >= 0, '失败明细带退出码')
assert(md.indexOf('## 四、已收场会话') >= 0 && md.indexOf('整理迁移脚本') >= 0, '已收场目标进入报告')
assert(md.indexOf('## 五、审计') >= 0 && md.indexOf('未开启') >= 0, '审计关闭时如实写未开启')
assert(md.indexOf('不含对话内容') >= 0, '结尾声明不包含对话内容')

// 服务全缺
const empty = await __internal.buildShiftReport({ get: () => null }, 24)
assert(empty.ok === true, '服务全缺仍能生成报告')
assert(empty.markdown.indexOf('- 无') >= 0, '缺失项写成「无」而不是报错')

// 报告 → HTML：只支持报告里出现的语法，且必须转义（防止内容注入）
const html = __internal.markdownToHtml('# 标题\n## 小节\n- 项 **粗**\n---\n<script>alert(1)</script>')
assert(html.indexOf('<h1>标题</h1>') >= 0, 'HTML：一级标题')
assert(html.indexOf('<h2>小节</h2>') >= 0, 'HTML：二级标题')
assert(html.indexOf('<li>项 <strong>粗</strong></li>') >= 0, 'HTML：列表与加粗')
assert(html.indexOf('<hr />') >= 0, 'HTML：分隔线')
assert(html.indexOf('&lt;script&gt;') >= 0 && html.indexOf('<script>') < 0, 'HTML：尖括号被转义（不注入）')

rmSync(sandbox, { recursive: true, force: true })
console.log(process.exitCode ? '\nREPORT FAILED' : '\nREPORT PASSED')
