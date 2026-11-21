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

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const API_PREFIX = '/dsh-tower/api'

/** 从安装目录的 manifest 读版本：诊断信息必须和实际装的那份一致，不能硬编码。 */
const PLUGIN_VERSION = (() => {
  try {
    return String(createRequire(import.meta.url)('./package.json').version || '0.0.0')
  } catch {
    return '0.0.0'
  }
})()

/** 日志尾部的硬上限：一次最多取 8KB，返回文本再截 20k 字符（双保险）。 */
const MAX_TAIL_BYTES = 8000

/**
 * 本次运行内的处置记录。只记「人点过且成功」的动作，不推测、不补记。
 * 内存 ring：重启即清空——所以 UI 上必须写「本次运行内」，不能伪装成审计日志。
 * 它是 L4 审计层的第一步：事件源已经存在，后续只需落盘 + 哈希链。
 */
/** 已收场会话：一次最多扫描 8 个、缓存按持久化 revision 失效。 */
const CLOSED_LIMIT = 8
const closedCache = new Map()

/** 作业历史：默认最近 24h、最多 20 条，扫描最多 12 个会话；按持久化 revision 缓存。 */
const HISTORY_LIMIT = 20
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000
const HISTORY_SCAN_SESSIONS = 12

/** 「有目标在跑、但这么久没有事件」→ 视为可能空转。20 分钟是保守值。 */
const IDLE_MS = 20 * 60 * 1000
const historyCache = new Map()

const ACTION_HISTORY_LIMIT = 30
const actionHistory = []

function recordAction(entry) {
  actionHistory.push(entry)
  appendAudit(entry)
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

/**
 * 从一条会话事件流里复算「最后一个目标」。
 *
 * 事件契约来自 @deepseek-ai/dsh-goal 的构建产物（已读源码核实）：
 *   - `goal/change`：{ kind:'goal/change', version:1, operation, goal, roundsStarted, createdAt, updatedAt }
 *     其中 operation ∈ create|edit|pause|resume|complete|block，clear 时是 { cleared, clearedAt }
 *   - `user/message` 且 `data.source.kind === 'goal'`：轮次推进（source.round）
 *
 * 这里只做「按序取最后一次」的宽松折叠，不重放宿主的严格校验：
 * 持久化日志由宿主自己写入，合法日志在两种折叠下结果一致；非法日志我们宁可不显示也不猜。
 */
function readGoalFromEvents(events) {
  let goal = null
  let roundsStarted = 0
  let updatedAt = 0
  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'goal/change') {
      const data = event.data || {}
      if (data.operation === 'clear') {
        goal = null
        roundsStarted = 0
        updatedAt = Number(data.clearedAt) || updatedAt
        continue
      }
      if (!data.goal || typeof data.goal !== 'object') continue
      goal = {
        id: String(data.goal.id || ''),
        revision: Number(data.goal.revision) || 0,
        objective: text(data.goal.objective, 200),
        phase: String(data.goal.phase || 'active'),
        maxGoalRounds: Number(data.goal.maxGoalRounds) || 0,
        blockedMessage: data.goal.blockedReason ? text(data.goal.blockedReason.message, 200) : '',
      }
      roundsStarted = Number(data.roundsStarted) || 0
      updatedAt = Number(data.updatedAt) || updatedAt
      continue
    }
    if (event.type === 'user/message' && event.data && event.data.source && event.data.source.kind === 'goal') {
      const round = Number(event.data.source.round) || 0
      if (round > roundsStarted) roundsStarted = round
      updatedAt = Number(event.time) || updatedAt
    }
  }
  if (goal === null) return null
  return Object.assign({}, goal, { roundsStarted, updatedAt })
}

/**
 * 已关闭会话的最后目标。只读打开持久化日志，不写、不激活、不 resume。
 * 只在面板展开「已收场」时按需调用，因此 4s 轮询完全不碰磁盘。
 */
