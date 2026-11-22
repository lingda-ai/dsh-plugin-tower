/**
 * 审计落盘测试：哈希链追加、可校验、篡改可见、关闭后停止写入。
 * 用临时 DSH_HOME 隔离，绝不碰用户真实审计目录。
 * 运行：node test/audit.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tower-audit-'))
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

const fakeCtx = { get: () => null }

// 默认关闭：连目录都不该建
assert(__internal.auditStatus().enabled === false, '默认关闭')
__internal.appendAudit({ at: 1, verb: 'pause', sessionId: 's1', label: 'x', outcome: 'ok' })
assert(__internal.auditStatus().count === 0, '关闭时 appendAudit 不写任何东西')

// 开启
const enabled = await __internal.handleAction(fakeCtx, { action: 'audit.enable' })
assert(enabled.ok === true && enabled.result.enabled === true, '开启后状态为记录中')

__internal.appendAudit({ at: 1000, verb: 'pause', sessionId: 's1', label: '把插件做成产品', outcome: 'ok' })
__internal.appendAudit({ at: 2000, verb: 'kill', sessionId: 's1', label: 'pnpm build', outcome: 'requested' })

let status = __internal.auditStatus()
assert(status.count === 2, '写入两条')
assert(status.head.seq === 2 && status.head.hash.length === 64, '链头是 64 位 hash')

const lines = readFileSync(status.path, 'utf8').split('\n').filter(Boolean)
const first = JSON.parse(lines[0])
const second = JSON.parse(lines[1])
assert(first.prev === '' && first.seq === 1, '第一条 prev 为空')
assert(second.prev === first.hash, '第二条 prev 指向第一条的 hash')

const verified = __internal.auditVerify()
assert(verified.ok === true && verified.count === 2, '未篡改时校验通过')

// 篡改第一条的 label
const tampered = Object.assign({}, first, { label: '被改过' })
writeFileSync(status.path, [JSON.stringify(tampered), lines[1]].join('\n') + '\n')
const broken = __internal.auditVerify()
assert(broken.ok === false && broken.at === 1 && broken.reason === 'hash', '篡改第一条会被检出')

// 删掉一条
writeFileSync(status.path, lines[1] + '\n')
const deleted = __internal.auditVerify()
assert(deleted.ok === false && deleted.at === 1 && deleted.reason === 'seq', '删掉首条会被检出')

// 恢复原样并关闭
writeFileSync(status.path, lines.join('\n') + '\n')
const off = await __internal.handleAction(fakeCtx, { action: 'audit.disable' })
assert(off.ok === true && off.result.enabled === false, '关闭成功')
__internal.appendAudit({ at: 3000, verb: 'pause', sessionId: 's1', label: 'close', outcome: 'ok' })
assert(__internal.auditStatus().count === 2, '关闭后不再追加')

// 操作者：团队里至少能分清是哪台机器（必须在清理之前读）
const auditLines = readFileSync(status.path, 'utf8').trim().split('\n')
const lastRecord = JSON.parse(auditLines[auditLines.length - 1])
assert(lastRecord.v === 2, '记录带版本号 v2（哈希口径）')
assert(lastRecord.actor && typeof lastRecord.actor.user === 'string' && typeof lastRecord.actor.host === 'string', '记录带操作者（用户@主机）')
assert(__internal.auditStatus().actor && __internal.auditStatus().actor.host.length > 0, '状态里也暴露操作者')

rmSync(sandbox, { recursive: true, force: true })

console.log(process.exitCode ? '\nAUDIT FAILED' : '\nAUDIT PASSED')
