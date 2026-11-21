/**
 * 静默检测（可能空转）测试。
 * 规则：goal 处于 active、当前没在跑、且最后一次提交事件距今 > 20 分钟 → 出一条 waiting。
 * 运行：node test/idle.mjs
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

const now = Date.now()

function makeCtx(options) {
  const agent = { id: 'session-a' }
  return {
    get(name) {
      if (name === 'agents') {
        return {
          list: () => [agent],
          turnBoundaryOf: () => ({
            openTurnStartSeq: options.running ? 1 : null,
            lastStepStartSeq: 1,
            lastStepBoundary: { kind: 'start', seq: 1 },
            lastTurn: 3,
          }),
        }
      }
      if (name === 'sessions') {
        return {
          get: () => ({
            header: { id: 'session-a', createdAt: now - 3600000, cwd: '/tmp/projects/tower', isSeeded: false },
            eventAt: () => ({ time: options.lastEventAt }),
          }),
        }
      }
      if (name === 'goals') {
        return {
          get: () => ({
            id: 'g1',
            revision: 1,
            objective: '把右侧栏插件做成可交付的产品',
            phase: options.phase,
            maxGoalRounds: 20,
            roundsStarted: 2,
            activation: 'armed',
            createdAt: now - 3600000,
            updatedAt: options.lastEventAt,
          }),
        }
      }
      if (name === 'jobs') return { list: () => [] }
      return null
    },
  }
}

const idle = await __internal.buildSnapshot(makeCtx({ running: false, phase: 'active', lastEventAt: now - 25 * 60000 }), { lean: false })
const idleItem = idle.attention.find((item) => item.code === 'goal.idle')
assert(Boolean(idleItem), '25 分钟无动静 → 出现 goal.idle')
assert(idleItem.level === 'waiting', 'goald.idle 是 waiting 级别（不是 urgent）'.replace('goald', 'goal'))
assert(idleItem.title.indexOf('25 分钟') >= 0, '标题里带分钟数')

const recent = await __internal.buildSnapshot(makeCtx({ running: false, phase: 'active', lastEventAt: now - 60000 }), { lean: false })
assert(!recent.attention.some((item) => item.code === 'goal.idle'), '1 分钟前有动静 → 不报空转')

const running = await __internal.buildSnapshot(makeCtx({ running: true, phase: 'active', lastEventAt: now - 40 * 60000 }), { lean: false })
assert(!running.attention.some((item) => item.code === 'goal.idle'), '正在跑 → 不报空转')

const paused = await __internal.buildSnapshot(makeCtx({ running: false, phase: 'paused', lastEventAt: now - 40 * 60000 }), { lean: false })
assert(!paused.attention.some((item) => item.code === 'goal.idle'), '目标已暂停 → 不报空转（paused 自己会报）')
assert(paused.attention.some((item) => item.code === 'goal.paused'), '暂停仍然报 goal.paused')

const threshold = __internal.IDLE_MS
assert(threshold === 20 * 60 * 1000, '阈值是 20 分钟')

console.log(process.exitCode ? '\nIDLE FAILED' : '\nIDLE PASSED')