async function collectClosedGoals(ctx, limit) {
  const persistence = service(ctx, 'sessionPersistence')
  if (
    !persistence ||
    typeof persistence.list !== 'function' ||
    typeof persistence.open !== 'function'
  ) {
    return { ok: false, error: '会话持久化服务不可用' }
  }
  const agentsSvc = service(ctx, 'agents')
  const liveIds = new Set(
    (attempt(() => (typeof agentsSvc?.list === 'function' ? agentsSvc.list() : []), []) || []).map((agent) =>
      String(agent && agent.id ? agent.id : ''),
    ),
  )
  const snaps = await persistence.list()
  if (!Array.isArray(snaps)) return { ok: false, error: '会话列表不可用' }
  const want = Math.max(1, Math.min(CLOSED_LIMIT, Number(limit) || CLOSED_LIMIT))
  const candidates = snaps
    .filter((snap) => snap && snap.header && !liveIds.has(String(snap.header.id)))
    .sort((a, b) => (Number(b.header.createdAt) || 0) - (Number(a.header.createdAt) || 0))
    .slice(0, want)

  const rows = []
  for (const snap of candidates) {
    const id = String(snap.header.id)
    const revision = String(snap.revision)
    const cached = closedCache.get(id)
    if (cached && cached.revision === revision) {
      if (cached.row && cached.row.goal) rows.push(cached.row)
      continue
    }
    let row = null
    try {
      const handle = await persistence.open(snap.header.id, 'read')
      try {
        const read = await handle.read()
        const events = read && Array.isArray(read.events) ? read.events : []
        row = {
          sessionId: id,
          cwdName: baseName(snap.header.cwd) || '未命名工作区',
          createdAt: Number(snap.header.createdAt) || 0,
          eventCount: events.length,
          goal: readGoalFromEvents(events),
        }
      } finally {
        if (handle && typeof handle.close === 'function') await handle.close()
      }
    } catch (error) {
      row = {
        sessionId: id,
        cwdName: baseName(snap.header.cwd) || '未命名工作区',
        createdAt: Number(snap.header.createdAt) || 0,
        eventCount: 0,
        goal: null,
        error: String(error && error.message ? error.message : error),
      }
    }
    if (closedCache.size > 200) closedCache.clear()
    closedCache.set(id, { revision, row })
    // 读失败也返回：否则「读不出来」会被伪装成「没有目标」
    if (row && (row.goal || row.error)) rows.push(row)
  }
  return { ok: true, closed: rows, scanned: candidates.length }
}

/**
 * 从会话事件流里重建作业记录：job/registered 建立，job/settled 收口，按 jobId 配对。
 *
 * 事件形状来自真实持久化日志的抽样（docs/verification.md §7.11）：
 *   job/registered { jobId, owner, kind, label, startedAt, toolCall }
 *   job/settled    { …同上…, finishedAt, status:'completed'|'killed'|'failed', cause, detail }
 */
function readJobsFromEvents(events) {
  const byId = new Map()
  for (const event of events) {
    if (!event || (event.type !== 'job/registered' && event.type !== 'job/settled')) continue
    const data = event.data || {}
    const jobId = String(data.jobId || '')
    if (jobId.length === 0) continue
    const prev = byId.get(jobId) || {}
    const settled = event.type === 'job/settled'
    byId.set(
      jobId,
      Object.assign({}, prev, {
        jobId,
        label: text(data.label, 120) || prev.label || '',
        kind: String(data.kind || prev.kind || ''),
        owner: String(data.owner || prev.owner || ''),
        startedAt: Number(data.startedAt) || prev.startedAt || 0,
        finishedAt: settled ? Number(data.finishedAt) || Number(event.time) || 0 : prev.finishedAt || 0,
        status: settled ? String(data.status || 'completed') : prev.status || 'running',
        cause: settled ? String(data.cause || '') : prev.cause || '',
        detail: settled ? text(data.detail, 160) : prev.detail || '',
      }),
    )
  }
  return Array.from(byId.values())
}

/** 读取并缓存一个存量会话里「已收口」的作业记录。 */
async function scanSessionJobs(persistence, snap) {
  const id = String(snap.header.id)
  const revision = String(snap.revision)
  const cached = historyCache.get(id)
  if (cached && cached.revision === revision) return cached.jobs
  const handle = await persistence.open(snap.header.id, 'read')
  try {
    const read = await handle.read()
    const events = read && Array.isArray(read.events) ? read.events : []
    const jobs = readJobsFromEvents(events)
      .filter((job) => job.status !== 'running')
      .map((job) =>
        Object.assign({}, job, {
          sessionId: id,
          cwdName: baseName(snap.header.cwd) || '未命名工作区',
          durationMs: job.finishedAt && job.startedAt ? Math.max(0, job.finishedAt - job.startedAt) : 0,
        }),
      )
    if (historyCache.size > 200) historyCache.clear()
    historyCache.set(id, { revision, jobs })
    return jobs
  } finally {
    if (handle && typeof handle.close === 'function') await handle.close()
  }
}

