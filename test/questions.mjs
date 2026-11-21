/**
 * 待答队列：agent 卡在等你回答时，值守必须先报这件事。
 *
 * 数据来自会话事件流（tool/call name=ask_user_question → tool/result 同 callId 收口），
 * 不是宿主的只读接口——所以边界必须测清楚：什么算待答、什么算已答、什么该过期。
 *
 * 运行：node test/questions.mjs
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

// ---------- 1) 事件折叠 ----------
__internal.noteSessionEvent('session-a', {
  type: 'tool/call',
  data: { name: 'ask_user_question', callId: 'call-1', args: { questions: [{ question: '要发到公开仓库吗？' }] } },
})
let pending = __internal.listPendingQuestions(now)
assert(pending.length === 1 && pending[0].callId === 'call-1', 'tool/call 建立了待答项')
assert(pending[0].summary === '要发到公开仓库吗？', '从 questions[0].question 取到问题原文')

// args 是 JSON 字符串（真实事件里两种都可能）
__internal.noteSessionEvent('session-b', {
  type: 'tool/call',
  data: { name: 'ask_user_question', callId: 'call-2', args: '{"questions":[{"question":"用哪个分支？"}]}' },
})
pending = __internal.listPendingQuestions(now)
assert(pending.some((q) => q.callId === 'call-2' && q.summary === '用哪个分支？'), 'args 为 JSON 字符串也能解析')

// 别的工具不算
__internal.noteSessionEvent('session-a', { type: 'tool/call', data: { name: 'bash', callId: 'call-3' } })
assert(__internal.listPendingQuestions(now).every((q) => q.callId !== 'call-3'), '非 ask_user_question 的工具不入队')

// 回答后收口
__internal.noteSessionEvent('session-a', { type: 'tool/result', data: { callId: 'call-1' } })
pending = __internal.listPendingQuestions(now)
assert(pending.every((q) => q.callId !== 'call-1'), 'tool/result 收口对应 callId')
assert(pending.some((q) => q.callId === 'call-2'), '其它会话的待答不受影响')

// turn/end 兜底清掉本会话
__internal.noteSessionEvent('session-b', { type: 'turn/end', data: {} })
assert(__internal.listPendingQuestions(now).every((q) => q.sessionId !== 'session-b'), 'turn/end 兜底清掉本会话待答')

// 过期
__internal.noteSessionEvent('session-c', { type: 'tool/call', data: { name: 'ask_user_question', callId: 'call-9', args: { question: '过期问题' } } })
assert(__internal.listPendingQuestions(now + __internal.PENDING_QUESTION_TTL + 1000).every((q) => q.callId !== 'call-9'), '超过 TTL 自动过期')

// ---------- 2) 快照：只对在跑的会话报待答 ----------
__internal.noteSessionEvent('session-live', { type: 'tool/call', data: { name: 'ask_user_question', callId: 'call-live', args: { question: '要现在发布吗？' } } })
__internal.noteSessionEvent('session-dead', { type: 'tool/call', data: { name: 'ask_user_question', callId: 'call-dead', args: { question: '会话已经结束了' } } })

const agent = { id: 'session-live' }
const ctx = {
  get(name) {
    if (name === 'agents') {
      return {
        list: () => [agent],
        get: (id) => (id === 'session-live' ? agent : undefined),
        turnBoundaryOf: () => ({ openTurnStartSeq: null, lastStepStartSeq: 1, lastStepBoundary: null, lastTurn: 2 }),
      }
    }
    if (name === 'sessions') return { get: () => ({ header: { id: 'session-live', createdAt: now - 1000, cwd: '/tmp/projects/tower', isSeeded: false } }) }
    if (name === 'goals') return { get: () => null }
    if (name === 'jobs') return { list: () => [] }
    return null
  },
}

const snapshot = await __internal.buildSnapshot(ctx, { lean: false })
const waiting = snapshot.attention.filter((item) => item.code === 'question.waiting')
assert(waiting.length === 1, '只对仍在跑的会话报待答')
assert(waiting[0].sessionId === 'session-live', '待答路由到正确的会话')
assert(waiting[0].title.indexOf('要现在发布吗？') >= 0, '待答标题带问题原文')
assert(snapshot.attention[0].code === 'question.waiting', '待答排在待处置最前面')
assert(Array.isArray(snapshot.questions) && snapshot.questions.length >= 1, '快照暴露 questions 字段')
assert(snapshot.stream && snapshot.stream.seen > 0, '事件通道自检：记录已见事件数')
assert(typeof snapshot.stream.lastType === 'string' && snapshot.stream.lastType.length > 0, '事件通道自检：记录最后事件类型')

console.log(process.exitCode ? '\nQUESTIONS FAILED' : '\nQUESTIONS PASSED')
