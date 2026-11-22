/**
 * 团队共享策略：`TOWER_POLICY` 指向一份团队文件，只覆盖它显式写了的键。
 *
 * 为什么需要：阈值类规则（多久算空转、要不要自动暂停）通常由团队统一，
 * 而通知偏好是个人选择。两者不能互相冲掉，也不能让「读不到团队文件」变成静默失效。
 *
 * 运行：node test/team-policy.mjs
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tower-team-policy-'))
const home = join(sandbox, 'dsh')
mkdirSync(join(home, '.dsh', 'tower'), { recursive: true })
const personalFile = join(home, '.dsh', 'tower', 'policy.json')
const teamFile = join(sandbox, 'team-policy.json')

process.env.DSH_HOME = home
process.env.TOWER_POLICY = teamFile

const { __internal } = await import('../index.js')

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const writeBoth = (personal, team) => {
  writeFileSync(personalFile, JSON.stringify(personal))
  writeFileSync(teamFile, typeof team === 'string' ? team : JSON.stringify(team))
  __internal.resetPolicyCache()
}

// ---------- 1) 团队覆盖本机同名键 ----------
writeBoth({ idleMinutes: 5, notifyOnlyUrgent: false }, { idleMinutes: 20 })
let info = __internal.loadPolicy()
assert(info.policy.idleMinutes === 20, '团队策略覆盖同名键（5 → 20）')
assert(info.policy.notifyOnlyUrgent === false, '团队没写的键保留本机值')

// ---------- 2) 嵌套对象按子键合并 ----------
writeBoth({ autoPause: { enabled: true, afterIdleMinutes: 45 } }, { autoPause: { enabled: false } })
info = __internal.loadPolicy()
assert(info.policy.autoPauseEnabled === false, '嵌套对象：团队改 enabled')
assert(info.policy.autoPauseAfterMinutes === 45, '嵌套对象：团队没写的子键保留本机值')

// ---------- 3) 夹取仍然生效 ----------
// 上界是 1440 分钟（一天）：999 合法，5000 必须被夹到 1440
writeBoth({}, { idleMinutes: 999 })
assert(__internal.loadPolicy().policy.idleMinutes === 999, '团队给合法大值不被乱改')
writeBoth({}, { idleMinutes: 5000 })
assert(__internal.loadPolicy().policy.idleMinutes === 1440, '团队给越界值被夹取到上界')

// ---------- 4) 团队文件坏掉：忽略 + 明确警告，本机策略仍然生效 ----------
writeBoth({ idleMinutes: 7 }, '{ not json')
info = __internal.loadPolicy()
assert(info.policy.idleMinutes === 7, '团队文件损坏时本机策略仍然生效')
assert(info.warnings.some((w) => w.indexOf('团队策略无法解析') >= 0), '团队文件损坏有明确警告')
assert(info.sources.some((s) => s.kind === 'team' && s.ok === false), '来源里标出团队文件不可用')

// ---------- 5) 来源与路径 ----------
writeBoth({ idleMinutes: 30 }, { idleMinutes: 10 })
info = __internal.loadPolicy()
const kinds = info.sources.map((s) => s.kind).sort().join(',')
assert(kinds === 'personal,team', '来源同时列出本机与团队')
assert(info.sources.every((s) => typeof s.path === 'string' && s.path.length > 0), '每个来源都带路径')
assert(info.sources.find((s) => s.kind === 'team').path === teamFile, '团队来源路径正确')

// ---------- 6) 快照把来源带出去 ----------
const now = Date.now()
const ctx = {
  get(name) {
    if (name === 'agents') {
      return {
        list: () => [{ id: 'session-x' }],
        get: () => ({ id: 'session-x' }),
        turnBoundaryOf: () => ({ openTurnStartSeq: null, lastStepStartSeq: 1, lastStepBoundary: null, lastTurn: 1 }),
      }
    }
    if (name === 'sessions') return { get: () => ({ header: { id: 'session-x', createdAt: now - 1000, cwd: '/tmp/p', isSeeded: false } }) }
    if (name === 'goals') return { get: () => null }
    if (name === 'jobs') return { list: () => [] }
    return null
  },
}
const snapshot = await __internal.buildSnapshot(ctx, { lean: false })
assert(snapshot.policy.idleMinutes === 10, '快照里的策略是合并后的值')
assert(Array.isArray(snapshot.policySources) && snapshot.policySources.length === 2, '快照暴露策略来源')
assert(snapshot.policyWarnings.length === 0, '无警告时为空数组')

rmSync(sandbox, { recursive: true, force: true })
console.log(process.exitCode ? '\nTEAM-POLICY FAILED' : '\nTEAM-POLICY PASSED')