/** 跨会话的作业历史：最近 window 内已收口的作业，按结束时间倒序。 */
async function collectJobHistory(ctx, limit, windowMs) {
  const persistence = service(ctx, 'sessionPersistence')
  if (!persistence || typeof persistence.list !== 'function' || typeof persistence.open !== 'function') {
    return { ok: false, error: '会话持久化服务不可用' }
  }
  const snaps = await persistence.list()
  if (!Array.isArray(snaps)) return { ok: false, error: '会话列表不可用' }
  const policy = readPolicy()
  const want = Math.max(1, Math.min(HISTORY_LIMIT, Number(limit) || policy.historyLimit))
  const span = Number(windowMs) > 0 ? Number(windowMs) : policy.historyHours * 3600000
  const since = Date.now() - span
  const candidates = [...snaps]
    .sort((a, b) => (Number(b.header.createdAt) || 0) - (Number(a.header.createdAt) || 0))
    .slice(0, HISTORY_SCAN_SESSIONS)
  const rows = []
  const failed = []
  for (const snap of candidates) {
    try {
      const jobs = await scanSessionJobs(persistence, snap)
      for (const job of jobs) {
        if (job.finishedAt >= since) rows.push(job)
      }
    } catch (error) {
      failed.push(String(snap.header.id) + ': ' + String(error && error.message ? error.message : error))
    }
  }
  rows.sort((a, b) => b.finishedAt - a.finishedAt)
  return {
    ok: true,
    jobs: rows.slice(0, want),
    total: rows.length,
    scanned: candidates.length,
    windowMs: span,
    failed: failed.slice(0, 3),
  }
}

/**
 * 账本成本（可选集成）。
 *
 * 隔离契约：
 *   - **只读** `~/.dsh/ledger/*.json`，不 import 账本、不加依赖、不要求任何服务；
 *   - 目录不存在 / 版本不符 / 解析失败 → 视为「没有这个能力」，成本节整段不出现；
 *   - 双模：快照带 `window` 就用窗口口径，否则用累计口径，**并把口径写进报告**。
 */
const LEDGER_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh-desktop'), '.dsh', 'ledger')
const LEDGER_MAX_FILES = 40
const LEDGER_STALE_MS = 10 * 60 * 1000

