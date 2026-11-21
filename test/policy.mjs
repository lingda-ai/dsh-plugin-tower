/**
 * 策略文件测试：默认值、夹取、热更新、阈值生效、自动暂停（默认关 / 开启后只动该动的）。
 * 用临时 DSH_HOME 沙箱。
 * 运行：node test/policy.mjs
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tower-policy-'))
process.env.DSH_HOME = sandbox
const dataDir = join(sandbox, '.dsh', 'tower')
mkdirSync(dataDir, { recursive: true })
const policyPath = join(dataDir, 'policy.json')

const { __internal } = await import('../index.js')

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

// 1) 无文件 → 默认值
const defaults = __internal.readPolicy()
assert(defaults.idleMinutes === 20 && defaults.autoPauseEnabled === false, '无策略文件时用保守默认值')

// 2) 夹取与类型容错
const normalized = __internal.normalizePolicy({ idleMinutes: -5, historyHours: 'x', historyLimit: 999, autoPause: { enabled: true, afterIdleMinutes: 1 } })
assert(normalized.idleMinutes === 1, 'idleMinutes 下限夹到 1')
assert(normalized.historyHours === 24, '非法 historyHours 退回默认')
assert(normalized.historyLimit === 100, 'historyLimit 上限夹到 100')
assert(normalized.autoPauseAfterMinutes === 5, 'autoPause 分钟下限夹到 5')

// 3) 文件 → 生效且热更新
writeFileSync(policyPath, JSON.stringify({ idleMinutes: 5, notifyOnlyUrgent: false, autoPause: { enabled: false } }))
const loaded = __internal.readPolicy()
assert(loaded.idleMinutes === 5 && loaded.notifyOnlyUrgent === false, '策略文件生效')

// 4) idleMinutes=5 时，10 分钟无动静就该报空转（默认 20 不会报）
const now = Date.now()
const agent = { id: 'session-a' }
const pauseCalls = []
function makeCtx(options) {
  return {
    get(name) {
      if (name === 'agents') {
        return {
          list: () => [agent],
          get: (id) => (id === 'session-a' ? agent : undefined),
          turnBoundaryOf: () => ({ openTurnStartSeq: options.running ? 1 : null, lastStepStartSeq: 1, lastStepBoundary: { kind: 'start', seq: 1 }, lastTurn: 3 }),
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
          get: () => ({ id: 'g1', revision: 7, objective: '把插件做成产品', phase: options.phase || 'active', maxGoalRounds: 20, roundsStarted: 4, activation: 'armed', createdAt: now - 3600000, updatedAt: options.lastEventAt }),
          pause: (a, ref) => {
            pauseCalls.push(ref)
            return { id: 'g1', revision: ref.revision, objective: '把插件做成产品', phase: 'paused', maxGoalRounds: 20, roundsStarted: 4, activation: 'disarmed', createdAt: now - 3600000, updatedAt: Date.now() }
          },
        }
      }
      if (name === 'jobs') return { list: () => [] }
      return null
    },
  }
}

const tenMin = now - 10 * 60000
const snap = await __internal.buildSnapshot(makeCtx({ lastEventAt: tenMin }), { lean: false })
assert(snap.attention.some((item) => item.code === 'goal.idle'), '策略 idleMinutes=5 时，10 分钟无动静会报空转')
assert(pauseCalls.length === 0, '自动暂停默认关闭时不会动手')

// 5) 开启自动暂停：45 分钟无动静的目标被暂停，并记入处置
writeFileSync(policyPath, JSON.stringify({ idleMinutes: 5, autoPause: { enabled: true, afterIdleMinutes: 45 } }))
const anHourAgo = now - 60 * 60000
const autoSnap = await __internal.buildSnapshot(makeCtx({ lastEventAt: anHourAgo }), { lean: false })
assert(pauseCalls.length === 1 && pauseCalls[0].revision === 7, '开启后 60 分钟无动静被自动暂停')
assert(autoSnap.policy.autoPauseEnabled === true, '快照里带策略状态')
assert(autoSnap.autoPaused === 1, '快照报告自动暂停次数')
const autoEntry = (autoSnap.recent || []).find((entry) => entry.verb === 'auto-pause')
assert(Boolean(autoEntry), '自动暂停记入处置历史（verb=auto-pause）')

// 6) 正在跑的目标不会被自动暂停
pauseCalls.length = 0
await __internal.buildSnapshot(makeCtx({ lastEventAt: anHourAgo, running: true }), { lean: false })
assert(pauseCalls.length === 0, '正在跑的目标不自动暂停')

console.log(process.exitCode ? '\nPOLICY FAILED' : '\nPOLICY PASSED')
