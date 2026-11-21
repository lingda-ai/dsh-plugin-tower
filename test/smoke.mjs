/**
 * 离线冒烟测试：不启动宿主，只喂假服务，断言快照与动作分发。
 * 运行：node test/smoke.mjs
 */
import { __internal } from '../index.js'

const now = Date.now()

const goalView = {
  id: 'goal-1',
  revision: 3,
  objective: '把右侧栏插件做成可交付的产品',
  phase: 'paused',
  blockedReason: undefined,
  maxGoalRounds: 20,
  roundsStarted: 7,
  createdAt: now - 600000,
  updatedAt: now - 30000,
  activation: 'disarmed',
}

const jobView = (id, status, extra = {}) => ({
  id,
  kind: 'bash',
  label: 'pnpm build',
  owner: 'session-a',
  status,
  progress: 'compiling',
  startedAt: now - 45000,
  finishedAt: status === 'running' ? undefined : now - 5000,
  output: { total: 4096, earliest: 0 },
  ...extra,
})

const agentA = { id: 'session-a' }
const agentB = { id: 'session-b' }

const calls = []
const fakeCtx = {
  get(name) {
    if (name === 'agents') {
      return {
        list: () => [agentA, agentB],
        get: (id) => [agentA, agentB].find((agent) => agent.id === id),
        turnBoundaryOf: (session) =>
          session.id === 'session-a'
            ? { openTurnStartSeq: 12, lastStepStartSeq: 12, lastStepBoundary: null, lastTurn: 4 }
            : { openTurnStartSeq: null, lastStepStartSeq: null, lastStepBoundary: null, lastTurn: 2 },
      }
    }
    if (name === 'sessions') {
      return {
        get: (id) => ({
          id,
          header: {
            id,
            createdAt: now - 3600000,
            cwd: id === 'session-a' ? '/tmp/projects/tower' : '/tmp/projects/other',
            isSeeded: false,
            origin: id === 'session-b' ? 'subagent' : undefined,
            parentSession: id === 'session-b' ? 'session-a' : undefined,
          },
        }),
      }
    }
    if (name === 'goals') {
      return {
        get: (agent) => (agent.id === 'session-a' ? goalView : undefined),
        pause: (agent, ref) => {
          calls.push(['pause', agent.id, ref])
          return { ...goalView, phase: 'paused', revision: ref.revision }
        },
        resume: (agent, ref) => {
          calls.push(['resume', agent.id, ref])
          return { ...goalView, phase: 'active', activation: 'armed', revision: ref.revision }
        },
        complete: (agent, ref) => {
          calls.push(['complete', agent.id, ref])
          return { ...goalView, phase: 'complete', revision: ref.revision }
        },
      }
    }
    if (name === 'jobs') {
      return {
        list: (id) => (id === 'session-a' ? [jobView('bash-1', 'running'), jobView('bash-2', 'failed', { detail: 'exit 1' })] : []),
        kill: (jobId, caller, reason) => {
          calls.push(['kill', jobId, caller, reason])
          return 'requested'
        },
      }
    }
    if (name === 'schedule') {
      return {
        catalog: async () => [
          { id: 'sched-1', title: '每日站会纪要', status: 'active', kind: 'daily', scheduledAt: new Date(now + 600000).toISOString(), target: { kind: 'session', sessionId: 'session-a' } },
          { id: 'sched-2', title: '已结束', status: 'ended', kind: 'at', scheduledAt: new Date(now - 1000).toISOString(), target: { kind: 'new' } },
        ],
        run: async (request) => {
          calls.push(['run', request.id])
          return { id: request.id }
        },
      }
    }
    return null
  },
}

const full = await __internal.buildSnapshot(fakeCtx, { lean: false })
const lean = await __internal.buildSnapshot(fakeCtx, { lean: true })

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

assert(full.ok === true, '快照 ok')
assert(full.flights.length === 2, '两个在飞航班（含一个子代理）')
const a = full.flights.find((f) => f.sessionId === 'session-a')
const b = full.flights.find((f) => f.sessionId === 'session-b')
assert(a.cwdName === 'tower', 'cwd 折叠成目录名')
assert(a.running === true && a.turn === 4, '运行中识别（openTurnStartSeq）')
assert(a.goal && a.goal.phase === 'paused' && a.goal.roundsStarted === 7, '目标投影')
assert(b.origin === 'subagent' && b.parentSession === 'session-a', '子代理标记')
assert(a.jobs.length === 2, '作业过滤（运行中 + 十分钟内失败）')
assert(full.counts.live === 2 && full.counts.jobs === 1, '计数：在飞 2 / 后台 1')
assert(full.counts.urgent === 1, '紧急项 = 1（作业失败）')
assert(full.counts.waiting === 1, '等待项 = 1（目标暂停）')
assert(full.attention[0].code === 'job.failed', '紧急项排在前')
assert(full.schedules.length === 1 && full.schedules[0].id === 'sched-1', '已结束的定时任务被过滤')
assert(full.counts.schedules === 1, '定时计数')
assert(lean.flights.length === 0 && lean.counts.live === 2 && lean.attention.length === 2, 'lean 包只带计数与待办')

const pauseOut = await __internal.handleAction(fakeCtx, { action: 'goal.pause', sessionId: 'session-a', goalId: goalView.id, revision: 3 })
assert(pauseOut.ok === true && pauseOut.result.phase === 'paused', '目标暂停动作')
const resumeOut = await __internal.handleAction(fakeCtx, { action: 'goal.resume', sessionId: 'session-a', goalId: goalView.id, revision: 4 })
assert(resumeOut.ok === true && resumeOut.result.phase === 'active', '目标继续动作')

const killOut = await __internal.handleAction(fakeCtx, { action: 'job.kill', jobId: 'bash-1', sessionId: 'session-a' })
assert(killOut.ok === true && killOut.result.outcome === 'requested', '终止后台作业')
const runOut = await __internal.handleAction(fakeCtx, { action: 'schedule.run', scheduleId: 'sched-1' })
assert(runOut.ok === true, '定时任务立即执行')

const ghost = await __internal.handleAction(fakeCtx, { action: 'goal.pause', sessionId: 'session-ghost', goalId: 'x', revision: 1 })
assert(ghost.ok === false, '已关闭的会话不能操作目标')
const unknown = await __internal.handleAction(fakeCtx, { action: 'nope' })
assert(unknown.ok === false && unknown.error === '未知动作', '未知动作被拒绝')

const emptyCtx = { get: () => null }
const empty = await __internal.buildSnapshot(emptyCtx, { lean: false })
assert(empty.ok === true && empty.flights.length === 0 && empty.schedules.length === 0, '服务全缺时降级成空快照而不是报错')

console.log('\ncalls: ' + JSON.stringify(calls))
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED')