function readLedgerCosts(windowMs, now) {
  let entries = []
  try {
    entries = readdirSync(LEDGER_DIR).filter((name) => name.endsWith('.json'))
  } catch {
    return { available: false, reason: 'no-dir' }
  }
  if (entries.length === 0) return { available: false, reason: 'empty' }

  const files = []
  for (const name of entries.slice(0, LEDGER_MAX_FILES)) {
    const path = join(LEDGER_DIR, name)
    let stat = null
    let parsed = null
    try {
      stat = statSync(path)
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    if (!parsed || parsed.version !== 1) continue
    const totals = parsed.totals || {}
    const cost = totals.cost || {}
    if (typeof cost.amount !== 'number' || typeof cost.currency !== 'string') continue
    const lastAt = Date.parse(parsed.generatedAt || '')
    const lastAtMs = Number.isFinite(lastAt) ? lastAt : Number(stat.mtimeMs) || 0
    if (lastAtMs > 0 && now - lastAtMs > windowMs) continue // 窗口内没活跃过就不计入
    const windowed = parsed.window && typeof parsed.window === 'object' && typeof parsed.window.cost === 'number'
    files.push({
      sessionId: String(parsed.sessionId || name),
      currency: cost.currency,
      amountTotal: Number(cost.amount) || 0,
      amountWindow: windowed ? Number(parsed.window.cost) : null,
      saved: Number((totals.saved && totals.saved.amount) || 0),
      entriesTotal: Number(totals.entries) || 0,
      entriesWindow: windowed ? Number(parsed.window.entries) || 0 : null,
      unknownTotal: Number(cost.unknownEntries) || 0,
      unknownWindow: windowed ? Number(parsed.window.unknownEntries) || 0 : null,
      truncated: parsed.truncated === true,
      windowed,
      lastAt: lastAtMs,
    })
  }
  if (files.length === 0) return { available: false, reason: 'unusable' }

  const currencies = new Set(files.map((file) => file.currency))
  if (currencies.size > 1) return { available: false, reason: 'multi-currency' }

  // 口径要么全是窗口、要么全是累计：混算出来的数字没有意义。
  const windowedAll = files.every((file) => file.windowed)
  let amount = 0
  let saved = 0
  let calls = 0
  let unknown = 0
  let truncated = false
  let newest = 0
  let staleFiles = 0
  for (const file of files) {
    amount += windowedAll ? Number(file.amountWindow) || 0 : file.amountTotal
    saved += file.saved
    calls += windowedAll ? Number(file.entriesWindow) || 0 : file.entriesTotal
    unknown += windowedAll ? Number(file.unknownWindow) || 0 : file.unknownTotal
    truncated = truncated || file.truncated
    newest = Math.max(newest, file.lastAt)
    if (now - file.lastAt > LEDGER_STALE_MS) staleFiles += 1
  }

  return {
    available: true,
    currency: files[0].currency,
    amount: Math.round(amount * 1e6) / 1e6,
    saved: Math.round(saved * 1e6) / 1e6,
    calls,
    unknown,
    sessions: files.length,
    truncated,
    windowed: windowedAll,
    newestAt: newest,
    stale: staleFiles > 0,
    staleAll: staleFiles === files.length,
  }
}

/** 插件自己的数据目录（策略、审计都放这里；不碰用户的代码工作区）。 */
const TOWER_DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh-desktop'), '.dsh', 'tower')

// #region 策略（L3 治理：阈值可配置）
/**
 * 策略文件：$DSH_HOME/.dsh/tower/policy.json（可选，不存在即用默认值）。
 * 改完即生效（按 mtime 失效缓存），不需要重启。
 *
 * 默认值刻意保守：自动暂停 **默认关闭**，且要求目标处于 active 且长时间无提交事件。
 * 自动动作会记入处置历史与审计（verb = auto-pause），不做静默改动。
 */
const POLICY_FILE = join(TOWER_DATA_DIR, 'policy.json')

const DEFAULT_POLICY = {
  idleMinutes: 20,
  historyHours: 24,
  historyLimit: 20,
  notifyOnlyUrgent: true,
  includeCost: true,
  autoPauseEnabled: false,
  autoPauseAfterMinutes: 45,
}

let policyCache = { mtimeMs: -1, value: DEFAULT_POLICY }

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizePolicy(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const auto = source.autoPause && typeof source.autoPause === 'object' ? source.autoPause : {}
  return {
    idleMinutes: clampNumber(source.idleMinutes, DEFAULT_POLICY.idleMinutes, 1, 1440),
    historyHours: clampNumber(source.historyHours, DEFAULT_POLICY.historyHours, 1, 168),
    historyLimit: clampNumber(source.historyLimit, DEFAULT_POLICY.historyLimit, 1, 100),
    notifyOnlyUrgent: source.notifyOnlyUrgent !== false,
    includeCost: source.includeCost !== false,
    autoPauseEnabled: auto.enabled === true,
    autoPauseAfterMinutes: clampNumber(auto.afterIdleMinutes, DEFAULT_POLICY.autoPauseAfterMinutes, 5, 1440),
  }
}

function readPolicy() {
  try {
    const stat = statSync(POLICY_FILE)
    if (stat.mtimeMs === policyCache.mtimeMs) return policyCache.value
    const value = normalizePolicy(JSON.parse(readFileSync(POLICY_FILE, 'utf8')))
    policyCache = { mtimeMs: stat.mtimeMs, value }
    return value
  } catch {
    policyCache = { mtimeMs: -1, value: DEFAULT_POLICY }
    return DEFAULT_POLICY
  }
}
// #endregion

// #region 审计（L4 起点）
/**
 * 本地审计日志：**默认关闭**。开启后把「人点过且成功」的动作追加成 JSONL，
 * 每条带前一条的 hash（sha256），形成可校验的哈希链。
 *
 * 位置：$DSH_HOME/.dsh/tower/（与插件自身状态放一起，不写用户的代码工作区）
 * 关闭时一行都不写；开启是用户的显式动作，不是默认行为。
 */
const AUDIT_DIR = TOWER_DATA_DIR
const AUDIT_STATE_FILE = join(AUDIT_DIR, 'audit.json')
const AUDIT_LOG_FILE = join(AUDIT_DIR, 'audit.jsonl')

let auditHeadCache = null

function readAuditState() {
  try {
    const parsed = JSON.parse(readFileSync(AUDIT_STATE_FILE, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : { enabled: false }
  } catch {
    return { enabled: false }
  }
}

function writeAuditState(state) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true })
    writeFileSync(AUDIT_STATE_FILE, JSON.stringify(state), { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

function auditHash(prev, record) {
  return createHash('sha256')
    .update([prev, record.seq, record.at, record.verb, record.sessionId, record.label, record.outcome].join('|'))
    .digest('hex')
}

function auditHead() {
  if (auditHeadCache !== null) return auditHeadCache
  let head = { seq: 0, hash: '' }
  try {
    const lines = readFileSync(AUDIT_LOG_FILE, 'utf8').split('\n').filter(Boolean)
    const last = lines[lines.length - 1]
    if (last) {
      const record = JSON.parse(last)
      head = { seq: Number(record.seq) || lines.length, hash: String(record.hash || '') }
    }
  } catch {
    /* 文件不存在即空链 */
  }
  auditHeadCache = head
  return head
}

/** 追加一条；未开启时什么都不做（连目录都不建）。 */
function appendAudit(entry) {
  if (!readAuditState().enabled) return
  const head = auditHead()
  const record = {
    seq: head.seq + 1,
    at: Number(entry.at) || Date.now(),
    verb: String(entry.verb || ''),
    sessionId: String(entry.sessionId || ''),
    label: String(entry.label || ''),
    outcome: String(entry.outcome || 'ok'),
    prev: head.hash,
  }
  record.hash = auditHash(record.prev, record)
  try {
    mkdirSync(AUDIT_DIR, { recursive: true })
    appendFileSync(AUDIT_LOG_FILE, JSON.stringify(record) + '\n', { mode: 0o600 })
    auditHeadCache = { seq: record.seq, hash: record.hash }
  } catch {
    /* 写不下去就保持链头不变，下一次重试 */
  }
}

function auditStatus() {
  const state = readAuditState()
  let count = 0
  let head = { seq: 0, hash: '' }
  try {
    const lines = readFileSync(AUDIT_LOG_FILE, 'utf8').split('\n').filter(Boolean)
    count = lines.length
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1])
      head = { seq: Number(last.seq) || count, hash: String(last.hash || '') }
    }
  } catch {
    /* 没有日志就是 0 条 */
  }
  return { enabled: Boolean(state.enabled), path: AUDIT_LOG_FILE, count, head }
}

