/**
 * 路由冒烟测试：用假 req/res 跑 handleRequest，验证方法门、同源门、body 门与动作分发。
 * 运行：node test/route.mjs
 */
import { Readable } from 'node:stream'
import { __internal } from '../index.js'

const now = Date.now()
const goalView = {
  id: 'g-1',
  revision: 2,
  objective: 'demo',
  phase: 'active',
  maxGoalRounds: 10,
  roundsStarted: 1,
  createdAt: now,
  updatedAt: now,
  activation: 'armed',
}

const agent = { id: 'session-a' }
const fakeCtx = {
  get(name) {
    if (name === 'agents') {
      return {
        list: () => [agent],
        get: (id) => (id === 'session-a' ? agent : undefined),
        turnBoundaryOf: () => ({ openTurnStartSeq: null, lastStepStartSeq: null, lastStepBoundary: null, lastTurn: 1 }),
      }
    }
    if (name === 'sessions') return { get: (id) => ({ id, header: { id, createdAt: now, cwd: '/tmp/demo', isSeeded: false } }) }
    if (name === 'goals') {
      return {
        get: () => goalView,
        pause: (a, ref) => ({ ...goalView, phase: 'paused', revision: ref.revision }),
        resume: (a, ref) => ({ ...goalView, phase: 'active', revision: ref.revision }),
        complete: (a, ref) => ({ ...goalView, phase: 'complete', revision: ref.revision }),
      }
    }
    if (name === 'jobs') {
      return {
        list: () => [],
        kill: () => 'requested',
        get: (id, caller) => {
          if (id !== 'bash-1') throw new Error('job not found')
          if (caller && caller !== 'session-a') throw new Error('foreign job')
          return { id, status: 'failed', output: { total: 12000 } }
        },
        readAt: (id, from, caller) => {
          if (id !== 'bash-1') throw new Error('job not found')
          if (caller && caller !== 'session-a') throw new Error('foreign job')
          return { chunks: [{ at: from, text: 'line-1\nline-2\nTypeError: boom\n' }], next: 12000, lossy: false }
        },
      }
    }
    if (name === 'schedule') return { catalog: async () => [], run: async () => ({ id: 'x' }) }
    return null
  },
}

function makeReq(method, url, headers, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload)
  req.method = method
  req.url = url
  req.headers = headers || {}
  return req
}

function makeRes() {
  const out = { status: 0, headers: {}, body: '' }
  return {
    out,
    writeHead(status, headers) {
      out.status = status
      out.headers = headers || {}
    },
    end(body) {
      out.body = body === undefined ? '' : String(body)
    },
    destroy() {},
  }
}

async function call(method, url, headers, body) {
  const res = makeRes()
  await __internal.handleRequest(fakeCtx, makeReq(method, url, headers, body), res)
  let parsed = null
  try {
    parsed = JSON.parse(res.out.body)
  } catch {
    parsed = null
  }
  return { status: res.out.status, headers: res.out.headers, body: parsed }
}

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const get = await call('GET', '/dsh-tower/api', { host: '127.0.0.1:64700' })
assert(get.status === 200 && get.body.ok === true, 'GET 快照 200')
assert(get.headers['cache-control'] === 'no-store', '快照不缓存')
assert(get.body.flights.length === 1, '快照含一个航班')

const lean = await call('GET', '/dsh-tower/api?counts=1', { host: '127.0.0.1:64700' })
assert(lean.body.flights.length === 0 && lean.body.counts.live === 1, 'counts=1 轻量包')

const pause = await call(
  'POST',
  '/dsh-tower/api',
  { host: '127.0.0.1:64700', origin: 'http://127.0.0.1:64700', 'content-type': 'application/json' },
  { action: 'goal.pause', sessionId: 'session-a', goalId: 'g-1', revision: 2 },
)
assert(pause.status === 200 && pause.body.ok === true && pause.body.result.phase === 'paused', 'POST 目标暂停')

const afterPauseSnap = await call('GET', '/dsh-tower/api', { host: '127.0.0.1:64700' })
assert(Array.isArray(afterPauseSnap.body.recent) && afterPauseSnap.body.recent.length > 0, '快照带处置记录')
assert(afterPauseSnap.body.recent[0].verb === 'pause', '最新一条记录是刚才的暂停')
assert(afterPauseSnap.body.recent[0].label.indexOf('demo') >= 0, '记录里带目标原文')
assert(lean.body.recent.length === 0, 'lean 包不带处置记录')

const cross = await call(
  'POST',
  '/dsh-tower/api',
  { host: '127.0.0.1:64700', origin: 'http://evil.example', 'content-type': 'application/json' },
  { action: 'goal.pause', sessionId: 'session-a', goalId: 'g-1', revision: 2 },
)
assert(cross.status === 403 && cross.body.error === 'origin-rejected', '跨源 POST 被拒')

const sameOrigin = await call(
  'POST',
  '/dsh-tower/api',
  { host: '127.0.0.1:64700', origin: 'http://localhost:64700', 'content-type': 'application/json' },
  { action: 'schedule.run', scheduleId: 's-1' },
)
assert(sameOrigin.status === 200 && sameOrigin.body.ok === true, 'localhost 源放行')

const badBody = await call('POST', '/dsh-tower/api', { host: '127.0.0.1:64700' }, { action: 'goal.pause' })
assert(badBody.status === 200 && badBody.body.ok === false, '缺少会话 id 的动作被拒（业务层）')

const tail = await call('GET', '/dsh-tower/api?job=bash-1&session=session-a&tail=4000', { host: '127.0.0.1:64700' })
assert(tail.status === 200 && tail.body.ok === true, '作业日志尾部 200')
assert(tail.body.text.indexOf('TypeError: boom') >= 0, '日志尾部包含失败行')
assert(tail.body.job.truncated === true && tail.body.job.from === 8000, '尾部截断元信息正确')
assert(tail.body.job.total === 12000, '尾部返回输出总量')

const noJob = await call('GET', '/dsh-tower/api?job=bash-404&session=session-a', { host: '127.0.0.1:64700' })
assert(noJob.body.ok === false, '未知作业返回失败而不是空文本')

const foreign = await call('GET', '/dsh-tower/api?job=bash-1&session=session-b', { host: '127.0.0.1:64700' })
assert(foreign.body.ok === false, '跨会话读作业被拒')

const emptyJob = await call('GET', '/dsh-tower/api?job=', { host: '127.0.0.1:64700' })
assert(emptyJob.body.ok === false && emptyJob.body.error === '缺少作业 id', '空作业 id 被显式拒绝')

const put = await call('PUT', '/dsh-tower/api', { host: '127.0.0.1:64700' })
assert(put.status === 405 && put.headers.allow === 'GET, HEAD, POST', '其它方法 405 并带 Allow')

console.log(process.exitCode ? '\nROUTE FAILED' : '\nROUTE PASSED')
