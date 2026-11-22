/**
 * 报告预览渲染：面板里把 Markdown 变成可读排版（而不是原样显示 ## 和 -）。
 * 只覆盖报告会出现的语法；不引第三方 Markdown 库。
 * 运行：node test/markdown.mjs
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

const FakeReact = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {})
    merged.children = children.length === 1 ? children[0] : children
    return { __el: true, type, props: merged }
  },
  Component: class {},
  Fragment: Symbol('Fragment'),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
}
const mod = captured.factory((name) => (name === 'react' ? FakeReact : {}))
const render = mod.__test.renderReportMarkdown

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const markdown = [
  '# 值守报告 · 2026-11-22 09:44:38',
  '',
  '- 范围：最近 24 小时',
  '',
  '## 一、待处置（需要人）',
  '',
  '- [紧急] tower：目标受阻',
  '  - 细项：缺少凭证',
  '',
  '---',
  '普通段落 **加粗** 与 <代码>',
].join('\n')

const nodes = render(markdown)
const types = []
const text = []
function walk(node) {
  if (node === null || node === undefined) return
  if (typeof node === 'string' || typeof node === 'number') { text.push(String(node)); return }
  if (Array.isArray(node)) { node.forEach(walk); return }
  if (typeof node === 'object' && node.__el) {
    types.push(node.type)
    walk(node.props.children)
  }
}
walk(nodes)
const joined = text.join('|')

assert(nodes.length > 5, '切成多个块（' + nodes.length + '）')
assert(joined.indexOf('值守报告') >= 0, '一级标题文本保留')
assert(joined.indexOf('一、待处置') >= 0, '二级标题文本保留')
assert(joined.indexOf('范围：最近 24 小时') >= 0, '列表项保留')
assert(joined.indexOf('细项：缺少凭证') >= 0, '缩进子项保留')
assert(types.includes('ul') && types.includes('li'), '列表渲染成 ul/li 而不是原文')
assert(types.includes('strong'), '**加粗** 渲染成 strong')
assert(joined.indexOf('**') < 0, '预览里不再残留 Markdown 记号 **')
assert(joined.indexOf('##') < 0, '预览里不再残留 Markdown 记号 ##')
assert(joined.indexOf('<代码>') >= 0, '尖括号按文本处理（React 自动转义）')

console.log(process.exitCode ? '\nMARKDOWN FAILED' : '\nMARKDOWN PASSED')
