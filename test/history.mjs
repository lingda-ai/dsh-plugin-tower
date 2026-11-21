/**
 * 作业历史测试（Host 侧）。
 *
 * 事件形状来自真实持久化日志抽样（docs/verification.md §7.11）：
 *   job/registered { jobId, owner, kind, label, startedAt, toolCall }
 *   job/settled    { …同上…, finishedAt, status, cause, detail }
 *
 * 运行：node test/history.mjs
 */
import { __internal } from '../index.js'

const assert = (condition, message) => {
  if (!condition) {
    console.error('FAIL: ' + message)
    process.exitCode = 1
  } else {
    console.log('ok  ' + message)
  }
}

const now = Date.now()
const registered = (jobId, label, startedAt) => ({
  type: 'job/registered',
  time: startedAt,
  data: { jobId, owner: 'session-a', kind: 'bash', label, startedAt, toolCall: { callId: 'c', rootCallId: 'c' } },
})
const settled = (jobId, label, startedAt, finishedAt, status, detail) => ({
  type: 'job/settled',
  time: finishedAt,
  data: { jobId, owner: 'session-a', kind: 'bash', label, startedAt, finishedAt, status, cause: 'producer', detail },
})

// 1) 配对：注册 + 收口 → 一条记录
const jobs = __internal.readJobsFromEvents([
  registered('bash-1', 'pnpm build', now - 5000),
  settled('bash-1', 'pnpm build', now - 5000, now - 4000, 'completed', 'exit code: 0'),
  registered('bash-2', 'pnpm test', now - 3000),
  settled('bash-2', 'pnpm test', now - 3000, now - 2000, 'failed', 'exit code: 1'),
  registered('bash-3', 'still running', now - 1000),
])
const byId = Object.fromEntries(jobs.map((job) => [job.jobId, job]))
assert(jobs.length === 3, '三条作业各自配对成一条记录')
assert(byId['bash-1'].status === 'completed' && byId['bash-1'].finishedAt === now - 4000, 'completed 收口时间正确')
assert(byId['bash-2'].status === 'failed' && byId['bash-2'].detail === 'exit code: 1', 'failed 带 exit code')
assert(byId['bash-3'].status === 'running' && byId['bash-3'].finishedAt === 0, '未收口的作业标记 running')

// 2) 跨会话历史：只返回窗口内、已收口、按结束时间倒序
const sessions = [
  {
    header: { id: 'session-new', createdAt: now - 1000, cwd: '/tmp/projects/tower' },
    revision: 'rev-1',
    events: [
      registered('bash-new', 'pnpm build', now - 5000),
      settled('bash-new', 'pnpm build', now - 5000, now - 3600000, 'completed', 'exit code: 0'),
      registered('bash-old', 'old job', now - 90000000),
      settled('bash-old', 'old job', now - 90000000, now - 89000000, 'completed', 'exit code: 0'),
    ],
  },
  {
    header: { id: 'session-other', createdAt: now - 2000, cwd: '/tmp/projects/other' },
    revision: 'rev-2',
    events: [
      registered('bash-fail', 'pnpm test', now - 2000),
      settled('bash-fail', 'pnpm test', now - 2000, now - 1000, 'failed', 'exit code: 1'),
    ],
  },
]
let openCalls = 0
const fakeCtx = {
  get(name) {
    if (name !== 'sessionPersistence') return null
    return {
      list: async () => sessions.map((session) => ({ header: session.header, revision: session.revision })),
      open: async (id) => {
        openCalls += 1
        const found = sessions.find((session) => session.header.id === id)
        return { read: async () => ({ events: found.events }), close: async () => {} }
      },
    }
  },
}

const history = await __internal.collectJobHistory(fakeCtx, 20, 24 * 60 * 60 * 1000)
assert(history.ok === true, '历史扫描成功')
assert(history.jobs.length === 2, '24h 窗口内只有两条已收口作业')
assert(history.jobs[0].jobId === 'bash-fail', '按结束时间倒序（最新在前）')
assert(history.jobs[0].cwdName === 'other', '带上会话目录名')
assert(history.jobs[1].jobId === 'bash-new', '另一条来自另一个会话')
assert(history.jobs[0].durationMs === 1000, '持续时间由 startedAt/finishedAt 复算')
assert(history.total === 2, 'total 为窗口内总数')

const narrow = await __internal.collectJobHistory(fakeCtx, 20, 500)
assert(narrow.jobs.length === 0, '缩小窗口后过滤掉较早的作业')

const before = openCalls
const again = await __internal.collectJobHistory(fakeCtx, 20, 24 * 60 * 60 * 1000)
assert(again.jobs.length === 2 && openCalls === before, '同 revision 走缓存，不重复读盘')

const missing = await __internal.collectJobHistory({ get: () => null }, 20, 1000)
assert(missing.ok === false, '持久化服务缺失时显式失败')

console.log(process.exitCode ? '\nHISTORY FAILED' : '\nHISTORY PASSED')
