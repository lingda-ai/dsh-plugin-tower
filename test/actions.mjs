/**
 * 目标动作：面板上的「建目标」必须**真的创建目标**，而不是复制一句话。
 *
 * 这条测试存在的理由很直接：0.10 之前那个按钮只调 onCopy()，
 * 用户以为建好了，其实只拿到了剪贴板文本。
 *
 * 运行：node test/actions.mjs
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tower-actions-'))
const home = join(sandbox, 'dsh')
mkdirSync(join(home, '.dsh', 'tower'), { recursive: true })
process.env.DSH_HOME = home
const { __internal } = await import('../index.js')

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const calls = []
const view = {
  id: 'goal-1',
  revision: 1,
  objective: '把右栏插件做成可交付的产品',
  phase: 'active',
  activation: 'armed',
  maxGoalRounds: 8,
  roundsStarted: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

const makeCtx = (goals) => ({
  get(name) {
    if (name === 'agents') return { get: () => ({ id: 'session-a' }) }
    if (name === 'goals') return goals
    if (name === 'jobs') return { list: () => [] }
    return null
  },
})

const goalsOk = {
  get: () => undefined,
  pause: () => view,
  resume: () => view,
  complete: () => view,
  create: (agent, request) => {
    calls.push({ agent, request })
    return Object.assign({}, view, { objective: request.objective, maxGoalRounds: request.maxGoalRounds || 8 })
  },
}

// ---------- 1) 真的创建 ----------
let result = await __internal.handleAction(makeCtx(goalsOk), {
  action: 'goal.create',
  sessionId: 'session-a',
  objective: '  把右栏插件做成可交付的产品  ',
})
assert(result.ok === true, 'goal.create 成功')
assert(calls.length === 1 && calls[0].request.objective === '把右栏插件做成可交付的产品', '目标内容去掉首尾空白后传给宿主')
assert(calls[0].agent.id === 'session-a', '传给宿主的是该会话的 agent')
assert(result.result && result.result.phase === 'active', '返回创建出的目标视图')

// ---------- 2) 轮次上限 ----------
calls.length = 0
await __internal.handleAction(makeCtx(goalsOk), { action: 'goal.create', sessionId: 'session-a', objective: 'x', maxGoalRounds: 999 })
assert(calls[0].request.maxGoalRounds === 50, '轮次上限被夹到 50')
calls.length = 0
await __internal.handleAction(makeCtx(goalsOk), { action: 'goal.create', sessionId: 'session-a', objective: 'x', maxGoalRounds: 0 })
assert(calls[0].request.maxGoalRounds === undefined, '轮次 0 视为不指定')

// ---------- 3) 拒绝非法输入 ----------
calls.length = 0
result = await __internal.handleAction(makeCtx(goalsOk), { action: 'goal.create', sessionId: 'session-a', objective: '   ' })
assert(result.ok === false && calls.length === 0, '空目标被拒绝且不调用宿主')
result = await __internal.handleAction(makeCtx(goalsOk), { action: 'goal.create', sessionId: 'session-a', objective: 'x'.repeat(501) })
assert(result.ok === false && calls.length === 0, '超长目标被拒绝')

// ---------- 4) 宿主不支持创建 ----------
result = await __internal.handleAction(makeCtx({ get: () => undefined, pause: () => view }), {
  action: 'goal.create',
  sessionId: 'session-a',
  objective: 'x',
})
assert(result.ok === false && result.error.indexOf('不支持') >= 0, '宿主没有 create 时明确报错')

// ---------- 5) 能力位 ----------
const caps = __internal.collectCapabilities(makeCtx(goalsOk))
assert(caps.goalCreate === true, '有 create 时 goalCreate=true')
const capsNo = __internal.collectCapabilities(makeCtx({ get: () => undefined, pause: () => view, resume: () => view, complete: () => view }))
assert(capsNo.goalCreate === false, '没有 create 时 goalCreate=false（面板据此隐藏入口）')

console.log(process.exitCode ? '\nACTIONS FAILED' : '\nACTIONS PASSED')
