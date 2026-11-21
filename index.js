/**
 * dsh-plugin-tower —— Host half.
 *
 * 职责只有两件，且都不缓存：
 *   1. GET  /dsh-tower/api           —— 实时读「在飞航班」快照（全机，不只本会话）
 *   2. POST /dsh-tower/api           —— 三个由人显式触发的动作：目标 暂停/继续/完成、
 *                                       后台作业终止、定时任务立即执行
 *
 * 设计约束（第一性原理：值守面板必须比它监视的对象更可靠）：
 *   - 只读服务、只读投影。除了用户点击的三个动作，不改任何状态。
 *   - 任何宿主服务缺失都降级成空数组，绝不让面板把宿主带崩。
 *   - 数据在 Host 进程里现取现序列化，不落盘、不出网、不留副本。
 */

const API_PREFIX = '/dsh-tower/api'

/** 日志尾部的硬上限：一次最多取 8KB，返回文本再截 20k 字符（双保险）。 */
const MAX_TAIL_BYTES = 8000

/**
 * 本次运行内的处置记录。只记「人点过且成功」的动作，不推测、不补记。
 * 内存 ring：重启即清空——所以 UI 上必须写「本次运行内」，不能伪装成审计日志。
 * 它是 L4 审计层的第一步：事件源已经存在，后续只需落盘 + 哈希链。
 */
const ACTION_HISTORY_LIMIT = 30
const actionHistory = []

function recordAction(entry) {
  actionHistory.push(entry)
  if (actionHistory.length > ACTION_HISTORY_LIMIT) {
    actionHistory.splice(0, actionHistory.length - ACTION_HISTORY_LIMIT)
  }
}

function recentActions() {
  return actionHistory
    .slice(-20)
    .map((entry) => Object.assign({}, entry))
    .reverse()
}

/** 硬依赖：没有 HTTP 载体就没有面板。缺这个服务时插件不激活，而不是半死。 */
export const inject = ['webServer']

/** 取可选服务。未声明的服务属性访问在 cordis 代理上会抛，所以统一走 ctx.get。 */
function service(ctx, name) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name) ?? null
    return ctx[name] ?? null
  } catch {
    return null
  }
}

