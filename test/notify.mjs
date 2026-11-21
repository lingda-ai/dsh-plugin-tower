/**
 * 通知候选筛选测试（纯函数）。
 * 真机弹窗依赖浏览器 Notification 权限，无法在此环境验证；能验证的是「谁该弹、谁不该弹」。
 * 运行：node test/notify.mjs
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let captured = null
const fakeWindow = {
  __ModuleLoader__: { load: (mod) => { captured = mod } },
  navigator: { language: 'zh-CN' },
  localStorage: { store: new Map(), getItem(k) { return this.store.has(k) ? this.store.get(k) : null }, setItem(k, v) { this.store.set(k, String(v)) } },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
}
const fakeDocument = { hidden: false, addEventListener() {}, removeEventListener() {} }
new Function('window', 'document', 'navigator', src)(fakeWindow, fakeDocument, fakeWindow.navigator)
const mod = captured.factory((name) => (name === 'react' ? { createElement: () => ({}), Component: class {}, Fragment: Symbol('f') } : {}))
const candidates = mod.__test.notificationCandidates

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const now = Date.now()
const attention = [
  { level: 'urgent', code: 'goal.blocked', sessionId: 's1', label: 'tower', title: '受阻' },
  { level: 'waiting', code: 'goal.idle', sessionId: 's1', label: 'tower', title: '空转' },
  { level: 'urgent', code: 'job.failed', sessionId: 's2', jobId: 'bash-1', label: 'project', title: '失败' },
  { level: 'waiting', code: 'goal.paused', sessionId: 's3', label: 'x', title: '暂停' },
]

const fresh = candidates(attention, {}, now)
assert(fresh.length === 2, '只挑 urgent（2 条）')
assert(fresh[0].key === 'goal.blocked:s1:', 'key 形状稳定')
assert(fresh[1].key === 'job.failed:s2:bash-1', 'job 记录带 jobId')

const seen = {}
seen[fresh[0].key] = now - 60000
const again = candidates(attention, seen, now)
assert(again.length === 1 && again[0].key === fresh[1].key, '1 分钟前弹过的不再弹')

const old = {}
old[fresh[0].key] = now - 7 * 60 * 60 * 1000
assert(candidates(attention, old, now).length === 2, '超过 6 小时窗口后允许再弹')

const withWaiting = candidates(attention, {}, now, false)
assert(withWaiting.length === 4, 'notifyOnlyUrgent=false 时等待项也弹')
assert(candidates(attention, {}, now, true).length === 2, 'notifyOnlyUrgent=true 时只弹 urgent')

assert(candidates([], {}, now).length === 0, '空列表不弹')
assert(candidates(null, {}, now).length === 0, 'null 安全')

console.log(process.exitCode ? '\nNOTIFY FAILED' : '\nNOTIFY PASSED')
