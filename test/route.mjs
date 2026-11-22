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
    if (name === 'sessionPersistence') {
      return {
        list: async () => [
          { header: { id: 'session-closed', createdAt: now - 1000, cwd: '/tmp/projects/closed-demo' }, revision: 'rev-c1' },
          { header: { id: 'session-a', createdAt: now, cwd: '/tmp/demo' }, revision: 'rev-live' },
        ],
        open: async (id) => ({
          read: async () => ({
            events: id !== 'session-closed' ? [] : [
              {
                type: 'goal/change',
                time: now - 500,
                data: {
                  kind: 'goal/change',
                  version: 1,
                  operation: 'create',
                  goal: { id: 'g-old', revision: 1, objective: '旧目标：整理迁移脚本', phase: 'complete', maxGoalRounds: 5 },
                  roundsStarted: 2,
                  createdAt: now - 900,
                  updatedAt: now - 500,
                },
              },
              {
                type: 'job/registered',
                time: now - 3000,
                data: { jobId: 'bash-h1', owner: 'session-closed', kind: 'bash', label: 'pnpm build', startedAt: now - 3000 },
              },
              {
                type: 'job/settled',
                time: now - 1000,
                data: {
                  jobId: 'bash-h1',
                  owner: 'session-closed',
                  kind: 'bash',
                  label: 'pnpm build',
                  startedAt: now - 3000,
                  finishedAt: now - 1000,
                  status: 'failed',
                  cause: 'producer',
                  detail: 'exit code: 1',
                },
              },
            ],
          }),
          close: async () => {},
        }),
      }
    }
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
  // raw 给非 JSON 响应（例如 HTML 报告）用；body 仍是解析后的 JSON
  return { status: res.out.status, headers: res.out.headers, body: parsed, raw: res.out.body }
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

const capsSnap = await call('GET', '/dsh-tower/api?counts=1', { host: '127.0.0.1:64700' })
assert(/^\d+\.\d+\.\d+$/.test(String(capsSnap.body.version)), '快照带插件版本号')
assert(capsSnap.body.caps && capsSnap.body.caps.goals === true && capsSnap.body.caps.log === true, '能力自检全绿')
assert(capsSnap.body.policy && capsSnap.body.policy.idleMinutes === 20, '快照带策略（默认 20 分钟）')
assert(lean.body.caps && lean.body.caps.jobs === true, 'lean 包同样带能力自检')

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

const closed = await call('GET', '/dsh-tower/api?closed=1&limit=8', { host: '127.0.0.1:64700' })
assert(closed.status === 200 && closed.body.ok === true, '已收场扫描 200')
assert(closed.body.closed.length === 1, '只返回已关闭且有目标的会话')
assert(closed.body.closed[0].sessionId === 'session-closed', '命中已关闭会话')
assert(closed.body.closed[0].goal.objective.indexOf('旧目标') >= 0, '复算出旧目标原文')
assert(closed.body.closed[0].goal.roundsStarted === 2, '复算出轮次')

const history = await call('GET', '/dsh-tower/api?history=1&limit=20', { host: '127.0.0.1:64700' })
assert(history.status === 200 && history.body.ok === true, '作业历史扫描 200')
assert(history.body.jobs.length === 1, '窗口内只有一条已收口作业')
assert(history.body.jobs[0].jobId === 'bash-h1' && history.body.jobs[0].status === 'failed', '作业状态与 id 正确')
assert(history.body.jobs[0].durationMs === 2000, '持续时间复算正确')
assert(history.body.jobs[0].cwdName === 'closed-demo', '带会话目录名')

const audit = await call('GET', '/dsh-tower/api?audit=1', { host: '127.0.0.1:64700' })
assert(audit.status === 200 && audit.body.ok === true, '审计状态 200')
assert(typeof audit.body.status.enabled === 'boolean' && typeof audit.body.status.count === 'number', '审计状态形状正确')
assert(typeof audit.body.status.path === 'string' && audit.body.status.path.indexOf('tower') >= 0, '审计路径指向 tower 目录')

const auditVerify = await call('GET', '/dsh-tower/api?audit=1&verify=1', { host: '127.0.0.1:64700' })
assert(auditVerify.body.ok === true && typeof auditVerify.body.verify.ok === 'boolean', '校验端点返回链状态')

const report = await call('GET', '/dsh-tower/api?report=1&hours=24', { host: '127.0.0.1:64700' })
assert(report.status === 200 && report.body.ok === true, '值守报告 200')
assert(String(report.body.markdown).indexOf('# 值守报告') === 0, '报告 markdown 以标题开头')
assert(String(report.body.markdown).indexOf('## 五、审计') >= 0, '报告包含审计小节')
assert(report.body.windowHours === 24, '报告窗口参数生效')

const reportHtml = await call('GET', '/dsh-tower/api?report=1&format=html&hours=24', { host: '127.0.0.1:64700' })
assert(String(reportHtml.headers['content-type']).indexOf('text/html') >= 0, 'HTML 报告 content-type 正确')
assert(String(reportHtml.headers['content-disposition']).indexOf('attachment') >= 0, 'HTML 报告带下载文件名')
assert(String(reportHtml.raw).indexOf('<!doctype html>') === 0, 'HTML 报告是完整文档')
assert(String(reportHtml.raw).indexOf('class="sheet"') >= 0, 'HTML 报告带独立样式表(.sheet)')

const put = await call('PUT', '/dsh-tower/api', { host: '127.0.0.1:64700' })
assert(put.status === 405 && put.headers.allow === 'GET, HEAD, POST', '其它方法 405 并带 Allow')

console.log(process.exitCode ? '\nROUTE FAILED' : '\nROUTE PASSED')
