/**
 * 渲染冒烟测试：用一个玩具 React 把面板组件树整棵跑一遍。
 *
 * 它不验证「好不好看」，只验证「会不会炸」——未定义变量、错位的 props、
 * 在渲染期调用不存在的函数，这些都会被它逮到（真机上就是白屏）。
 *
 * 用一个假 store 直接喂「有数据的快照」，因此能覆盖：
 * 状态行 / 航班卡（有目标 + 无目标 + 子代理）/ 待处置（受阻 + 失败）/
 * 后台作业行 / 定时行 / 空态 / 页脚。
 *
 * 运行：node test/render.mjs
 */
import { readFileSync } from 'node:fs'

// ---- 玩具 React：支持函数组件、类组件、Fragment、useState/useEffect/useCallback/useRef ----
let hooks = []
let hookIndex = 0

class FakeComponent {
  constructor(props) {
    this.props = props
    this.state = {}
  }
  setState(patch) {
    this.state = Object.assign({}, this.state, patch)
  }
}

const FakeReact = {
  Component: FakeComponent,
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {})
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { __el: true, type, props: merged }
  },
  useState(initial) {
    const index = hookIndex++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useRef(initial) {
    const index = hookIndex++
    if (!(index in hooks)) hooks[index] = { current: initial }
    return hooks[index]
  },
}
FakeComponent.prototype.isReactComponent = true

// ---- 载入 client.js 并取到模块 ----
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
const fakeDocument = { hidden: false, addEventListener() {}, removeEventListener() {} }

new Function('window', 'document', 'navigator', src)(fakeWindow, fakeDocument, fakeWindow.navigator)
const mod = captured.factory((name) => {
  if (name === 'react') return FakeReact
  throw new Error('unexpected require: ' + name)
})

// ---- 玩具渲染器 ----
const text = []
let elementCount = 0

function walk(node) {
  if (node === null || node === undefined || node === false) return
  if (typeof node === 'string' || typeof node === 'number') {
    text.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child)
    return
  }
  if (typeof node !== 'object' || !node.__el) return

  const { type, props } = node
  if (typeof type === 'function') {
    elementCount += 1
    const isClass = type.prototype && type.prototype.isReactComponent
    if (isClass) {
      const instance = new type(props)
      instance.props = props
      walk(instance.render())
      return
    }
    const savedHooks = hooks
    const savedIndex = hookIndex
    hooks = []
    hookIndex = 0
    try {
      walk(type(Object.assign({}, props)))
    } finally {
      hooks = savedHooks
      hookIndex = savedIndex
    }
    return
  }
  if (type === FakeReact.Fragment) {
    walk(props.children)
    return
  }
  if (typeof type === 'string') walk(props.children)
}

// ---- 构造「有数据」的快照 ----
const now = Date.now()
const snapshot = {
  ok: true,
  loading: false,
  error: '',
  at: now,
  version: '0.1.6',
  caps: { agents: true, goals: true, jobs: true, log: true, schedule: true, sessions: true },
  counts: { live: 3, running: 1, goals: 1, urgent: 1, waiting: 1, jobs: 2, schedules: 1 },
  attention: [
    {
      level: 'urgent',
      code: 'goal.blocked',
      sessionId: 'session-a',
      label: 'tower',
      title: '目标受阻：缺少宿主接口凭证',
      detail: '把右侧栏插件做成可交付的产品',
      at: now - 180000,
    },
    {
      level: 'urgent',
      code: 'job.failed',
      sessionId: 'session-a',
      jobId: 'bash-1',
      label: 'tower',
      title: 'pnpm build 失败',
      detail: 'exit 1',
      at: now - 60000,
    },
    {
      level: 'waiting',
      code: 'goal.paused',
      sessionId: 'session-b',
      label: 'project',
      title: '目标已暂停，等你决定是否继续',
      detail: '整理迁移脚本',
      at: now - 30000,
    },
  ],
  flights: [
    {
      sessionId: 'session-a',
      short: 'aaaaaaaaaa',
      cwd: '/tmp/tower',
      cwdName: 'tower',
      agentPreset: 'cordis',
      origin: 'root',
      parentSession: '',
      createdAt: now - 3600000,
      turn: 8,
      running: true,
      goal: {
        id: 'goal-1',
        revision: 4,
        objective: '把右侧栏插件做成可交付的产品',
        phase: 'active',
        roundsStarted: 7,
        maxGoalRounds: 20,
        activation: 'armed',
        blockedCode: '',
        blockedMessage: '',
        updatedAt: now - 120000,
      },
      jobs: [
        { id: 'bash-1', label: 'pnpm build', kind: 'bash', status: 'failed', progress: '', detail: 'exit 1', startedAt: now - 90000, finishedAt: now - 60000, outputBytes: 4096 },
        { id: 'bash-2', label: 'pnpm test', kind: 'bash', status: 'running', progress: 'running 12/40', detail: '', startedAt: now - 40000, finishedAt: 0, outputBytes: 8192 },
      ],
    },
    {
      sessionId: 'session-b',
      short: 'bbbbbbbbbb',
      cwd: '/tmp/project',
      cwdName: 'project',
      agentPreset: 'standard',
      origin: 'root',
      parentSession: '',
      createdAt: now - 7200000,
      turn: 3,
      running: false,
      goal: {
        id: 'goal-2',
        revision: 1,
        objective: '整理迁移脚本',
        phase: 'paused',
        roundsStarted: 2,
        maxGoalRounds: 10,
        activation: 'disarmed',
        blockedCode: '',
        blockedMessage: '',
        updatedAt: now - 300000,
      },
      jobs: [],
    },
    {
      sessionId: 'session-c',
      short: 'cccccccccc',
      cwd: '/tmp/project',
      cwdName: 'project',
      agentPreset: 'standard',
      origin: 'subagent',
      parentSession: 'session-b',
      createdAt: now - 600000,
      turn: 1,
      running: false,
      goal: null,
      jobs: [],
    },
  ],
  recent: [
    { at: now - 5000, verb: 'pause', sessionId: 'session-a', label: '把右侧栏插件做成可交付的产品', outcome: 'ok' },
    { at: now - 90000, verb: 'kill', sessionId: 'session-a', label: 'pnpm build', outcome: 'requested' },
  ],
  schedules: [
    {
      id: 'sched-1',
      title: '每日站会纪要',
      status: 'active',
      kind: 'daily',
      scheduledAt: new Date(now + 600000).toISOString(),
      targetKind: 'session',
      targetSessionId: 'session-a',
      lastDeliveredAt: '',
    },
  ],
}

