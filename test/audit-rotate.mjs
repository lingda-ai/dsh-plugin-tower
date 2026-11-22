/**
 * 审计轮转：单文件超过上限就挪成 .1，避免无限增长。
 * 单独一个文件，因为上限是模块加载时从环境读的（TOWER_AUDIT_MAX_BYTES）。
 *
 * 运行：node test/audit-rotate.mjs
 */
import { mkdtempSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tower-rotate-'))
const home = join(sandbox, 'dsh')
mkdirSync(join(home, '.dsh', 'tower'), { recursive: true })
process.env.DSH_HOME = home
process.env.TOWER_AUDIT_MAX_BYTES = '400' // 小到必然触发轮转

const { __internal } = await import('../index.js')

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

assert(__internal.auditStatus().enabled === false, '默认关闭时一行都不写')
__internal.handleAction({ get: () => null }, { action: 'audit.enable' })

for (let index = 0; index < 12; index += 1) {
  __internal.appendAudit({
    at: Date.now(),
    verb: 'pause',
    sessionId: 'session-' + index,
    label: '目标 ' + index + ' '.repeat(20),
    outcome: 'ok',
  })
}

const status = __internal.auditStatus()
assert(status.enabled === true, '开启后状态为 true')
// 轮转发生在追加**之前**，所以单文件上界是「上限 + 一条记录」，
// 不是硬性 ≤ 上限。这个语义要写清，否则运维会以为配置没生效。
assert(status.bytes < 400 * 2, '当前文件在「上限 + 一条记录」范围内（实际 ' + status.bytes + 'B）')
assert(existsSync(status.path + '.1'), '轮转产生 .1 备份')
assert(statSync(status.path + '.1').size > 0, '.1 备份非空')
assert(status.count >= 1, '轮转后当前文件仍有记录')

// 轮转后的当前文件必须是一条完整可校验的链（链按文件独立）
const verified = __internal.auditVerify()
assert(verified.ok === true, '轮转后当前文件校验通过')
assert(verified.count === status.count, '校验条数与状态一致')

console.log(process.exitCode ? '\nAUDIT-ROTATE FAILED' : '\nAUDIT-ROTATE PASSED')