function auditDownload() {
  try {
    return readFileSync(AUDIT_LOG_FILE, 'utf8')
  } catch {
    return ''
  }
}

/** 重算整条链：任何一条被改、被删、被调序都会在这里暴露。 */
function auditVerify() {
  let lines = []
  try {
    lines = readFileSync(AUDIT_LOG_FILE, 'utf8').split('\n').filter(Boolean)
  } catch {
    return { ok: true, count: 0, head: '' }
  }
  let prev = ''
  for (let index = 0; index < lines.length; index += 1) {
    let record = null
    try {
      record = JSON.parse(lines[index])
    } catch {
      return { ok: false, at: index + 1, reason: 'json' }
    }
    if (Number(record.seq) !== index + 1) return { ok: false, at: index + 1, reason: 'seq' }
    if (String(record.prev || '') !== prev) return { ok: false, at: index + 1, reason: 'prev' }
    if (auditHash(prev, record) !== record.hash) return { ok: false, at: index + 1, reason: 'hash' }
    prev = record.hash
  }
  return { ok: true, count: lines.length, head: prev }
}
// #endregion

// #region 值守报告（L3 治理：可交接的记录）
/** 报告是给人看的，不能漏出原始枚举。 */
const VERB_LABELS = { pause: '暂停', resume: '继续', complete: '完成', kill: '终止', run: '立即执行', 'auto-pause': '自动暂停' }
const JOB_LABELS = { completed: '已完成', killed: '已终止', failed: '失败', running: '运行中', stopping: '终止中' }
const PHASE_LABELS = { active: '执行中', paused: '已暂停', blocked: '受阻', complete: '已完成' }

function labelOf(table, raw) {
  const key = String(raw || '')
  return table[key] || key
}

/** 单行化：Markdown 列表项里不能出现换行。 */
function oneLine(value, limit) {
  return text(String(value || '').replace(/\s+/g, ' ').trim(), limit || 160)
}

