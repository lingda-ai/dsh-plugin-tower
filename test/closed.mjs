/**
 * 已收场会话的目标复算测试（Host 侧）。
 *
 * 事件契约来自 @deepseek-ai/dsh-goal 的构建产物：
 *   goal/change { kind, version:1, operation, goal, roundsStarted, createdAt, updatedAt }
 *   clear 形态：{ operation:'clear', cleared:{id,revision}, clearedAt }
 *   轮次推进：user/message 且 data.source.kind === 'goal'（source.round）
 *
 * 运行：node test/closed.mjs
 */
import { __internal } from '../index.js'

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const change = (operation, goal, extra = {}) => ({
  type: 'goal/change',
  time: extra.time || 1000,
  data: {
    kind: 'goal/change',
    version: 1,
    operation,
    goal,
    roundsStarted: extra.roundsStarted || 0,
    createdAt: extra.createdAt || 1000,
    updatedAt: extra.updatedAt || 1000,
  },
})

const snapshot = (id, revision, phase, extra = {}) =>
  Object.assign({ id, revision, objective: '把右侧栏插件做成可交付的产品', phase, maxGoalRounds: 20 }, extra)

// 1) create → 轮次推进 → pause
let events = [
  change('create', snapshot('g1', 1, 'active'), { time: 1000, createdAt: 1000, updatedAt: 1000 }),
  { type: 'user/message', time: 2000, data: { source: { kind: 'goal', goalId: 'g1', revision: 1, round: 1 } } },
  change('pause', snapshot('g1', 2, 'paused'), { time: 3000, roundsStarted: 1, updatedAt: 3000 }),
]
let goal = __internal.readGoalFromEvents(events)
assert(goal !== null, '复算出目标')
assert(goal.phase === 'paused', '取最后一个 phase（paused）')
assert(goal.roundsStarted === 1, '轮次来自 user/message 的 source.round')
assert(goal.updatedAt === 3000, 'updatedAt 取最后一次变更')

// 2) blocked 带原因
events = [
  change('create', snapshot('g2', 1, 'active'), { time: 1000 }),
  change('block', snapshot('g2', 2, 'blocked', { blockedReason: { code: 'no-credential', message: '缺少宿主接口凭证' } }), {
    time: 5000,
    updatedAt: 5000,
  }),
]
goal = __internal.readGoalFromEvents(events)
assert(goal.phase === 'blocked' && goal.blockedMessage === '缺少宿主接口凭证', 'blocked 带上宿主给的原因')

// 3) clear 之后没有目标
events = [
  change('create', snapshot('g3', 1, 'active'), { time: 1000 }),
  { type: 'goal/change', time: 4000, data: { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g3', revision: 2 }, clearedAt: 4000 } },
]
goal = __internal.readGoalFromEvents(events)
assert(goal === null, 'clear 之后没有当前目标')

// 4) 没有 goal 事件的历史会话
goal = __internal.readGoalFromEvents([{ type: 'turn/start', time: 1, data: { turn: 1 } }])
assert(goal === null, '普通会话复算出 null')

// 5) 已关闭会话扫描：跳过 live、按 revision 缓存、只返回带目标的
const now = Date.now()
const closedEvents = [
  change('create', snapshot('g4', 1, 'active'), { time: now - 5000, createdAt: now - 5000, updatedAt: now - 5000 }),
  change('complete', snapshot('g4', 2, 'complete'), { time: now - 1000, updatedAt: now - 1000 }),
]
let openCalls = 0
const fakeCtx = {
  get(name) {
    if (name === 'agents') return { list: () => [{ id: 'session-live' }] }
    if (name === 'sessionPersistence') {
      return {
        list: async () => [
          { header: { id: 'session-closed', createdAt: now - 10000, cwd: '/tmp/projects/tower' }, revision: 'rev-1' },
          { header: { id: 'session-live', createdAt: now, cwd: '/tmp/projects/live' }, revision: 'rev-2' },
          { header: { id: 'session-nogoal', createdAt: now - 20000, cwd: '/tmp/projects/idle' }, revision: 'rev-3' },
        ],
        open: async (id) => {
          openCalls += 1
          return {
            read: async () => ({ events: id === 'session-closed' ? closedEvents : [{ type: 'turn/start', time: now, data: { turn: 1 } }] }),
            close: async () => {},
          }
        },
      }
    }
    return null
  },
}

const scan = await __internal.collectClosedGoals(fakeCtx, 8)
assert(scan.ok === true, '扫描成功')
assert(scan.closed.length === 1, '只返回「已关闭且有目标」的会话')
assert(scan.closed[0].sessionId === 'session-closed', '命中的是已关闭会话')
assert(scan.closed[0].cwdName === 'tower', 'cwd 折叠成目录名')
assert(scan.closed[0].goal.phase === 'complete', '取到最后一次变更的 phase')
assert(openCalls === 2, '只打开了「已关闭」的两个会话（跳过 live）')

const before = openCalls
const again = await __internal.collectClosedGoals(fakeCtx, 8)
assert(again.closed.length === 1 && openCalls === before, '同 revision 走缓存，不重复读盘')

const missing = await __internal.collectClosedGoals({ get: () => null }, 8)
assert(missing.ok === false, '持久化服务缺失时显式失败，不假装没有会话')

console.log(process.exitCode ? '\nCLOSED FAILED' : '\nCLOSED PASSED')
