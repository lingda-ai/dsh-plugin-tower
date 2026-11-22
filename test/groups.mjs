/** 航班分组与排序（纯函数）。运行：node test/groups.mjs */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let captured = null
const fakeWindow = {
  __ModuleLoader__: { load: (mod) => { captured = mod } },
  navigator: { language: 'zh-CN' },
  localStorage: { store: new Map(), getItem(k) { return this.store.has(k) ? this.store.get(k) : null }, setItem(k, v) { this.store.set(k, String(v)) } },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
}
new Function('window', 'document', 'navigator', src)(fakeWindow, { hidden: false, addEventListener() {}, removeEventListener() {} }, fakeWindow.navigator)
const mod = captured.factory((name) => (name === 'react' ? { createElement: () => ({}), Component: class {}, Fragment: Symbol('f') } : {}))
const group = mod.__test.groupFlights
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exitCode = 1 } else console.log('ok  ' + m) }

const now = Date.now()
const flights = [
  { sessionId: 'a', cwdName: 'proj-a', lastEventAt: now - 5000 },
  { sessionId: 'b', cwdName: 'proj-b', lastEventAt: now - 1000 },
  { sessionId: 'c', cwdName: 'proj-a', lastEventAt: now - 100 },
]
const urgent = new Set(['a'])

const byAttention = group(flights, 'attention', urgent)
assert(byAttention.length === 2, '按工作区分成两组')
assert(byAttention[0].name === 'proj-a', '有紧急项的组排前面')
assert(byAttention[0].urgent === 1, '组头统计紧急数')
assert(byAttention[0].flights[0].sessionId === 'a', '组内紧急项排最前')

const byRecent = group(flights, 'recent', urgent)
assert(byRecent[0].name === 'proj-a', '按最近活动排序时，含最新活动的组在最前')
const twoItem = byRecent.find((g) => g.flights.length === 2)
assert(twoItem && twoItem.flights[0].lastEventAt >= twoItem.flights[1].lastEventAt, '组内按最近活动倒序')

const byName = group(flights, 'name', urgent)
assert(byName[0].name === 'proj-a', '按名称排序')

const single = group([{ sessionId: 'x', cwdName: 'one', lastEventAt: now }], 'attention', urgent)
assert(single.length === 1, '单工作区只有一组（调用方据此平铺）')

console.log(process.exitCode ? '\nGROUPS FAILED' : '\nGROUPS PASSED')