/** 把任何一次宿主调用收敛成值或兜底值；值守面板绝不因为一条脏数据整体失败。 */
function attempt(fn, fallback) {
  try {
    const value = fn()
    return value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

async function attemptAsync(fn, fallback) {
  try {
    const value = await fn()
    return value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

function text(value, limit) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > limit ? trimmed.slice(0, limit) + '…' : trimmed
}

function shortId(value) {
  const bare = String(value ?? '').replace(/^session-/, '')
  return bare.length > 10 ? bare.slice(0, 10) : bare
}

function baseName(path) {
  if (typeof path !== 'string' || path.length === 0) return ''
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

function projectGoal(view) {
  if (!view || typeof view !== 'object') return null
  return {
    id: String(view.id ?? ''),
    revision: Number(view.revision) || 0,
    objective: text(view.objective, 400),
    phase: String(view.phase ?? 'active'),
    roundsStarted: Number(view.roundsStarted) || 0,
    maxGoalRounds: Number(view.maxGoalRounds) || 0,
    activation: String(view.activation ?? 'disarmed'),
    blockedCode: view.blockedReason ? String(view.blockedReason.code ?? '') : '',
    blockedMessage: view.blockedReason ? text(view.blockedReason.message, 240) : '',
    updatedAt: Number(view.updatedAt) || 0,
  }
}

function projectJob(job) {
  if (!job || typeof job !== 'object') return null
  const id = String(job.id ?? '')
  if (id.length === 0) return null
  return {
    id,
    label: text(job.label, 160) || '未命名作业',
    kind: String(job.kind ?? ''),
    status: String(job.status ?? 'unknown'),
    progress: text(job.progress, 200),
    detail: text(job.detail, 200),
    startedAt: Number(job.startedAt) || 0,
    finishedAt: Number(job.finishedAt) || 0,
    outputBytes: Number(job.output && job.output.total) || 0,
  }
}

/**
 * 一个「航班」= 一个仍然活着的 agent。goal / 后台作业都挂在它下面。
 * 子代理也是独立会话，单独成行并标注 parent，方便看出是谁派出去的。
 */
function collectFlights(ctx, now) {
  const agentsSvc = service(ctx, 'agents')
  const goalsSvc = service(ctx, 'goals')
  const jobsSvc = service(ctx, 'jobs')
  const sessionsSvc = service(ctx, 'sessions')

  const live = attempt(() => (typeof agentsSvc?.list === 'function' ? agentsSvc.list() : []), []) || []
  const flights = []

  for (const agent of live) {
    const sessionId = String(agent?.id ?? '')
    if (sessionId.length === 0) continue

    const session = attempt(() => sessionsSvc?.get?.(agent.id), null) || null
    const header = (session && session.header) || attempt(() => agent?.session?.header, null) || null
    const boundary = session
      ? attempt(() => (typeof agentsSvc?.turnBoundaryOf === 'function' ? agentsSvc.turnBoundaryOf(session) : null), null)
      : null

    const goal = projectGoal(attempt(() => (typeof goalsSvc?.get === 'function' ? goalsSvc.get(agent) : null), null))

    const rawJobs = attempt(() => (typeof jobsSvc?.list === 'function' ? jobsSvc.list(agent.id) : []), []) || []
    const jobs = rawJobs
      .map(projectJob)
      .filter(Boolean)
      // 只保留活得下去的作业：正在跑的，或十分钟内刚结束的（失败要能看见）。
      .filter((job) => {
        if (job.status === 'running' || job.status === 'stopping') return true
        if (job.status === 'failed') return now - (job.finishedAt || job.startedAt) < 10 * 60 * 1000
        return false
      })
      .sort((a, b) => {
        const rank = (job) => (job.status === 'running' ? 0 : job.status === 'stopping' ? 1 : 2)
        return rank(a) - rank(b) || a.startedAt - b.startedAt
      })

    const cwd = header && typeof header.cwd === 'string' ? header.cwd : ''
    const running = Boolean(boundary && boundary.openTurnStartSeq !== null && boundary.openTurnStartSeq !== undefined)

    flights.push({
      sessionId,
      short: shortId(sessionId),
      cwd,
      cwdName: baseName(cwd) || '未命名工作区',
      agentPreset: header && header.agentPreset ? String(header.agentPreset) : '',
      origin: header && header.origin === 'subagent' ? 'subagent' : 'root',
      parentSession: header && header.parentSession ? String(header.parentSession) : '',
      createdAt: header ? Number(header.createdAt) || 0 : 0,
      turn: boundary ? Number(boundary.lastTurn) || 0 : 0,
      running,
      goal,
      jobs,
    })
  }

  // 根会话在前，子代理紧随其父；同类按最近变化排序。
  flights.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === 'root' ? -1 : 1
    const aStamp = (a.goal && a.goal.updatedAt) || a.createdAt
    const bStamp = (b.goal && b.goal.updatedAt) || b.createdAt
    return bStamp - aStamp
  })

  return flights
}

/** 「需要你」只由确定性规则产生：没有模型、没有猜测、没有阈值玄学。 */
function collectAttention(flights, now) {
  const items = []
  for (const flight of flights) {
    if (flight.goal && flight.goal.phase === 'blocked') {
      items.push({
        level: 'urgent',
        code: 'goal.blocked',
        sessionId: flight.sessionId,
        label: flight.cwdName,
        title: flight.goal.blockedMessage || '目标受阻，需要人判断',
        detail: flight.goal.objective,
        at: flight.goal.updatedAt || now,
      })
    }
    if (flight.goal && flight.goal.phase === 'paused') {
      items.push({
        level: 'waiting',
        code: 'goal.paused',
        sessionId: flight.sessionId,
        label: flight.cwdName,
        title: '目标已暂停，等你决定是否继续',
        detail: flight.goal.objective,
        at: flight.goal.updatedAt || now,
      })
    }
    for (const job of flight.jobs) {
      if (job.status !== 'failed') continue
      items.push({
        level: 'urgent',
        code: 'job.failed',
        sessionId: flight.sessionId,
        jobId: job.id,
        label: flight.cwdName,
        title: job.label + ' 失败',
        detail: job.detail || job.progress,
        at: job.finishedAt || job.startedAt || now,
      })
    }
  }
  items.sort((a, b) => {
    const rank = (item) => (item.level === 'urgent' ? 0 : 1)
    return rank(a) - rank(b) || b.at - a.at
  })
  return items.slice(0, 20)
}

async function collectSchedules(ctx, now) {
  const scheduleSvc = service(ctx, 'schedule')
  if (typeof scheduleSvc?.catalog !== 'function') return []
  const all = await attemptAsync(() => scheduleSvc.catalog(), [])
  if (!Array.isArray(all)) return []
  return all
    .filter((entry) => entry && entry.status !== 'ended')
    .map((entry) => ({
      id: String(entry.id ?? ''),
      title: text(entry.title, 160),
      status: String(entry.status ?? 'active'),
      kind: String(entry.kind ?? ''),
      scheduledAt: String(entry.scheduledAt ?? ''),
      targetKind: entry.target && entry.target.kind ? String(entry.target.kind) : 'session',
      targetSessionId: entry.target && entry.target.sessionId ? String(entry.target.sessionId) : '',
      lastDeliveredAt: entry.lastDelivery ? String(entry.lastDelivery.deliveredAt ?? '') : '',
    }))
    .filter((entry) => entry.id.length > 0)
    .sort((a, b) => {
      const aTime = Date.parse(a.scheduledAt)
      const bTime = Date.parse(b.scheduledAt)
      return (Number.isFinite(aTime) ? aTime : now) - (Number.isFinite(bTime) ? bTime : now)
    })
    .slice(0, 24)
}

async function buildSnapshot(ctx, options) {
  const now = Date.now()
  const flights = collectFlights(ctx, now)
  const attention = collectAttention(flights, now)
  const schedules = options.lean ? [] : await collectSchedules(ctx, now)
  const counts = {
    live: flights.length,
    running: flights.filter((flight) => flight.running).length,
    goals: flights.filter((flight) => flight.goal !== null).length,
    urgent: attention.filter((item) => item.level === 'urgent').length,
    waiting: attention.filter((item) => item.level === 'waiting').length,
    jobs: flights.reduce(
      (total, flight) => total + flight.jobs.filter((job) => job.status === 'running' || job.status === 'stopping').length,
      0,
    ),
    schedules: schedules.filter((entry) => entry.status === 'active').length,
  }
  return {
    ok: true,
    at: now,
    counts,
    attention,
    flights: options.lean ? [] : flights,
    schedules,
    recent: options.lean ? [] : recentActions(),
  }
}

/**
 * 读一条后台作业的输出尾部。
 * 只读、不动游标（用 readAt 而不是 read），因此不会干扰模型自己的读取偏移。
 * 所有权由 jobs registry 用 caller sessionId 围栏，这里不做第二套鉴权。
 */
function readJobTail(ctx, jobId, sessionId, tail) {
  const jobsSvc = service(ctx, 'jobs')
  if (typeof jobsSvc?.get !== 'function' || typeof jobsSvc?.readAt !== 'function') {
    return { ok: false, error: '作业服务不可用' }
  }
  if (typeof jobId !== 'string' || jobId.length === 0) return { ok: false, error: '缺少作业 id' }
  const wanted = Number(tail)
  const size = Math.min(MAX_TAIL_BYTES, Math.max(200, Number.isFinite(wanted) && wanted > 0 ? wanted : 4000))
  const caller = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined
  try {
    const view = jobsSvc.get(jobId, caller)
    const total = Number(view && view.output && view.output.total) || 0
    const from = Math.max(0, total - size)
    const read = jobsSvc.readAt(jobId, from, caller)
    const chunks = read && Array.isArray(read.chunks) ? read.chunks : []
    let text = chunks.map((chunk) => (chunk && typeof chunk.text === 'string' ? chunk.text : '')).join('')
    if (text.length > 20000) text = text.slice(text.length - 20000)
    return {
      ok: true,
      job: {
        id: jobId,
        status: String((view && view.status) || ''),
        total,
        from,
        truncated: from > 0,
        lossy: Boolean(read && read.lossy),
      },
      text,
    }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

/**
 * 三个动作，全部要求「活的 agent」+「用户提供的精确 rev/id」。
 * 没有乐观更新、没有批量执行：一次点击一个动作，失败原样回传。
 */
async function handleAction(ctx, body) {
  const action = typeof body?.action === 'string' ? body.action : ''
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const agentsSvc = service(ctx, 'agents')
  const agent = sessionId.length > 0 ? attempt(() => agentsSvc?.get?.(sessionId), null) : null

  if (action === 'goal.pause' || action === 'goal.resume' || action === 'goal.complete') {
    const goalsSvc = service(ctx, 'goals')
    if (!agent || typeof goalsSvc?.pause !== 'function') return { ok: false, error: '目标服务不可用，或该会话已不在运行' }
    const ref = { id: String(body?.goalId ?? ''), revision: Number(body?.revision) }
    if (ref.id.length === 0 || !Number.isFinite(ref.revision)) return { ok: false, error: '目标引用无效' }
    const verb = action.slice('goal.'.length)
    if (typeof goalsSvc[verb] !== 'function') return { ok: false, error: '目标服务不支持该动作' }
    try {
      const view = goalsSvc[verb](agent, ref)
      recordAction({
        at: Date.now(),
        verb,
        sessionId,
        label: text(view && view.objective, 80),
        outcome: 'ok',
      })
      return { ok: true, result: projectGoal(view) }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  }

  if (action === 'job.kill') {
    const jobsSvc = service(ctx, 'jobs')
    const jobId = String(body?.jobId ?? '')
    if (!agent || typeof jobsSvc?.kill !== 'function' || jobId.length === 0) {
      return { ok: false, error: '后台作业不可用，或该会话已不在运行' }
    }
    try {
      const before = attempt(() => jobsSvc.get(jobId, sessionId), null)
      const outcome = jobsSvc.kill(jobId, sessionId, '用户从塔台终止')
      recordAction({
        at: Date.now(),
        verb: 'kill',
        sessionId,
        label: text(before && before.label, 80),
        outcome: String(outcome),
      })
      return { ok: true, result: { outcome: String(outcome) } }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  }

  if (action === 'schedule.run') {
    const scheduleSvc = service(ctx, 'schedule')
    const scheduleId = String(body?.scheduleId ?? '')
    if (typeof scheduleSvc?.run !== 'function' || scheduleId.length === 0) {
      return { ok: false, error: '定时任务服务不可用' }
    }
    try {
      const result = await scheduleSvc.run({ id: scheduleId })
      let label = scheduleId
      try {
        if (typeof scheduleSvc.view === 'function') {
          const view = await scheduleSvc.view({ id: scheduleId })
          if (view && typeof view.title === 'string') label = text(view.title, 80)
        }
      } catch {
        /* 取标题失败不影响动作本身，退化成 id */
      }
      recordAction({
        at: Date.now(),
        verb: 'run',
        sessionId: '',
        label,
        outcome: String(result?.code ?? 'ok'),
      })
      return { ok: true, result: { code: String(result?.code ?? 'ok') } }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  }

  return { ok: false, error: '未知动作' }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读取并解析 JSON 请求体；上限 64KiB，超限或非法一律 null。 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let total = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > 64 * 1024) {
        finish(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(null)
      }
    })
    req.on('error', () => finish(null))
  })
}

/** 动作会改状态，所以 POST 只接受本机页面：有 Origin 就必须同源。 */
function isSameOrigin(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    const originUrl = new URL(String(origin))
    const host = String(req.headers?.host || '')
    if (host.length > 0 && originUrl.host === host) return true
    return originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost'
  } catch {
    return false
  }
}

/**
 * 单一 node 风格路由同时承担 GET 与 POST。
 * 用 handler 而不是 resource：宿主的 resource 路由只服务 GET/HEAD，
 * POST 会在匹配前被 405 拦掉（真机实测），三个动作就没有入口了。
 */
async function handleRequest(ctx, req, res) {
  const method = String(req.method || 'GET').toUpperCase()

  if (method === 'GET' || method === 'HEAD') {
    try {
      const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
      const jobId = url.searchParams.get('job')
      if (url.searchParams.has('job')) {
        sendJson(
          res,
          200,
          readJobTail(ctx, jobId, url.searchParams.get('session') || '', url.searchParams.get('tail')),
        )
        return
      }
      const lean = url.searchParams.get('counts') === '1'
      sendJson(res, 200, await buildSnapshot(ctx, { lean }))
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
    }
    return
  }

  if (method === 'POST') {
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'origin-rejected' })
      return
    }
    const body = await readJsonBody(req)
    if (body === null) {
      sendJson(res, 400, { ok: false, error: 'body-invalid' })
      return
    }
    try {
      sendJson(res, 200, await handleAction(ctx, body))
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
    }
    return
  }

  res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }))
}

export function apply(ctx) {
  const route = {
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => handleRequest(ctx, req, res),
  }

  ctx.effect(() => ctx.webServer.register(route))
}

/**
 * 仅供本仓库的离线冒烟测试使用：不参与宿主装配。
 * 有了它，「快照形状」和「动作分发」可以在没有真机 boot 的情况下被断言。
 */
export const __internal = { buildSnapshot, handleAction, collectAttention, projectGoal, projectJob, handleRequest, readJobTail, recentActions }
