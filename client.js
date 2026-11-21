/**
 * dsh-plugin-tower —— Client half（右侧栏 tab + 输入框入口）
 *
 * 形态：宿主 dsh-client-modules 把所有插件 client.js 原样拼成一个 classic script，
 * 所以这里**不能出现 import / export**，只有一次 window.__ModuleLoader__.load()。
 *
 * 契约来源（已在本机核实的两处）：
 *   - 类型登记：ctx.sidebarRightTabs.register({ id, kind, title(), priority, guide })
 *   - 正文/标题 seat：ctx.slots.inject('sidebar.right.pane.tab', ...) +
 *                    register({ name, key: <type.id> }, Component)
 *   两者都由 @deepseek-ai/dsh-client-ui-sidebar-right 声明；本插件只做消费方。
 *
 * 数据通道：同源 HTTP GET/POST /dsh-tower/api（Host 半现取现算，不落盘）。
 *   面板关掉即停止轮询：tab 的 keepMounted 为 false，入口按钮单独走 counts=1 轻量包。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-tower',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 类型 id 同时是两个 keyed seat 的 key。 */
    const ID = 'dsh-plugin-tower'
    /** tab 类型判别串：openTab(KIND) 用的就是它。 */
    const KIND = 'tower.supervision'
    const API = '/dsh-tower/api'

    const EMPTY_COUNTS = { live: 0, running: 0, goals: 0, urgent: 0, waiting: 0, jobs: 0, schedules: 0 }

    // #region i18n
    const DICT = {
      zh: {
        title: '塔台',
        'guide.desc': '全机 agent 的目标、后台作业与定时任务：谁在飞、谁在等你、由你放行',
        'entry.label': '打开塔台',
        'head.sub': '全机运行值守',
        'head.auto': '自动刷新',
        'head.refresh': '刷新',
        'strip.live': '在飞',
        'strip.running': '执行中',
        'strip.attention': '待处置',
        'strip.jobs': '后台',
        'strip.schedules': '定时',
        'section.attention': '需要你',
        'section.flights': '航班',
        'section.jobs': '后台作业',
        'section.schedules': '定时航班',
        'empty.flights.title': '塔台安静',
        'empty.flights.body': '当前没有在运行的 agent。给会话建一个目标，或直接开始对话。',
        'empty.attention': '没有需要你判断的事。',
        'empty.jobs': '没有正在跑的后台作业。',
        'empty.schedules': '没有定时任务。',
        'phase.active': '执行中',
        'phase.paused': '已暂停',
        'phase.blocked': '受阻',
        'phase.complete': '已完成',
        'flight.noGoal': '无目标 · 自由航行',
        'flight.rounds': '第 {n}/{max} 轮',
        'flight.running': '正在跑',
        'flight.idle': '等待输入',
        'flight.jobs': '{n} 个后台作业',
        'flight.subagent': '子代理',
        'act.open': '打开会话',
        'act.pause': '暂停',
        'act.resume': '继续',
        'act.complete': '完成',
        'act.kill': '终止',
        'act.runNow': '立即执行',
        'act.working': '处理中…',
        'job.running': '运行中',
        'job.stopping': '终止中',
        'job.failed': '失败',
        'job.completed': '已完成',
        'job.killed': '已终止',
        'sched.active': '已排程',
        'sched.paused': '已暂停',
        'sched.next': '{when}执行',
        'sched.target.new': '新会话',
        'sched.target.session': '投递到会话',
        'foot.note': '本机只读快照 · 动作只在你点击后生效',
        'foot.at': '更新于 {time}',
        'err.title': '取数失败',
        'err.hint': '宿主侧 /dsh-tower/api 不可达，面板会在下一轮重试。',
      },
      en: {
        title: 'Tower',
        'guide.desc': 'Goals, background jobs and schedules for every live agent: who is flying, who waits for you, and what you clear',
        'entry.label': 'Open Tower',
        'head.sub': 'Fleet watch',
        'head.auto': 'auto refresh',
        'head.refresh': 'Refresh',
        'strip.live': 'Live',
        'strip.running': 'Running',
        'strip.attention': 'For you',
        'strip.jobs': 'Jobs',
        'strip.schedules': 'Scheduled',
        'section.attention': 'Needs you',
        'section.flights': 'Flights',
        'section.jobs': 'Background jobs',
        'section.schedules': 'Schedules',
        'empty.flights.title': 'Tower is quiet',
        'empty.flights.body': 'No agent is live right now. Create a goal in a session, or start a conversation.',
        'empty.attention': 'Nothing needs your judgement.',
        'empty.jobs': 'No background job is running.',
        'empty.schedules': 'No scheduled task.',
        'phase.active': 'Active',
        'phase.paused': 'Paused',
        'phase.blocked': 'Blocked',
        'phase.complete': 'Complete',
        'flight.noGoal': 'No goal · free flight',
        'flight.rounds': 'Round {n}/{max}',
        'flight.running': 'Running',
        'flight.idle': 'Idle',
        'flight.jobs': '{n} job(s)',
        'flight.subagent': 'Subagent',
        'act.open': 'Open session',
        'act.pause': 'Pause',
        'act.resume': 'Resume',
        'act.complete': 'Complete',
        'act.kill': 'Kill',
        'act.runNow': 'Run now',
        'act.working': 'Working…',
        'job.running': 'Running',
        'job.stopping': 'Stopping',
        'job.failed': 'Failed',
        'job.completed': 'Completed',
        'job.killed': 'Killed',
        'sched.active': 'Scheduled',
        'sched.paused': 'Paused',
        'sched.next': 'runs {when}',
        'sched.target.new': 'new session',
        'sched.target.session': 'this session',
        'foot.note': 'Local read-only snapshot · actions apply only when you click',
        'foot.at': 'updated {time}',
        'err.title': 'Snapshot unavailable',
        'err.hint': 'The host route /dsh-tower/api is unreachable; the panel retries next round.',
      },
    }

    function interpolate(text, vars) {
      if (!vars) return text
      return String(text).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))
    }

    function makeT(locale) {
      const table = DICT[locale] || DICT.zh
      const fallback = DICT.zh
      return function t(key, vars) {
        const raw = key in table ? table[key] : key in fallback ? fallback[key] : key
        return interpolate(raw, vars)
      }
    }
    // #endregion

    // #region services
    /** 未 inject 的服务属性访问会抛；统一走 ctx.get。 */
    function getService(ctx, name) {
      try {
        if (typeof ctx.get === 'function') return ctx.get(name) ?? null
        return ctx[name] ?? null
      } catch {
        return null
      }
    }

    function detectLocale(ctx) {
      const locale = getService(ctx, 'locale')
      let id = ''
      try {
        const snapshot = typeof locale?.getLocale === 'function' ? locale.getLocale() : null
        if (typeof snapshot === 'string') id = snapshot
        else if (snapshot) id = String(snapshot.id || snapshot.locale || snapshot.language || '')
      } catch {
        id = ''
      }
      if (id.length === 0) {
        try {
          id = window.navigator.language || ''
        } catch {
          id = ''
        }
      }
      return /^en/i.test(id) ? 'en' : 'zh'
    }
    // #endregion

    // #region format
    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    function formatClock(ms) {
      const date = new Date(ms)
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
    }

    function formatElapsed(from, to) {
      const seconds = Math.max(0, Math.round((to - from) / 1000))
      if (seconds < 60) return seconds + 's'
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return minutes + 'm' + (seconds % 60 ? pad2(seconds % 60) + 's' : '')
      const hours = Math.floor(minutes / 60)
      return hours + 'h' + (minutes % 60 ? pad2(minutes % 60) + 'm' : '')
    }

    function formatAhead(iso, now, t) {
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return '—'
      if (at <= now) return t('sched.next', { when: '0s' })
      return t('sched.next', { when: formatElapsed(now, at) })
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0
      if (value < 1024) return value + 'B'
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + 'KB'
      return (value / (1024 * 1024)).toFixed(1) + 'MB'
    }
    // #endregion

    // #region palette
    const HAIRLINE = 'color-mix(in srgb, currentColor 14%, transparent)'
    const HAIRLINE_SOFT = 'color-mix(in srgb, currentColor 9%, transparent)'
    const WASH = 'color-mix(in srgb, currentColor 5%, transparent)'
    const WASH_STRONG = 'color-mix(in srgb, currentColor 9%, transparent)'
    const MUTED = 'color-mix(in srgb, currentColor 62%, transparent)'
    const FAINT = 'color-mix(in srgb, currentColor 45%, transparent)'
    const GREEN = '#22a06b'
    const AMBER = '#d98a17'
    const RED = '#dc4a3d'
    const GREY = '#8a8f98'

    function phaseColor(phase) {
      if (phase === 'active') return GREEN
      if (phase === 'paused') return AMBER
      if (phase === 'blocked') return RED
      return GREY
    }

    function jobStatusLabel(t, status) {
      const known = { running: 1, stopping: 1, failed: 1, completed: 1, killed: 1 }
      return known[status] ? t('job.' + status) : status || '—'
    }

    function jobColor(status) {
      if (status === 'running') return GREEN
      if (status === 'stopping') return AMBER
      if (status === 'failed') return RED
      if (status === 'killed') return GREY
      return MUTED
    }
    // #endregion

    // #region store
    function createStore() {
      let state = {
        ok: false,
        loading: true,
        error: '',
        at: 0,
        counts: EMPTY_COUNTS,
        attention: [],
        flights: [],
        schedules: [],
      }
      const listeners = new Set()
      let timer = null
      let inflight = false
      let fullWanters = 0

      function get() {
        return state
      }

      function emit() {
        listeners.forEach((listener) => {
          try {
            listener()
          } catch {
            /* 一个订阅者出错不影响其它订阅者 */
          }
        })
      }

      function put(patch) {
        state = Object.assign({}, state, patch)
        emit()
      }

      async function refresh() {
        if (inflight) return
        inflight = true
        const full = fullWanters > 0
        try {
          const response = await fetch(API + (full ? '' : '?counts=1'), {
            cache: 'no-store',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const data = await response.json()
          if (!data || data.ok !== true) {
            put({ ok: false, loading: false, error: String((data && data.error) || 'bad-payload') })
            return
          }
          put({
            ok: true,
            loading: false,
            error: '',
            at: Number(data.at) || Date.now(),
            counts: data.counts || EMPTY_COUNTS,
            attention: Array.isArray(data.attention) ? data.attention : [],
            flights: full && Array.isArray(data.flights) ? data.flights : full ? [] : state.flights,
            schedules: full && Array.isArray(data.schedules) ? data.schedules : full ? [] : state.schedules,
          })
        } catch (error) {
          put({ ok: false, loading: false, error: String(error && error.message ? error.message : error) })
        } finally {
          inflight = false
        }
      }

      function loop() {
        if (timer !== null) clearTimeout(timer)
        const delay = fullWanters > 0 ? 4000 : 9000
        timer = setTimeout(() => {
          if (!document.hidden) refresh()
          loop()
        }, delay)
      }

      function onVisibility() {
        if (!document.hidden) refresh()
      }

      function subscribe(listener) {
        listeners.add(listener)
        if (listeners.size === 1) {
          document.addEventListener('visibilitychange', onVisibility)
          refresh()
          loop()
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) {
            document.removeEventListener('visibilitychange', onVisibility)
            if (timer !== null) clearTimeout(timer)
            timer = null
          }
        }
      }

      function wantFull(on) {
        fullWanters += on ? 1 : -1
        if (fullWanters < 0) fullWanters = 0
      }

      return { get, subscribe, refresh, wantFull }
    }
    // #endregion

    // #region atoms
    function Glyph(props) {
      const size = props && props.size ? props.size : 14
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M7 21h10' }),
        h('path', { d: 'M10.3 21 11.3 11.2h1.4l1 9.8' }),
        h('path', { d: 'M9.1 11.2h5.8l-1-4.2h-3.8z' }),
        h('circle', { cx: 12, cy: 4.4, r: 1.5 }),
      )
    }

    function Dot(props) {
      return h('span', {
        style: {
          width: 7,
          height: 7,
          borderRadius: 999,
          background: props.color,
          boxShadow: '0 0 0 2px color-mix(in srgb, ' + props.color + ' 22%, transparent)',
          flex: '0 0 auto',
        },
      })
    }

    function Chip(props) {
      const color = props.color || MUTED
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 6px',
            borderRadius: 999,
            border: '1px solid color-mix(in srgb, ' + color + ' 40%, transparent)',
            background: 'color-mix(in srgb, ' + color + ' 12%, transparent)',
            color: color,
            fontSize: 10,
            lineHeight: '15px',
            whiteSpace: 'nowrap',
            flex: '0 0 auto',
          },
        },
        props.children,
      )
    }

    function Button(props) {
      const [hover, setHover] = React.useState(false)
      const disabled = Boolean(props.disabled)
      const danger = props.tone === 'danger'
      const primary = props.tone === 'primary'
      const color = danger ? RED : primary ? GREEN : 'currentColor'
      return h(
        'button',
        {
          type: 'button',
          disabled: disabled,
          title: props.title || undefined,
          onClick: disabled ? undefined : props.onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 22,
            padding: '0 8px',
            borderRadius: 6,
            border: '1px solid ' + (danger ? 'color-mix(in srgb, ' + RED + ' 45%, transparent)' : HAIRLINE),
            background: hover && !disabled ? WASH_STRONG : danger ? 'color-mix(in srgb, ' + RED + ' 10%, transparent)' : WASH,
            color: disabled ? FAINT : color,
            font: 'inherit',
            fontSize: 11,
            lineHeight: 1,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            whiteSpace: 'nowrap',
          },
        },
        props.children,
      )
    }

    function Section(props) {
      return h(
        'section',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px 2px' } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: FAINT,
            },
          },
          h('span', null, props.title),
          props.count ? h('span', { style: { color: MUTED } }, '· ' + props.count) : null,
          h('span', { style: { flex: 1, height: 1, background: HAIRLINE_SOFT } }),
        ),
        props.children,
      )
    }

    function Empty(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '26px 18px',
            color: FAINT,
            textAlign: 'center',
          },
        },
        h('div', { style: { color: MUTED, opacity: 0.75 } }, h(Glyph, { size: 26 })),
        h('div', { style: { fontSize: 12, color: MUTED } }, props.title),
        props.body ? h('div', { style: { fontSize: 11, lineHeight: 1.55, maxWidth: 240 } }, props.body) : null,
      )
    }
    // #endregion

    // #region panel
    function makePanel(ctx, t, store) {
      function useSnapshot() {
        const [snapshot, setSnapshot] = React.useState(store.get())
        React.useEffect(() => {
          store.wantFull(true)
          const unsubscribe = store.subscribe(() => setSnapshot(store.get()))
          return () => {
            unsubscribe()
            store.wantFull(false)
          }
        }, [])
        return snapshot
      }

      function useAction() {
        const [pending, setPending] = React.useState('')
        const [error, setError] = React.useState('')
        const run = React.useCallback(
          async (key, payload) => {
            setPending(key)
            setError('')
            try {
              const response = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              })
              const data = await response.json().catch(() => null)
              if (!data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status)
              await store.refresh()
            } catch (actionError) {
              setError(String(actionError && actionError.message ? actionError.message : actionError))
            } finally {
              setPending('')
            }
          },
          [],
        )
        return { pending, error, run, clear: () => setError('') }
      }

      function openSession(sessionId) {
        const uiWorkspace = getService(ctx, 'uiWorkspace')
        if (typeof uiWorkspace?.openSession !== 'function') return
        // 已核实形态：openSession(target: string | SubagentAddress)，见 dsh-better-sidebar 调用点
        try {
          uiWorkspace.openSession(sessionId)
          return
        } catch {
          /* 兼容按对象寻址的形态 */
        }
        try {
          uiWorkspace.openSession({ kind: 'id', id: sessionId })
        } catch {
          /* 打不开会话不影响面板 */
        }
      }

      function GoalBody(props) {
        const goal = props.goal
        const now = props.now
        const color = phaseColor(goal.phase)
        const max = goal.maxGoalRounds || 0
        const rounds = goal.roundsStarted || 0
        const ratio = max > 0 ? Math.min(1, rounds / max) : 0
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
          h(
            'div',
            {
              style: {
                fontSize: 12,
                lineHeight: 1.5,
                color: 'inherit',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              },
            },
            goal.objective,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: MUTED } },
            h('span', null, t('flight.rounds', { n: rounds, max: max > 0 ? max : '∞' })),
            goal.updatedAt ? h('span', { style: { color: FAINT } }, '· ' + formatElapsed(goal.updatedAt, now) + '前') : null,
          ),
          max > 0
            ? h(
                'div',
                { style: { height: 3, borderRadius: 999, background: WASH_STRONG, overflow: 'hidden' } },
                h('div', { style: { width: Math.max(3, ratio * 100) + '%', height: '100%', background: color } }),
              )
            : null,
          goal.phase === 'blocked' && goal.blockedMessage
            ? h(
                'div',
                {
                  style: {
                    fontSize: 11,
                    lineHeight: 1.5,
                    padding: '5px 7px',
                    borderRadius: 6,
                    color: RED,
                    background: 'color-mix(in srgb, ' + RED + ' 10%, transparent)',
                    border: '1px solid color-mix(in srgb, ' + RED + ' 26%, transparent)',
                  },
                },
                goal.blockedMessage,
              )
            : null,
        )
      }

      function FlightCard(props) {
        const flight = props.flight
        const action = props.action
        const now = props.now
        const goal = flight.goal
        const liveJobs = flight.jobs.filter((job) => job.status === 'running' || job.status === 'stopping')
        const failedJobs = flight.jobs.filter((job) => job.status === 'failed')
        const goalKey = 'goal:' + flight.sessionId
        const busy = action.pending.indexOf(goalKey) === 0
        return h(
          'article',
          {
            style: {
              border: '1px solid ' + HAIRLINE,
              borderRadius: 8,
              background: WASH,
              padding: '8px 9px',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              minWidth: 0,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
            h(Dot, { color: flight.running ? GREEN : goal ? phaseColor(goal.phase) : GREY }),
            h(
              'span',
              {
                style: {
                  fontWeight: 600,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                },
              },
              flight.cwdName,
            ),
            flight.origin === 'subagent' ? h(Chip, { color: GREY }, t('flight.subagent')) : null,
            h('span', { style: { flex: 1 } }),
            h(
              'span',
              { style: { fontSize: 10, color: FAINT, fontVariantNumeric: 'tabular-nums' } },
              flight.short,
            ),
          ),
          goal
            ? h(GoalBody, { goal, now })
            : h('div', { style: { fontSize: 11, color: FAINT } }, t('flight.noGoal')),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 10, color: MUTED } },
            flight.running
              ? h(Chip, { color: GREEN }, t('flight.running'))
              : goal && goal.phase !== 'complete'
                ? h(Chip, { color: phaseColor(goal.phase) }, t('phase.' + goal.phase))
                : null,
            liveJobs.length > 0 ? h('span', null, t('flight.jobs', { n: liveJobs.length })) : null,
            failedJobs.length > 0
              ? h('span', { style: { color: RED } }, failedJobs.length + ' 失败')
              : null,
            flight.running && flight.turn > 0 ? h('span', null, '· #' + flight.turn) : null,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
            h(Button, { onClick: () => openSession(flight.sessionId) }, t('act.open')),
            goal && goal.phase === 'active' && goal.activation === 'armed'
              ? h(
                  Button,
                  {
                    disabled: busy,
                    onClick: () =>
                      action.run(goalKey + ':pause', {
                        action: 'goal.pause',
                        sessionId: flight.sessionId,
                        goalId: goal.id,
                        revision: goal.revision,
                      }),
                  },
                  busy ? t('act.working') : t('act.pause'),
                )
              : null,
            goal && (goal.phase === 'paused' || (goal.phase === 'active' && goal.activation !== 'armed'))
              ? h(
                  Button,
                  {
                    disabled: busy,
                    onClick: () =>
                      action.run(goalKey + ':resume', {
                        action: 'goal.resume',
                        sessionId: flight.sessionId,
                        goalId: goal.id,
                        revision: goal.revision,
                      }),
                  },
                  busy ? t('act.working') : t('act.resume'),
                )
              : null,
            goal && goal.phase !== 'complete'
              ? h(
                  Button,
                  {
                    tone: 'primary',
                    disabled: busy,
                    onClick: () =>
                      action.run(goalKey + ':complete', {
                        action: 'goal.complete',
                        sessionId: flight.sessionId,
                        goalId: goal.id,
                        revision: goal.revision,
                      }),
                  },
                  t('act.complete'),
                )
              : null,
          ),
        )
      }

      function AttentionItem(props) {
        const item = props.item
        const action = props.action
        const urgent = item.level === 'urgent'
        const color = urgent ? RED : AMBER
        const jobKey = 'job:' + item.jobId + ':' + item.sessionId
        return h(
          'div',
          {
            style: {
              borderLeft: '2px solid ' + color,
              background: 'color-mix(in srgb, ' + color + ' 7%, transparent)',
              borderRadius: '0 6px 6px 0',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minWidth: 0,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, minWidth: 0 } },
            h('span', { style: { color, fontWeight: 600, whiteSpace: 'nowrap' } }, item.label),
            h(
              'span',
              {
                style: {
                  color: 'inherit',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              item.title,
            ),
            h('span', { style: { flex: 1 } }),
            h('span', { style: { color: FAINT, fontSize: 10 } }, formatElapsed(item.at, props.now) + '前'),
          ),
          item.detail
            ? h(
                'div',
                {
                  style: {
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: MUTED,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  },
                },
                item.detail,
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', gap: 5 } },
            item.code === 'job.failed' ? h(Chip, { color: RED }, t('job.failed')) : null,
            item.code === 'goal.paused'
              ? h(
                  Button,
                  {
                    onClick: () =>
                      action.run('attn:' + item.sessionId, {
                        action: 'goal.resume',
                        sessionId: item.sessionId,
                        goalId: props.goalId,
                        revision: props.goalRevision,
                      }),
                  },
                  t('act.resume'),
                )
              : null,
            h(Button, { onClick: () => openSession(item.sessionId) }, t('act.open')),
            item.code === 'job.failed' && item.jobId
              ? h(
                  Button,
                  {
                    tone: 'danger',
                    disabled: action.pending === jobKey,
                    onClick: () => action.run(jobKey, { action: 'job.kill', jobId: item.jobId, sessionId: item.sessionId }),
                  },
                  t('act.kill'),
                )
              : null,
          ),
        )
      }

      return function TowerPanel() {
        const snapshot = useSnapshot()
        const action = useAction()
        const now = Date.now()
        const counts = snapshot.counts || EMPTY_COUNTS

        const jobs = []
        for (const flight of snapshot.flights) {
          for (const job of flight.jobs) {
            if (job.status === 'running' || job.status === 'stopping' || job.status === 'failed') {
              jobs.push({ job, flight })
            }
          }
        }

        const goalBySession = {}
        for (const flight of snapshot.flights) goalBySession[flight.sessionId] = flight.goal

        return h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minWidth: 0,
              minHeight: 0,
              fontSize: 12,
              color: 'inherit',
            },
          },
          // 头部：身份 + 刷新
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 12px 8px',
                borderBottom: '1px solid ' + HAIRLINE_SOFT,
              },
            },
            h(Glyph, { size: 15 }),
            h('span', { style: { fontWeight: 600, fontSize: 12 } }, t('title')),
            h('span', { style: { color: FAINT, fontSize: 10 } }, t('head.sub')),
            h('span', { style: { flex: 1 } }),
            h(
              'button',
              {
                type: 'button',
                title: t('head.refresh'),
                'aria-label': t('head.refresh'),
                onClick: () => store.refresh(),
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: 20,
                  padding: '0 6px',
                  borderRadius: 5,
                  border: '1px solid ' + HAIRLINE,
                  background: 'transparent',
                  color: MUTED,
                  font: 'inherit',
                  fontSize: 10,
                  cursor: 'pointer',
                },
              },
              snapshot.loading ? '…' : '↻',
            ),
          ),
          // 计数条
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'stretch',
                borderBottom: '1px solid ' + HAIRLINE_SOFT,
                background: WASH,
              },
            },
            [
              ['strip.live', counts.live, GREEN],
              ['strip.attention', counts.urgent + counts.waiting, counts.urgent > 0 ? RED : AMBER],
              ['strip.jobs', counts.jobs, GREEN],
              ['strip.schedules', counts.schedules, MUTED],
            ].map((cell, index) =>
              h(
                'div',
                {
                  key: cell[0],
                  style: {
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                    padding: '6px 2px 5px',
                    borderLeft: index === 0 ? 'none' : '1px solid ' + HAIRLINE_SOFT,
                    minWidth: 0,
                  },
                },
                h(
                  'span',
                  {
                    style: {
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      color: cell[1] > 0 ? cell[2] : MUTED,
                      fontVariantNumeric: 'tabular-nums',
                    },
                  },
                  String(cell[1]),
                ),
                h(
                  'span',
                  {
                    style: {
                      fontSize: 9,
                      color: FAINT,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                    },
                  },
                  t(cell[0]),
                ),
              ),
            ),
          ),
          // 主体
          h(
            'div',
            { style: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 } },
            action.error
              ? h(
                  'div',
                  {
                    style: {
                      margin: '8px 12px 0',
                      padding: '6px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: RED,
                      background: 'color-mix(in srgb, ' + RED + ' 10%, transparent)',
                      border: '1px solid color-mix(in srgb, ' + RED + ' 26%, transparent)',
                      display: 'flex',
                      gap: 6,
                    },
                  },
                  h('span', { style: { flex: 1 } }, action.error),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: action.clear,
                      style: {
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 11,
                      },
                    },
                    '×',
                  ),
                )
              : null,
            !snapshot.ok && snapshot.error
              ? h(
                  'div',
                  {
                    style: {
                      margin: '8px 12px 0',
                      padding: '8px',
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: AMBER,
                      background: 'color-mix(in srgb, ' + AMBER + ' 10%, transparent)',
                      border: '1px solid color-mix(in srgb, ' + AMBER + ' 28%, transparent)',
                    },
                  },
                  h('div', { style: { fontWeight: 600, marginBottom: 2 } }, t('err.title')),
                  h('div', { style: { color: MUTED } }, t('err.hint')),
                  h('div', { style: { color: FAINT, marginTop: 3 } }, snapshot.error),
                )
              : null,

            // ① 需要你
            snapshot.attention.length > 0
              ? h(
                  Section,
                  { title: t('section.attention'), count: snapshot.attention.length },
                  snapshot.attention.map((item, index) => {
                    const goal = goalBySession[item.sessionId]
                    return h(AttentionItem, {
                      key: item.code + ':' + item.sessionId + ':' + (item.jobId || index),
                      item,
                      now,
                      action,
                      goalId: goal ? goal.id : '',
                      goalRevision: goal ? goal.revision : 0,
                    })
                  }),
                )
              : null,

            // ② 航班
            h(
              Section,
              { title: t('section.flights'), count: snapshot.flights.length },
              snapshot.flights.length === 0
                ? snapshot.loading || !snapshot.at
                  ? h('div', { style: { fontSize: 11, color: FAINT, padding: '6px 0' } }, '…')
                  : h(Empty, { title: t('empty.flights.title'), body: t('empty.flights.body') })
                : snapshot.flights.map((flight) =>
                    h(FlightCard, { key: flight.sessionId, flight, now, action }),
                  ),
            ),

            // ③ 后台
            h(
              Section,
              { title: t('section.jobs'), count: jobs.length },
              jobs.length === 0
                ? h('div', { style: { fontSize: 11, color: FAINT, padding: '2px 0 4px' } }, t('empty.jobs'))
                : jobs.map((row) =>
                    h(
                      'div',
                      {
                        key: row.job.id,
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          padding: '6px 8px',
                          border: '1px solid ' + HAIRLINE_SOFT,
                          borderRadius: 6,
                          background: WASH,
                          minWidth: 0,
                        },
                      },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
                        h(Chip, { color: jobColor(row.job.status) }, jobStatusLabel(t, row.job.status)),
                        h(
                          'span',
                          {
                            style: {
                              fontSize: 11,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0,
                            },
                          },
                          row.job.label,
                        ),
                        h('span', { style: { flex: 1 } }),
                        h('span', { style: { fontSize: 10, color: FAINT } }, formatBytes(row.job.outputBytes)),
                      ),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: MUTED } },
                        h('span', { style: { color: FAINT } }, row.flight.cwdName),
                        h('span', { style: { color: FAINT } }, '·'),
                        h(
                          'span',
                          { style: { fontVariantNumeric: 'tabular-nums' } },
                          row.job.status === 'running'
                            ? formatElapsed(row.job.startedAt, now)
                            : formatElapsed(row.job.startedAt, row.job.finishedAt || now),
                        ),
                        row.job.progress
                          ? h(
                              'span',
                              {
                                style: {
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  minWidth: 0,
                                },
                              },
                              '· ' + row.job.progress,
                            )
                          : null,
                        h('span', { style: { flex: 1 } }),
                        row.job.status === 'running' || row.job.status === 'stopping'
                          ? h(
                              Button,
                              {
                                tone: 'danger',
                                disabled: action.pending === 'kill:' + row.job.id,
                                onClick: () =>
                                  action.run('kill:' + row.job.id, {
                                    action: 'job.kill',
                                    jobId: row.job.id,
                                    sessionId: row.flight.sessionId,
                                  }),
                              },
                              t('act.kill'),
                            )
                          : null,
                      ),
                      row.job.detail
                        ? h(
                            'div',
                            {
                              style: {
                                fontSize: 10,
                                color: row.job.status === 'failed' ? RED : FAINT,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                            },
                            row.job.detail,
                          )
                        : null,
                    ),
                  ),
            ),

            // ④ 定时
            h(
              Section,
              { title: t('section.schedules'), count: snapshot.schedules.length },
              snapshot.schedules.length === 0
                ? h('div', { style: { fontSize: 11, color: FAINT, padding: '2px 0 4px' } }, t('empty.schedules'))
                : snapshot.schedules.map((entry) =>
                    h(
                      'div',
                      {
                        key: entry.id,
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 8px',
                          border: '1px solid ' + HAIRLINE_SOFT,
                          borderRadius: 6,
                          background: WASH,
                          minWidth: 0,
                        },
                      },
                      h(Chip, { color: entry.status === 'active' ? GREEN : AMBER }, t('sched.' + entry.status)),
                      h(
                        'span',
                        {
                          style: {
                            fontSize: 11,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                          },
                        },
                        entry.title,
                      ),
                      h('span', { style: { flex: 1 } }),
                      h(
                        'span',
                        { style: { fontSize: 10, color: FAINT, whiteSpace: 'nowrap' } },
                        entry.status === 'active'
                          ? formatAhead(entry.scheduledAt, now, t)
                          : entry.scheduledAt
                            ? formatAhead(entry.scheduledAt, now, t)
                            : t('sched.target.session'),
                      ),
                      h(
                        Button,
                        {
                          disabled: action.pending === 'schedule:' + entry.id,
                          onClick: () =>
                            action.run('schedule:' + entry.id, { action: 'schedule.run', scheduleId: entry.id }),
                        },
                        t('act.runNow'),
                      ),
                    ),
                  ),
            ),
          ),
          // 页脚
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderTop: '1px solid ' + HAIRLINE_SOFT,
                fontSize: 9,
                color: FAINT,
              },
            },
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t('foot.note')),
            h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, snapshot.at ? formatClock(snapshot.at) : '—'),
          ),
        )
      }
    }
    // #endregion

    /** 标题 seat：chip 上的实时文案（带待处置计数）。 */
    function makeTitle(t, store) {
      return function TowerTitle() {
        const [snapshot, setSnapshot] = React.useState(store.get())
        React.useEffect(() => {
          return store.subscribe(() => setSnapshot(store.get()))
        }, [])
        const urgent = snapshot.counts.urgent || 0
        return h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
          h(Glyph, { size: 12 }),
          h('span', null, t('title')),
          urgent > 0
            ? h(
                'span',
                {
                  style: {
                    minWidth: 14,
                    height: 14,
                    padding: '0 4px',
                    borderRadius: 999,
                    background: RED,
                    color: '#fff',
                    fontSize: 9,
                    lineHeight: '14px',
                    textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  },
                },
                String(urgent),
              )
            : null,
        )
      }
    }

    /** 输入框工具栏入口：一眼可见的「塔台」入口 + 待处置角标。 */
    function makeEntry(t, store, openPanel) {
      return function TowerEntryButton() {
        const [snapshot, setSnapshot] = React.useState(store.get())
        React.useEffect(() => {
          return store.subscribe(() => setSnapshot(store.get()))
        }, [])
        const urgent = snapshot.counts.urgent || 0
        const live = snapshot.counts.live || 0
        const hint = t('entry.label') + (urgent > 0 ? ' · ' + t('section.attention') + ' ' + urgent : ' · ' + live)
        return h(
          'button',
          {
            type: 'button',
            title: hint,
            'aria-label': hint,
            onClick: openPanel,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 24,
              padding: '0 7px',
              borderRadius: 7,
              border: '1px solid ' + (urgent > 0 ? 'color-mix(in srgb, ' + RED + ' 45%, transparent)' : HAIRLINE),
              background: urgent > 0 ? 'color-mix(in srgb, ' + RED + ' 10%, transparent)' : 'transparent',
              color: urgent > 0 ? RED : 'inherit',
              font: 'inherit',
              fontSize: 11,
              lineHeight: 1,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            },
          },
          h(Glyph, { size: 13 }),
          urgent > 0
            ? h(
                'span',
                { style: { fontVariantNumeric: 'tabular-nums', fontSize: 10, fontWeight: 600 } },
                String(urgent),
              )
            : null,
        )
      }
    }

    /** 打开右侧栏并选中本 tab：先登记类型，再按地址选 tab，两步都容错。 */
    function makeOpener(ctx) {
      return function openPanel() {
        const layout = getService(ctx, 'layout')
        const right = getService(ctx, 'sidebarRight')
        try {
          if (typeof layout?.openRightbar === 'function') layout.openRightbar(true, false)
        } catch {
          /* 右栏已开或宿主拒绝：继续尝试选 tab */
        }
        const opened = () => {
          try {
            const tabs = right?.openTabs?.getSnapshot?.()
            if (!Array.isArray(tabs)) return false
            return tabs.some((row) => row && row.kind === KIND)
          } catch {
            return false
          }
        }
        try {
          if (typeof right?.openTab === 'function') right.openTab(KIND)
        } catch {
          /* 下面还有带 params 的兼容形态 */
        }
        if (!opened()) {
          try {
            if (typeof right?.openTab === 'function') right.openTab(KIND, { params: {} })
          } catch {
            /* 宿主没有右栏：入口点击静默失败，面板不会出现 */
          }
        }
      }
    }

    async function apply(ctx) {
      const tabs = ctx.sidebarRightTabs
      if (!tabs || typeof tabs.register !== 'function') return

      const t = makeT(detectLocale(ctx))
      const store = createStore()
      const openPanel = makeOpener(ctx)

      const definition = {
        id: ID,
        kind: KIND,
        title: () => t('title'),
        priority: 'extension',
        // 面板关掉就卸载：轮询随订阅自然停止，不留后台定时器
        keepMounted: false,
        guide: [
          {
            id: 'tower.open',
            order: 30,
            title: () => t('title'),
            description: () => t('guide.desc'),
          },
        ],
      }

      let disposeTab = null
      try {
        disposeTab = tabs.register(definition)
      } catch (error) {
        console.warn('[tower] 右栏 tab 登记失败，面板不出现（宿主其它功能不受影响）:', error)
        return
      }

      const slots = getService(ctx, 'slots')
      let disposeBody = null
      let disposeTitle = null
      let disposeEntry = null
      if (typeof slots?.inject === 'function' && typeof slots.register === 'function') {
        try {
          disposeBody = slots.inject('sidebar.right.pane.tab', () =>
            slots.register({ name: 'sidebar.right.pane.tab', key: ID }, makePanel(ctx, t, store)),
          )
          disposeTitle = slots.inject('sidebar.right.pane.tab.title', () =>
            slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, makeTitle(t, store)),
          )
        } catch (error) {
          console.warn('[tower] 面板正文挂载失败（只剩 tab 标题）:', error)
        }
        try {
          disposeEntry = slots.inject('conversation.input.right', () =>
            slots.register(
              { name: 'conversation.input.right', id: 'dsh-tower-entry', order: 40 },
              makeEntry(t, store, openPanel),
            ),
          )
        } catch (error) {
          console.warn('[tower] 输入框入口挂载失败（仍可从右栏 tab 打开）:', error)
        }
      }

      const cleanup = () => {
        for (const dispose of [disposeEntry, disposeTitle, disposeBody, disposeTab]) {
          try {
            dispose?.()
          } catch {
            /* 卸载阶段的异常不冒泡 */
          }
        }
      }
      if (typeof ctx.effect === 'function') ctx.effect(() => cleanup)
      else ctx.on('dispose', cleanup)
    }

    return {
      inject: ['sidebarRightTabs'],
      apply,
    }
  },
})
