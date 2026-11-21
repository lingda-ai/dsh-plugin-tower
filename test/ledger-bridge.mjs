/**
 * 账本集成测试：验证「可选、只读、可缺席、双模口径、失败即隐藏」。
 * 同时有一条静态守卫：塔台的 package.json 不允许出现账本依赖。
 * 运行：node test/ledger-bridge.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tower-ledger-'))
process.env.DSH_HOME = sandbox
const ledgerDir = join(sandbox, '.dsh', 'ledger')
const dataDir = join(sandbox, '.dsh', 'tower')
mkdirSync(dataDir, { recursive: true })

const { __internal } = await import('../index.js')

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const makeCtx = () => ({ get: () => null })
const now = Date.now()

function snapshotFor(sessionId, extra) {
  return Object.assign(
    {
      version: 1,
      generatedAt: new Date(now - 3000).toISOString(),
      sessionId,
      totals: {
        cost: { amount: 1.5, currency: 'CNY', knownEntries: 100, unknownEntries: 0 },
        saved: { amount: 60, currency: 'CNY', entries: 100 },
        entries: 100,
      },
      truncated: false,
    },
    extra || {},
  )
}

// 1) 没有账本目录
let report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('## 成本') < 0, '没有账本目录 → 报告里没有成本节')
assert(__internal.readLedgerCosts(24 * 3600000, now).available === false, '没有账本目录 → 视为无此能力')

// 2) 只有 totals（累计口径）
mkdirSync(ledgerDir, { recursive: true })
writeFileSync(join(ledgerDir, 'session-a.json'), JSON.stringify(snapshotFor('session-a')))
let costs = __internal.readLedgerCosts(24 * 3600000, now)
assert(costs.available === true && costs.windowed === false && costs.amount === 1.5, '只有 totals 时按累计口径读取')
report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('## 成本（来自账本）') >= 0, '有数据时报告出现成本节')
assert(report.markdown.indexOf('累计') >= 0, '累计口径被写进报告')
assert(report.markdown.indexOf('¥1.5000') >= 0, '金额按四位小数展示')

// 3) 带 window 字段 → 窗口口径
writeFileSync(
  join(ledgerDir, 'session-b.json'),
  JSON.stringify(snapshotFor('session-b', { window: { hours: 24, cost: 0.5, entries: 20, unknownEntries: 3 } })),
)
costs = __internal.readLedgerCosts(24 * 3600000, now)
assert(costs.available === true && costs.sessions === 2, '两个会话都计入')
assert(costs.windowed === false, '口径不一致时不冒充窗口增量')
assert(costs.amount === 3, '混合时统一退回累计口径（1.5 + 1.5），绝不把两种口径相加')
report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('累计') >= 0, '混合口径时报告写「累计」')

// 3b) 两个会话都带 window → 真正的窗口口径
writeFileSync(
  join(ledgerDir, 'session-a.json'),
  JSON.stringify(snapshotFor('session-a', { window: { hours: 24, cost: 0.25, entries: 5, unknownEntries: 0 } })),
)
costs = __internal.readLedgerCosts(24 * 3600000, now)
assert(costs.windowed === true, '全部带 window 时按窗口口径')
assert(Math.abs(costs.amount - 0.75) < 1e-9, '窗口口径只加窗口增量（0.25 + 0.5）')
report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('窗口内增量') >= 0, '窗口口径被写进报告')
assert(report.markdown.indexOf('3 条费率未知') >= 0, '未知费率被如实带出')

// 3c) 账本自报「窗口不完整」必须一路带出
writeFileSync(
  join(ledgerDir, 'session-a.json'),
  JSON.stringify(snapshotFor('session-a', { window: { hours: 24, cost: 0.25, entries: 5, unknownEntries: 0, covered: false } })),
)
costs = __internal.readLedgerCosts(24 * 3600000, now)
assert(costs.incomplete === true, 'covered=false 时判定窗口不完整')
report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('窗口可能不完整') >= 0, '报告标注窗口可能不完整')

// 3d) 恢复完整，避免影响后续断言
writeFileSync(
  join(ledgerDir, 'session-a.json'),
  JSON.stringify(snapshotFor('session-a', { window: { hours: 24, cost: 0.25, entries: 5, unknownEntries: 0, covered: true } })),
)
assert(__internal.readLedgerCosts(24 * 3600000, now).incomplete === false, 'covered=true 时不报警')

// 4) 陈旧
writeFileSync(join(ledgerDir, 'session-a.json'), JSON.stringify(snapshotFor('session-a', { generatedAt: new Date(now - 3600000).toISOString() })))
report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('数据可能已过期') >= 0, '超过 10 分钟未更新会标注可能过期')

// 5) 截断
writeFileSync(join(ledgerDir, 'session-a.json'), JSON.stringify(snapshotFor('session-a', { truncated: true })))
report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('可能偏低') >= 0, 'truncated 会提示合计可能偏低')

// 6) 多币种 → 不合并
writeFileSync(join(ledgerDir, 'session-c.json'), JSON.stringify(snapshotFor('session-c', { totals: { cost: { amount: 2, currency: 'USD' }, saved: { amount: 0 }, entries: 1 } })))
assert(__internal.readLedgerCosts(24 * 3600000, now).available === false, '多币种时拒绝合并')

// 7) 坏文件跳过，好文件仍可用
writeFileSync(join(ledgerDir, 'session-c.json'), '{ not json')
writeFileSync(join(ledgerDir, 'session-d.json'), JSON.stringify({ version: 2, totals: { cost: { amount: 9 } } }))
costs = __internal.readLedgerCosts(24 * 3600000, now)
assert(costs.available === true && costs.sessions === 2, '坏 JSON 与 version!=1 被跳过，其余照常')

// 8) 窗口外会话不计入
writeFileSync(join(ledgerDir, 'session-e.json'), JSON.stringify(snapshotFor('session-e', { generatedAt: new Date(now - 48 * 3600000).toISOString() })))
assert(__internal.readLedgerCosts(24 * 3600000, now).sessions === 2, '48 小时前活跃的会话不进入 24h 报告')

// 9) 策略关掉成本
writeFileSync(join(dataDir, 'policy.json'), JSON.stringify({ includeCost: false }))
report = await __internal.buildShiftReport(makeCtx(), 24)
assert(report.markdown.indexOf('## 成本') < 0, 'policy.includeCost=false 时报告不出现成本节')

// 10) 静态守卫：塔台不得依赖账本
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const deps = Object.assign({}, pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies, pkg.devDependencies)
assert(!Object.keys(deps).some((name) => name.indexOf('ledger') >= 0), '塔台 package.json 不包含任何账本依赖')
const hostSrc = readFileSync('index.js', 'utf8')
const clientSrc = readFileSync('client.js', 'utf8')
assert(hostSrc.indexOf('@lingda-ai') < 0 && clientSrc.indexOf('@lingda-ai') < 0, '源码里不出现账本包名（纯文件读取，无 import）')

rmSync(sandbox, { recursive: true, force: true })
console.log(process.exitCode ? '\nLEDGER BRIDGE FAILED' : '\nLEDGER BRIDGE PASSED')