function clockOf(ms) {
  const date = new Date(Number(ms) || Date.now())
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}

function dayOf(ms) {
  const date = new Date(Number(ms) || Date.now())
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/**
 * 把「现在 + 最近 N 小时」压成一份可交接的 Markdown。
 * 纯读：不改任何状态，不写盘（除非审计本身已开启）。缺服务时对应小节写「无」，不报错。
 */
async function buildShiftReport(ctx, hours) {
  const spanHours = Math.max(1, Math.min(168, Number(hours) || 24))
  const now = Date.now()
  const snapshot = await buildSnapshot(ctx, { lean: false })
  const history = await collectJobHistory(ctx, 20, spanHours * 3600000)
  const closed = await collectClosedGoals(ctx, 8)
  const audit = auditStatus()
  const verify = audit.enabled ? auditVerify() : null

  const lines = []
  lines.push('# 值守报告 · ' + dayOf(now) + ' ' + clockOf(now))
  lines.push('')
  const effective = readPolicy()
  lines.push('- 范围：最近 ' + spanHours + ' 小时')
  lines.push(
    '- 策略：闲置 ' + effective.idleMinutes + ' 分钟判空转 · 自动暂停' + (effective.autoPauseEnabled ? '开启（超 ' + effective.autoPauseAfterMinutes + ' 分钟）' : '关闭'),
  )
  lines.push('- 塔台版本：' + PLUGIN_VERSION)
  lines.push(
    '- 在飞 ' +
      snapshot.counts.live +
      ' · 执行中 ' +
      snapshot.counts.running +
      ' · 待处置 ' +
      (snapshot.counts.urgent + snapshot.counts.waiting) +
      ' · 后台 ' +
      snapshot.counts.jobs +
      ' · 定时 ' +
      snapshot.counts.schedules,
  )
  lines.push('')

  lines.push('## 一、待处置（需要人）')
  if (snapshot.attention.length === 0) {
    lines.push('')
    lines.push('- 无')
  } else {
    lines.push('')
    for (const item of snapshot.attention.slice(0, 10)) {
      const level = item.level === 'urgent' ? '紧急' : '等待'
      lines.push(
        '- [' + level + '] ' + oneLine(item.label, 40) + '：' + oneLine(item.title, 120) + '（' + clockOf(item.at) + '）',
      )
      if (item.detail) lines.push('  - ' + oneLine(item.detail, 160))
    }
  }
  lines.push('')

  lines.push('## 二、本次处置（人点过且成功）')
  const recent = snapshot.recent || []
  if (recent.length === 0) {
    lines.push('')
    lines.push('- 无')
  } else {
    lines.push('')
    for (const entry of recent.slice(0, 15)) {
      lines.push(
        '- ' + clockOf(entry.at) + ' ' + labelOf(VERB_LABELS, entry.verb) + ' · ' + oneLine(entry.label, 100) + '（' + oneLine(entry.outcome, 20) + '）',
      )
    }
  }
  lines.push('')

  const ledger = readLedgerCosts(spanHours * 3600000, now)
  if (ledger.available && readPolicy().includeCost !== false) {
    lines.push('## 成本（来自账本）')
    lines.push('')
    const basis = ledger.windowed
      ? '窗口内增量（账本自带 window 字段）'
      : '这些会话自开始以来的累计（账本未提供窗口增量，口径偏大）'
    const stale = ledger.stale ? (ledger.staleAll ? ' · **数据可能已过期**' : ' · **部分会话数据可能已过期**') : ''
    lines.push(
      '- 合计 ' +
        (ledger.currency === 'CNY' ? '¥' : ledger.currency + ' ') +
        ledger.amount.toFixed(4) +
        ' / ' +
        ledger.calls +
        ' 次调用 · 缓存已省 ' +
        (ledger.currency === 'CNY' ? '¥' : ledger.currency + ' ') +
        ledger.saved.toFixed(2),
    )
    lines.push('- 口径：' + basis + ' · 按本地费率估算' + (ledger.unknown > 0 ? ' · 其中 ' + ledger.unknown + ' 条费率未知' : ''))
    lines.push('- 涉及会话 ' + ledger.sessions + ' 个 · 数据时间 ' + clockOf(ledger.newestAt) + stale)
    if (ledger.truncated) lines.push('- 注意：至少一个账本快照被截断（truncated），合计可能偏低')
    lines.push('')
  }

  lines.push('## 三、后台作业（最近 ' + spanHours + ' 小时，已收口）')
  if (!history.ok || history.jobs.length === 0) {
    lines.push('')
    lines.push('- 无' + (history.ok ? '' : '（' + oneLine(history.error, 80) + '）'))
  } else {
    lines.push('')
    for (const job of history.jobs.slice(0, 15)) {
      const seconds = Math.round((job.durationMs || 0) / 1000)
      lines.push(
        '- ' + clockOf(job.finishedAt) + ' ' + labelOf(JOB_LABELS, job.status) + ' · ' + oneLine(job.label, 80) + ' · ' + seconds + 's' + (job.detail ? ' · ' + oneLine(job.detail, 60) : '') + '（' + oneLine(job.cwdName, 40) + '）',
      )
    }
    if (history.total > history.jobs.length) {
      lines.push('- ……窗口内共 ' + history.total + ' 条，仅列最近 ' + history.jobs.length + ' 条')
    }
  }
  lines.push('')

  lines.push('## 四、已收场会话（带目标的）')
  if (!closed.ok || closed.closed.length === 0) {
    lines.push('')
    lines.push('- 无' + (closed.ok ? '' : '（' + oneLine(closed.error, 80) + '）'))
  } else {
    lines.push('')
    for (const row of closed.closed) {
      const goal = row.goal || {}
      lines.push(
        '- ' + oneLine(row.cwdName, 40) + ' · ' + labelOf(PHASE_LABELS, goal.phase) + ' · ' + oneLine(goal.objective, 100) + ' · 第 ' + (goal.roundsStarted || 0) + '/' + (goal.maxGoalRounds || '∞') + ' 轮',
      )
    }
  }
  lines.push('')

  lines.push('## 五、审计')
  lines.push('')
  if (!audit.enabled) {
    lines.push('- 未开启（本地审计默认关闭）')
  } else {
    lines.push('- 记录中 · ' + audit.count + ' 条')
    lines.push('- 哈希链：' + (verify && verify.ok ? '完整（head ' + String(verify.head).slice(0, 12) + '…）' : '校验失败（第 ' + (verify && verify.at) + ' 条：' + (verify && verify.reason) + '）'))
    lines.push('- 路径：' + audit.path)
  }
  lines.push('')
  lines.push('---')
  lines.push('由塔台生成 · 本机只读快照 · 不含对话内容')

  return {
    ok: true,
    markdown: lines.join('\n'),
    generatedAt: now,
    windowHours: spanHours,
    version: PLUGIN_VERSION,
    counts: snapshot.counts,
  }
}
// #endregion

/** 某个可选服务是否具备全部所需方法（用来区分「本来就没有」和「有了但变了」）。 */
function hasMethods(ctx, name, methods) {
  const svc = service(ctx, name)
  if (!svc) return false
  return methods.every((method) => typeof svc[method] === 'function')
}

/**
 * 能力自检：面板哪些区块有数据源。
 * 缺失时面板会「静默降级成空区块」，用户很容易误判成「没有东西在跑」——
 * 所以要把这个事实显式暴露出来，也方便 G1 阶段收到的 issue 自带诊断。
 */
function collectCapabilities(ctx) {
  return {
    agents: hasMethods(ctx, 'agents', ['list']),
    goals: hasMethods(ctx, 'goals', ['get', 'pause', 'resume', 'complete']),
    jobs: hasMethods(ctx, 'jobs', ['list', 'kill']),
    log: hasMethods(ctx, 'jobs', ['get', 'readAt']),
    schedule: hasMethods(ctx, 'schedule', ['catalog']),
    sessions: hasMethods(ctx, 'sessions', ['get']),
    history: hasMethods(ctx, 'sessionPersistence', ['list', 'open']),
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

    // 最后一次提交事件的时间：由 turnBoundary 指向的 seq 反查，比 goal.updatedAt 更贴近「有没有动静」。
    let lastEventAt = 0
    if (session && boundary && boundary.lastStepBoundary && boundary.lastStepBoundary.seq !== undefined) {
      const event = attempt(() => session.eventAt(boundary.lastStepBoundary.seq), null)
      lastEventAt = Number(event && event.time) || 0
    }
    if (lastEventAt === 0 && goal) lastEventAt = goal.updatedAt || 0

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
      lastEventAt,
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

/**
 * 自动暂停：策略显式开启时才动作，且要求「目标 active + 当前没在跑 + 长时间无提交事件」。
 * 每次动作都记入处置历史与审计（verb=auto-pause），不做静默改动。
 * 在快照构建时惰性评估——因此它只在宿主被人/面板轮询时发生，不额外起定时器。
 */
function maybeAutoPause(ctx, flights, policy, now) {
  if (!policy || policy.autoPauseEnabled !== true) return 0
  const goalsSvc = service(ctx, 'goals')
  const agentsSvc = service(ctx, 'agents')
  if (typeof goalsSvc?.pause !== 'function' || typeof agentsSvc?.get !== 'function') return 0
  const limitMs = policy.autoPauseAfterMinutes * 60000
  let paused = 0
  for (const flight of flights) {
    const goal = flight.goal
    if (!goal || goal.phase !== 'active' || flight.running) continue
    if (!flight.lastEventAt || now - flight.lastEventAt < limitMs) continue
    const agent = attempt(() => agentsSvc.get(flight.sessionId), null)
    if (!agent) continue
    try {
      const view = goalsSvc.pause(agent, { id: goal.id, revision: goal.revision })
      recordAction({
        at: Date.now(),
        verb: 'auto-pause',
        sessionId: flight.sessionId,
        label: text(view && view.objective, 80),
        outcome: 'ok',
      })
      flight.goal = projectGoal(view)
      paused += 1
    } catch {
      /* 版本冲突或已不可暂停：跳过，不重试、不放大影响 */
    }
  }
  return paused
}

/** 「需要你」只由确定性规则产生：没有模型、没有猜测、没有阈值玄学。 */
function collectAttention(flights, now, policy) {
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
    if (flight.goal && flight.goal.phase === 'active' && !flight.running && flight.lastEventAt) {
      const idleMs = now - flight.lastEventAt
      const idleLimit = (policy ? policy.idleMinutes : 20) * 60000
      if (idleMs > idleLimit) {
        items.push({
          level: 'waiting',
          code: 'goal.idle',
          sessionId: flight.sessionId,
          label: flight.cwdName,
          title: '目标在推进，但已经有 ' + Math.round(idleMs / 60000) + ' 分钟没有动静',
          detail: flight.goal.objective,
          at: flight.lastEventAt,
        })
      }
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
  const policy = readPolicy()
  const flights = collectFlights(ctx, now)
  const autoPaused = maybeAutoPause(ctx, flights, policy, now)
  const attention = collectAttention(flights, now, policy)
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
    version: PLUGIN_VERSION,
    caps: collectCapabilities(ctx),
    policy,
    autoPaused,
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

  if (action === 'audit.enable' || action === 'audit.disable') {
    const enabled = action === 'audit.enable'
    const written = writeAuditState({ enabled, updatedAt: Date.now() })
    if (!written) return { ok: false, error: '无法写入审计目录（权限或路径不可用）' }
    auditHeadCache = null
    return { ok: true, result: auditStatus() }
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
      if (url.searchParams.has('report')) {
        sendJson(res, 200, await buildShiftReport(ctx, url.searchParams.get('hours')))
        return
      }
      if (url.searchParams.has('audit')) {
        if (url.searchParams.has('download')) {
          const body = auditDownload()
          res.writeHead(200, {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'content-disposition': 'attachment; filename="tower-audit.jsonl"',
            'cache-control': 'no-store',
          })
          res.end(body)
          return
        }
        if (url.searchParams.has('verify')) {
          sendJson(res, 200, { ok: true, status: auditStatus(), verify: auditVerify() })
          return
        }
        sendJson(res, 200, { ok: true, status: auditStatus() })
        return
      }
      if (url.searchParams.has('history')) {
        sendJson(res, 200, await collectJobHistory(ctx, url.searchParams.get('limit'), url.searchParams.get('window')))
        return
      }
      if (url.searchParams.has('closed')) {
        sendJson(res, 200, await collectClosedGoals(ctx, url.searchParams.get('limit')))
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
export const __internal = { buildSnapshot, handleAction, collectAttention, projectGoal, projectJob, handleRequest, readJobTail, recentActions, collectCapabilities, readGoalFromEvents, collectClosedGoals, readJobsFromEvents, collectJobHistory, IDLE_MS, auditStatus, auditVerify, appendAudit, buildShiftReport, readPolicy, normalizePolicy, maybeAutoPause, readLedgerCosts }
