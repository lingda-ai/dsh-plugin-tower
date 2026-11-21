/**
 * 装配冒烟测试：在 Node 里跑 client.js 的模块工厂与 apply()，
 * 验证「类型登记 + 三个 seat 注册」这条链路不会在浏览器里第一步就抛。
 *
 * 它**不渲染组件**（没有 React 运行时），但能抓住最常见的两类事故：
 *   1) 工厂/apply 阶段的顶层引用错误（改了常量名没改引用）
 *   2) 注册参数写错（seat 名、key、guide 结构）
 *
 * 运行：node test/wiring.mjs
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let captured = null
const fakeWindow = {
  __ModuleLoader__: {
    load(mod) {
      captured = mod
    },
  },
  navigator: { language: 'zh-CN' },
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, value) {
      this.store.set(key, String(value))
    },
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
}
const fakeDocument = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
}

const run = new Function('window', 'document', 'navigator', src)
run(fakeWindow, fakeDocument, fakeWindow.navigator)

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

assert(captured !== null, '模块通过 __ModuleLoader__ 注册')
assert(captured.id === 'dsh-plugin-tower', '模块 id 正确')

const fakeReact = {
  createElement: () => ({ __element: true }),
  Fragment: Symbol("Fragment"),
  Component: class { constructor(props) { this.props = props } },
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}
const mod = captured.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error('unexpected require: ' + name)
})

assert(Array.isArray(mod.inject) && mod.inject.includes('sidebarRightTabs'), 'inject 声明 sidebarRightTabs')
assert(typeof mod.apply === 'function', '导出 apply')

const registrations = []
let tabDef = null
const ctx = {
  get(name) {
    if (name === 'slots') {
      return {
        inject(seat, factory) {
          const dispose = factory()
          return () => {
            if (typeof dispose === 'function') dispose()
          }
        },
        register(options, component) {
          registrations.push({ seat: options.name, key: options.key || options.id, component })
          return () => {}
        },
      }
    }
    return null
  },
  sidebarRightTabs: {
    register(definition) {
      tabDef = definition
      return () => {}
    },
  },
  effect(fn) {
    const dispose = fn()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
}

await mod.apply(ctx)

assert(tabDef !== null, '右栏 tab 类型已登记')
assert(tabDef.kind === 'tower.supervision', 'tab kind = tower.supervision')
assert(typeof tabDef.title === 'function' && tabDef.title() === '塔台', 'tab 标题走 locale（中文）')
assert(Array.isArray(tabDef.guide) && tabDef.guide.length === 1, '引导页 entry 已登记')
assert(tabDef.keepMounted === false, '面板关闭即卸载')

const seats = registrations.map((row) => row.seat)
assert(seats.includes('sidebar.right.pane.tab'), '正文 seat 已注册')
assert(seats.includes('sidebar.right.pane.tab.title'), '标题 seat 已注册')
assert(seats.includes('conversation.input.right'), '输入框入口已注册')

const body = registrations.find((row) => row.seat === 'sidebar.right.pane.tab')
assert(body && body.key === 'dsh-plugin-tower', '正文 seat 的 key 等于类型 id')
assert(registrations.every((row) => typeof row.component === 'function'), '每个 seat 的组件都是函数')

console.log(process.exitCode ? '\nWIRING FAILED' : '\nWIRING PASSED')