const fakeStore = {
  get: () => snapshot,
  subscribe: () => () => {},
  wantFull: () => {},
  refresh: async () => {},
}

const t = mod.__test.makeT('zh')
const Panel = mod.__test.makePanel({ get: () => null }, t, fakeStore)

// ---- 跑渲染 ----
const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

let threw = null
try {
  walk(Panel({ sessionId: 'session-a' }))
} catch (error) {
  threw = error
}
assert(threw === null, '面板渲染不抛异常' + (threw ? '（' + threw.message + '）' : ''))

const joined = text.join('|')
assert(elementCount > 40, '组件树规模合理（' + elementCount + ' 个组件）')
assert(joined.indexOf('塔台') >= 0, '渲染出标题')
assert(joined.indexOf('在飞') >= 0 && joined.indexOf('待处置') >= 0, '渲染出状态行')
assert(joined.indexOf('需要你') >= 0, '渲染出「需要你」分区')
assert(joined.indexOf('目标受阻：缺少宿主接口凭证') >= 0, '渲染出受阻原因')
assert(joined.indexOf('把右侧栏插件做成可交付的产品') >= 0, '渲染出目标原文')
assert(joined.indexOf('暂停') >= 0 && joined.indexOf('完成') >= 0, '渲染出目标动作')
assert(joined.indexOf('pnpm build') >= 0, '渲染出后台作业')
assert(joined.indexOf('日志') >= 0, '渲染出日志入口')
assert(joined.indexOf('终止') >= 0, '渲染出终止按钮')
assert(joined.indexOf('每日站会纪要') >= 0, '渲染出定时任务')
assert(joined.indexOf('立即执行') >= 0, '渲染出立即执行')
assert(joined.indexOf('子代理') >= 0, '渲染出子代理标记')
assert(joined.indexOf('无目标') >= 0, '渲染出无目标标记')
assert(joined.indexOf('建目标') >= 0, '无目标卡片给出「建目标」入口')
assert(joined.indexOf('当前') >= 0, '渲染出当前会话标记')
assert(joined.indexOf('第 8 轮') >= 0, '渲染出轮次元信息')
assert(joined.indexOf('本机只读快照') >= 0, '渲染出页脚')
assert(joined.indexOf('最近处置') >= 0, '渲染出「最近处置」分区')
assert(joined.indexOf('v0.1.6') >= 0, '页脚渲染出版本号')

// 空快照也要能渲染（新装用户第一眼）
const emptyStore = {
  get: () => ({ ok: true, loading: false, error: '', at: now, counts: { live: 0, running: 0, urgent: 0, jobs: 0, schedules: 0 }, attention: [], flights: [], schedules: [] }),
  subscribe: () => () => {},
  wantFull: () => {},
  refresh: async () => {},
}
const EmptyPanel = mod.__test.makePanel({ get: () => null }, t, emptyStore)
text.length = 0
elementCount = 0
let emptyThrew = null
try {
  walk(EmptyPanel({ sessionId: 'session-a' }))
} catch (error) {
  emptyThrew = error
}
const emptyJoined = text.join('|')
assert(emptyThrew === null, '空快照渲染不抛异常' + (emptyThrew ? '（' + emptyThrew.message + '）' : ''))
assert(emptyJoined.indexOf('塔台安静') >= 0, '空态渲染出标题')
assert(emptyJoined.indexOf('给这件事建一个目标') >= 0, '空态渲染出起手式')

// 降级场景：宿主缺 schedule / jobs
const degradedStore = {
  get: () => Object.assign({}, snapshot, { caps: { agents: true, goals: true, jobs: false, log: false, schedule: false, sessions: true } }),
  subscribe: () => () => {},
  wantFull: () => {},
  refresh: async () => {},
}
const DegradedPanel = mod.__test.makePanel({ get: () => null }, t, degradedStore)
text.length = 0
elementCount = 0
let degradedThrew = null
try {
  walk(DegradedPanel({ sessionId: 'session-a' }))
} catch (error) {
  degradedThrew = error
}
const degradedJoined = text.join('|')
assert(degradedThrew === null, '降级快照渲染不抛异常' + (degradedThrew ? '（' + degradedThrew.message + '）' : ''))
assert(degradedJoined.indexOf('3 项不可用') >= 0, '页脚显示降级项数')

console.log(process.exitCode ? '\nRENDER FAILED' : '\nRENDER PASSED')
