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
        'strip.urgent': '待处置',
        'strip.jobs': '后台',
        'strip.schedules': '定时',
        'section.attention': '需要你',
        'section.flights': '航班',
        'section.jobs': '后台作业',
        'section.schedules': '定时航班',
        'caps.degraded': '{n} 项不可用',
        'caps.hint': '这些区块会显示为空，不是你操作错了——是宿主没有提供对应服务。',
        'caps.unavailable': '{name}不可用',
        'caps.ok': '宿主接口齐全',
        'cap.agents': 'Agent',
        'cap.goals': '目标',
        'cap.jobs': '作业',
        'cap.log': '作业日志',
        'cap.schedule': '定时',
        'cap.sessions': '会话',
        'policy.line': '策略：闲置 {idle} 分钟判空转 · 历史窗口 {hours} 小时 · 自动暂停{auto}',
        'policy.autoOn': '开（超 {n} 分钟）',
        'policy.autoOff': '关',
        'policy.path': '策略文件（可选，改完即生效，无需重启）：$DSH_HOME/.dsh/tower/policy.json',
        'section.report': '值守报告',
        'report.loading': '生成中…',
        'report.failed': '生成失败',
        'report.preview': '预览',
        'report.hidePreview': '收起预览',
        'report.copy': '复制',
        'report.download': '下载 .md',
        'report.copied': '已复制',
        'report.window': '最近 {n} 小时',
        'report.note': '把这段时间压成一页，可直接贴进周报或交接群',
        'section.audit': '审计',
        'audit.on': '记录中',
        'audit.off': '未开启',
        'audit.enable': '开始记录',
        'audit.disable': '停止记录',
        'audit.export': '导出',
        'audit.verify': '校验',
        'audit.ok': '链完整 · {n} 条',
        'audit.broken': '校验失败 · 第 {n} 条（{why}）',
        'audit.count': '{n} 条',
        'audit.note': '本地 JSONL · 默认关闭 · 每条带前一条哈希',
        'audit.failed': '读取失败',
        'section.history': '作业历史',
        'history.loading': '读取已收口作业…',
        'history.empty': '最近 24 小时没有已收口的作业',
        'history.failed': '读取失败',
        'history.note': '来自持久化日志 · 最近 24 小时 · 已扫描 {n} 个会话',
        'history.total': '共 {n} 条',
        'section.closed': '已收场',
        'closed.empty': '没有带目标的已关闭会话',
        'closed.loading': '读取已关闭会话…',
        'closed.failed': '读取失败',
        'closed.note': '只读复算持久化日志，不会唤醒会话',
        'act.reopen': '重新打开',
        'cap.history': '历史',
        'section.recent': '最近处置',
        'recent.note': '本次运行内 · 只记你点过的动作',
        'verb.pause': '暂停',
        'verb.resume': '继续',
        'verb.complete': '完成',
        'verb.kill': '终止',
        'verb.run': '立即执行',
        'density.compact': '紧凑',
        'density.comfortable': '舒适',
        'act.density': '切换信息密度',
        'empty.flights.title': '塔台安静',
        'empty.attention': '没有需要你判断的事。',
        'empty.jobs': '没有正在跑的后台作业。',
        'empty.schedules': '没有定时任务。',
        'empty.flights.copyHint': '复制这句话发给 agent',
        'empty.flights.foot': '复制后粘到输入框发送即可',
        'empty.flights.p1': '给这件事建一个目标，然后按目标继续推进；卡住时告诉我为什么',
        'empty.flights.p2': '用后台作业跑一个耗时命令（比如全量构建或测试），跑起来我要能在这里看到它',
        'empty.flights.p3': '每天上午 9 点提醒我一次这件事的进度',
        'scope.all': '全机',
        'scope.mine': '本会话',
        'chip.current': '当前',
        'act.snooze': '稍后',
        'act.snoozeHint': '30 分钟内不再提示（只存在本机）',
        'snooze.note': '已稍后 {n}',
        'job.log': '日志',
        'job.logEmpty': '（这段没有输出）',
        'job.logLeft': '仅显示最后 {n}',
        'job.logLossy': '更早的输出已被丢弃',
        'act.collapse': '收起',
        'act.expand': '展开',
        'empty.flights.hint': '点一下复制',
        'empty.flights.t1': '给这件事建一个目标',
        'empty.flights.t2': '跑一个耗时命令',
        'empty.flights.t3': '每天 9 点提醒我',
        'flights.hint.goal': '还没有目标：对 agent 说「给这件事建一个目标」，就能在这里看到轮次并随时暂停。',
        'flight.turns': '第 {n} 轮',
        'flight.age': '已运行 {when}',
        'flight.failedJobs': '{n} 个失败',
        'crash.title': '面板渲染失败',
        'crash.body': '塔台自己出错了，宿主其它功能不受影响。请把下面这行发给开发者，或先重启一次。',
        'crash.retry': '重试',
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
        'flight.noGoalChip': '无目标',
        'act.newGoal': '建目标',
        'hint.keys': '↑↓ 或 j/k 选择 · Enter 打开',
        'act.notify': '通知',
        'act.notifyOn': '通知已开',
        'notify.unsupported': '当前环境不支持系统通知',
        'notify.blocked': '通知权限被拒绝（可在浏览器站点设置里改）',
        'notify.enableTitle': '塔台已开始值守',
        'notify.enableBody': '目标受阻或作业失败时，我会在这里提醒你。',
        'notify.title': '塔台 · {what}',
        'notify.body': '{where}：{detail}',
        'hint.copied': '已复制',
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
        'strip.urgent': 'For you',
        'strip.jobs': 'Jobs',
        'strip.schedules': 'Scheduled',
        'section.attention': 'Needs you',
        'section.flights': 'Flights',
        'section.jobs': 'Background jobs',
        'section.schedules': 'Schedules',
        'caps.degraded': '{n} unavailable',
        'caps.hint': 'These sections show empty because the host does not provide the service — not because nothing is running.',
        'caps.unavailable': '{name} unavailable',
        'caps.ok': 'host services ok',
        'cap.agents': 'Agent',
        'cap.goals': 'Goals',
        'cap.jobs': 'Jobs',
        'cap.log': 'Job log',
        'cap.schedule': 'Schedules',
        'cap.sessions': 'Sessions',
        'policy.line': 'policy: idle {idle}m · history {hours}h · auto-pause {auto}',
        'policy.autoOn': 'on (after {n}m)',
        'policy.autoOff': 'off',
        'policy.path': 'policy file (optional, hot-reloaded): $DSH_HOME/.dsh/tower/policy.json',
        'section.report': 'Shift report',
        'report.loading': 'generating…',
        'report.failed': 'generation failed',
        'report.preview': 'Preview',
        'report.hidePreview': 'Hide preview',
        'report.copy': 'Copy',
        'report.download': 'Download .md',
        'report.copied': 'copied',
        'report.window': 'last {n}h',
        'report.note': 'one page you can paste into a weekly report or handoff',
        'section.audit': 'Audit',
        'audit.on': 'recording',
        'audit.off': 'off',
        'audit.enable': 'Start recording',
        'audit.disable': 'Stop recording',
        'audit.export': 'Export',
        'audit.verify': 'Verify',
        'audit.ok': 'chain intact · {n} records',
        'audit.broken': 'verification failed · record {n} ({why})',
        'audit.count': '{n} records',
        'audit.note': 'local JSONL · off by default · each record carries the previous hash',
        'audit.failed': 'read failed',
        'section.history': 'Job history',
        'history.loading': 'reading settled jobs…',
        'history.empty': 'no settled job in the last 24h',
        'history.failed': 'read failed',
        'history.note': 'from the persisted log · last 24h · {n} sessions scanned',
        'history.total': '{n} total',
        'section.closed': 'Closed',
        'closed.empty': 'no closed session had a goal',
        'closed.loading': 'reading closed sessions…',
        'closed.failed': 'read failed',
        'closed.note': 'read-only replay of the persisted log; the session is not woken',
        'act.reopen': 'Reopen',
        'cap.history': 'History',
        'section.recent': 'Recent actions',
        'recent.note': 'this run only · what you clicked',
        'verb.pause': 'Pause',
        'verb.resume': 'Resume',
        'verb.complete': 'Complete',
        'verb.kill': 'Kill',
        'verb.run': 'Run now',
        'density.compact': 'Compact',
        'density.comfortable': 'Comfortable',
        'act.density': 'Toggle density',
        'empty.flights.title': 'Tower is quiet',
        'empty.attention': 'Nothing needs your judgement.',
        'empty.jobs': 'No background job is running.',
        'empty.schedules': 'No scheduled task.',
        'empty.flights.copyHint': 'Copy this line and send it to the agent',
        'empty.flights.foot': 'Paste it into the composer and send',
        'empty.flights.p1': 'Create a goal for this task, then keep working toward it; when you are stuck, tell me why',
        'empty.flights.p2': 'Run a long command as a background job (a full build or the test suite); I want to watch it here',
        'empty.flights.p3': 'Remind me of the progress of this task every day at 9am',
        'scope.all': 'Fleet',
        'scope.mine': 'This session',
        'chip.current': 'current',
        'act.snooze': 'Later',
        'act.snoozeHint': 'Hide for 30 minutes (stored on this machine only)',
        'snooze.note': '{n} snoozed',
        'job.log': 'Log',
        'job.logEmpty': '(no output in this range)',
        'job.logLeft': 'last {n} only',
        'job.logLossy': 'earlier output dropped',
        'act.collapse': 'Collapse',
        'act.expand': 'Expand',
        'empty.flights.hint': 'tap to copy',
        'empty.flights.t1': 'create a goal',
        'empty.flights.t2': 'run a long command',
        'empty.flights.t3': 'remind me at 9am',
        'flights.hint.goal': 'No goal yet: tell the agent “create a goal for this” to see rounds here and pause anytime.',
        'flight.turns': 'turn {n}',
        'flight.age': 'up {when}',
        'flight.failedJobs': '{n} failed',
        'crash.title': 'Panel failed to render',
        'crash.body': 'Tower crashed on its own; the rest of the host is unaffected. Send the line below to the author, or restart once.',
        'crash.retry': 'Retry',
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
        'flight.noGoalChip': 'no goal',
        'act.newGoal': 'New goal',
        'hint.keys': '↑↓ or j/k to move · Enter to open',
        'act.notify': 'Notify',
        'act.notifyOn': 'Notify on',
        'notify.unsupported': 'System notifications are unavailable here',
        'notify.blocked': 'Notification permission denied (change it in site settings)',
        'notify.enableTitle': 'Tower is on watch',
        'notify.enableBody': 'I will ping you here when a goal is blocked or a job fails.',
        'notify.title': 'Tower · {what}',
        'notify.body': '{where}: {detail}',
        'hint.copied': 'copied',
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

    function flightMetaParts(flight, now, t) {
      const parts = []
      if (flight.agentPreset) parts.push(String(flight.agentPreset))
      if (flight.turn > 0) parts.push(t('flight.turns', { n: flight.turn }))
      if (flight.createdAt) parts.push(t('flight.age', { when: formatElapsed(flight.createdAt, now) }))
      return parts
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0
      if (value < 1024) return value + 'B'
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + 'KB'
      return (value / (1024 * 1024)).toFixed(1) + 'MB'
    }
    // #endregion

    // #region design tokens
    /**
     * 宿主主题令牌（已通过 Theme.listTokens 核实存在）。
     * 全部带兜底：令牌缺失时退回 currentColor 混色，面板不会变成无边框白块。
     */
    const T = {
      surface: 'var(--dsw-alias-bg-layer-1, color-mix(in srgb, currentColor 4%, transparent))',
      surface2: 'var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 7%, transparent))',
      border: 'var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 12%, transparent))',
      borderStrong: 'var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 20%, transparent))',
      text: 'var(--dsw-alias-label-primary, currentColor)',
      text2: 'var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 66%, transparent))',
      muted: 'color-mix(in srgb, currentColor 50%, transparent)',
      faint: 'color-mix(in srgb, currentColor 38%, transparent)',
      brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      ok: 'var(--dsw-alias-state-success-primary, #22a06b)',
      warn: 'var(--dsw-alias-state-warn-primary, #d98a17)',
      bad: 'var(--dsw-alias-state-error-primary, #dc4a3d)',
      idle: 'var(--dsw-alias-state-idle-primary, #8a8f98)',
      sidebar: 'var(--dsw-specific-sidebar-fill, transparent)',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }

    /** 语义色：目标阶段 / 作业状态 / 待处置级别，全部走同一套。 */
    function phaseColor(phase) {
      if (phase === 'active') return T.ok
      if (phase === 'paused') return T.warn
      if (phase === 'blocked') return T.bad
      return T.idle
    }

    function jobColor(status) {
      if (status === 'running') return T.ok
      if (status === 'stopping') return T.warn
      if (status === 'failed') return T.bad
      if (status === 'killed') return T.idle
      return T.text2
    }

    function jobStatusLabel(t, status) {
      const known = { running: 1, stopping: 1, failed: 1, completed: 1, killed: 1 }
      return known[status] ? t('job.' + status) : status || '—'
    }

    /**
     * 组件内样式。全部带 .twr- 前缀，避免污染宿主；
     * 悬停/焦点/动效只能用伪类实现，因此必须走真实的 style 标签而不是 inline style。
     */
    const CSS = `
.twr-root, .twr-root * { box-sizing: border-box; }
.twr-root:focus-visible { outline: 2px solid ${T.brand}; outline-offset: -2px; border-radius: 8px; }
.twr-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.twr-root ::-webkit-scrollbar-thumb { background: color-mix(in srgb, currentColor 18%, transparent); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
.twr-root ::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, currentColor 28%, transparent); background-clip: padding-box; }
.twr-root ::-webkit-scrollbar-track { background: transparent; }

.twr-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 22px; padding: 0 8px;
  border: 1px solid ${T.border}; border-radius: 6px; background: transparent; color: ${T.text2}; font: inherit; font-size: 11px;
  line-height: 1; cursor: pointer; white-space: nowrap; transition: background .12s ease, border-color .12s ease, color .12s ease, transform .06s ease; }
.twr-btn:hover { background: ${T.surface2}; border-color: ${T.borderStrong}; color: ${T.text}; }
.twr-btn:active { transform: scale(.97); }
.twr-btn:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 1px; }
.twr-btn[disabled] { opacity: .45; cursor: default; transform: none; }
.twr-btn--ghost { border-color: transparent; color: ${T.text2}; }
.twr-btn--ghost:hover { border-color: transparent; background: ${T.surface2}; }
.twr-btn--accent { color: ${T.ok}; border-color: color-mix(in srgb, ${T.ok} 45%, transparent); background: color-mix(in srgb, ${T.ok} 9%, transparent); }
.twr-btn--accent:hover { background: color-mix(in srgb, ${T.ok} 16%, transparent); color: ${T.ok}; border-color: color-mix(in srgb, ${T.ok} 65%, transparent); }
.twr-btn--danger { color: ${T.bad}; border-color: color-mix(in srgb, ${T.bad} 40%, transparent); }
.twr-btn--danger:hover { background: color-mix(in srgb, ${T.bad} 12%, transparent); color: ${T.bad}; border-color: color-mix(in srgb, ${T.bad} 60%, transparent); }

.twr-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 6px; background: transparent; color: ${T.muted}; cursor: pointer;
  transition: background .12s ease, color .12s ease, transform .3s ease; }
.twr-icon-btn:hover { background: ${T.surface2}; color: ${T.text}; }
.twr-icon-btn:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 1px; }
.twr-icon-btn[data-spin="1"] { transform: rotate(360deg); }

.twr-card { border: 1px solid ${T.border}; border-radius: 10px; background: ${T.surface}; padding: 9px 10px;
  display: flex; flex-direction: column; gap: 7px; min-width: 0;
  transition: border-color .12s ease, background .12s ease, box-shadow .16s ease; }
.twr-card:hover { border-color: ${T.borderStrong}; box-shadow: 0 1px 2px color-mix(in srgb, currentColor 6%, transparent); }

.twr-dot { position: relative; display: inline-block; width: 7px; height: 7px; border-radius: 999px; flex: 0 0 auto; }
.twr-dot--live { box-shadow: 0 0 0 3px color-mix(in srgb, ${T.ok} 16%, transparent); }
.twr-dot--live::after { content: ""; position: absolute; inset: -1px; border-radius: 999px; border: 1px solid currentColor;
  opacity: .6; animation: twr-pulse 2s cubic-bezier(.2,.6,.4,1) infinite; }
@keyframes twr-pulse { 0% { transform: scale(.9); opacity: .55; } 70% { transform: scale(2.2); opacity: 0; } 100% { transform: scale(2.2); opacity: 0; } }

.twr-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 999px;
  border: 1px solid; font-size: 10px; line-height: 15px; white-space: nowrap; flex: 0 0 auto; }

.twr-scope { display: inline-flex; gap: 2px; padding: 2px; border-radius: 7px; background: ${T.surface2};
  border: 1px solid ${T.border}; }
.twr-scope > button { border: 0; background: transparent; color: ${T.text2}; font: inherit; font-size: 10.5px;
  padding: 2px 8px; border-radius: 5px; cursor: pointer; transition: background .12s ease, color .12s ease; }
.twr-scope > button:hover { color: ${T.text}; }
.twr-scope > button[data-on="1"] { background: ${T.surface}; color: ${T.text}; box-shadow: 0 1px 2px color-mix(in srgb, currentColor 14%, transparent); }
.twr-scope > button:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 0; }

.twr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; align-items: start; }
.twr-mini { height: 18px; padding: 0 6px; font-size: 10px; }
.twr-root[data-density="compact"] .twr-section { padding: 7px 10px 0; gap: 5px; }
.twr-root[data-density="compact"] .twr-card { padding: 6px 8px; gap: 4px; }
.twr-root[data-density="compact"] .twr-card__meta { display: none; }
.twr-root[data-density="compact"] .twr-card__actions { gap: 4px; }
.twr-root[data-density="compact"] .twr-btn { height: 20px; }
.twr-root[data-density="compact"] .twr-grid { gap: 6px; }
.twr-card--focus { border-color: ${T.brand}; box-shadow: 0 0 0 1px ${T.brand}; }

.twr-hint { display: flex; align-items: flex-start; gap: 7px; width: 100%; text-align: left;
  border: 1px dashed ${T.border}; border-radius: 8px; background: transparent; padding: 7px 9px;
  color: ${T.text2}; font: inherit; font-size: 11px; line-height: 1.55; cursor: pointer;
  transition: border-color .12s ease, background .12s ease, color .12s ease; }
.twr-hint:hover { border-color: color-mix(in srgb, ${T.brand} 60%, transparent); background: color-mix(in srgb, ${T.brand} 6%, transparent); color: ${T.text}; }
.twr-hint:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 1px; }
.twr-hint__idx { flex: 0 0 auto; width: 14px; height: 14px; border-radius: 4px; display: inline-flex; align-items: center;
  justify-content: center; font-size: 9px; background: ${T.surface2}; color: ${T.text2}; margin-top: 1px; }

.twr-skel { height: 10px; border-radius: 4px;
  background: linear-gradient(90deg, ${T.surface} 25%, ${T.surface2} 37%, ${T.surface} 63%);
  background-size: 400% 100%; animation: twr-shimmer 1.5s ease infinite; }
@keyframes twr-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

.twr-banner { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; border-radius: 8px; font-size: 11px; line-height: 1.55; }

.twr-divider { height: 1px; background: ${T.border}; flex: 1; min-width: 8px; }
.twr-plus { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 5px; border: 1px solid ${T.border}; color: ${T.text2};
  background: transparent; cursor: pointer; font-size: 11px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
.twr-plus:hover { background: ${T.surface2}; color: ${T.text}; }

.twr-entry { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 7px; border-radius: 7px;
  border: 1px solid transparent; background: transparent; color: inherit; font: inherit; font-size: 11px; line-height: 1;
  cursor: pointer; white-space: nowrap; transition: background .12s ease, border-color .12s ease, color .12s ease; }
.twr-entry:hover { background: ${T.surface2}; border-color: ${T.border}; }
.twr-entry:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 1px; }
.twr-entry[data-urgent="1"] { color: ${T.bad}; border-color: color-mix(in srgb, ${T.bad} 45%, transparent); background: color-mix(in srgb, ${T.bad} 9%, transparent); }
.twr-entry__badge { min-width: 14px; height: 14px; padding: 0 4px; border-radius: 999px; background: ${T.bad}; color: #fff;
  font-size: 9px; line-height: 14px; text-align: center; font-variant-numeric: tabular-nums; }

.twr-log { margin: 0; padding: 7px 8px; border-radius: 6px; border: 1px solid ${T.border};
  background: color-mix(in srgb, currentColor 5%, transparent); font-family: ${T.mono}; font-size: 10px;
  line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 190px; overflow: auto; color: ${T.text2}; }
.twr-clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.twr-clamp3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.twr-num { font-variant-numeric: tabular-nums; }
.twr-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .twr-root *, .twr-entry { animation: none !important; transition: none !important; }
}
`
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

    // #region notifications
    const NOTIFY_KEY = 'dsh-tower.notify.v1'
    const NOTIFIED_KEY = 'dsh-tower.notified.v1'
    const NOTIFY_WINDOW_MS = 6 * 60 * 60 * 1000
    /** 同一 tick 内多个组件（入口/面板）同时刷新时，防止重复弹。 */
    const notifiedNow = new Set()

    function readNotifyOn() {
      try {
        return window.localStorage.getItem(NOTIFY_KEY) === 'on'
      } catch {
        return false
      }
    }

    function writeNotifyOn(on) {
      try {
        window.localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off')
      } catch {
        /* 不持久也不影响本轮 */
      }
    }

    function announceNotifyChange() {
      try {
        window.dispatchEvent(new Event('dsh-tower:notify'))
      } catch {
        /* 事件不可用就只影响跨组件同步 */
      }
    }

    function readNotified() {
      try {
        const raw = window.localStorage.getItem(NOTIFIED_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function writeNotified(map) {
      try {
        const now = Date.now()
        const pruned = {}
        for (const key of Object.keys(map)) {
          if (now - (Number(map[key]) || 0) < NOTIFY_WINDOW_MS) pruned[key] = map[key]
        }
        window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify(pruned))
      } catch {
        /* 同上 */
      }
    }

    /**
     * 哪些待处置项值得弹通知：只弹 urgent、6 小时内同一个 key 只弹一次。
     * 纯函数，便于离线断言（真机弹窗无法在无浏览器环境下验证）。
     */
    function notificationCandidates(attention, seen, now, onlyUrgent) {
      const out = []
      const urgentOnly = onlyUrgent !== false
      for (const item of attention || []) {
        if (!item) continue
        if (urgentOnly && item.level !== 'urgent') continue
        const key = [item.code, item.sessionId, item.jobId || ''].join(':')
        const at = Number(seen && seen[key]) || 0
        if (at > 0 && now - at < NOTIFY_WINDOW_MS) continue
        out.push({ key, item })
      }
      return out
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

    /** 区块小图标：航班 / 需要你 / 后台 / 定时，统一 1.6 描边。 */
    function SectionIcon(props) {
      const kind = props.kind
      const common = {
        width: 12,
        height: 12,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: '0 0 auto' },
      }
      if (kind === 'attention') {
        return h('svg', common, h('path', { d: 'M12 9v4' }), h('path', { d: 'M12 17h.01' }), h('path', { d: 'M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' }))
      }
      if (kind === 'jobs') {
        return h('svg', common, h('path', { d: 'm4 17 6-6-6-6' }), h('path', { d: 'M12 19h8' }))
      }
      if (kind === 'recent') {
        return h('svg', common, h('path', { d: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1' }), h('path', { d: 'M3.5 4.5V10h5.5' }), h('path', { d: 'M12 8v4.5l3 1.8' }))
      }
      if (kind === 'schedules') {
        return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: 'M12 7.5V12l3 2' }))
      }
      return h('svg', common, h('path', { d: 'M3 12h4l2-6 3 12 2-6h5' }))
    }

    function StatusDot(props) {
      return h('span', {
        className: 'twr-dot' + (props.live ? ' twr-dot--live' : ''),
        style: { background: props.color, color: props.color },
      })
    }

    function Chip(props) {
      const color = props.color || T.text2
      return h(
        'span',
        {
          className: 'twr-chip',
          style: {
            color,
            borderColor: 'color-mix(in srgb, ' + color + ' 42%, transparent)',
            background: 'color-mix(in srgb, ' + color + ' 10%, transparent)',
          },
        },
        props.children,
      )
    }

    function Button(props) {
      const tone = props.tone ? ' twr-btn--' + props.tone : ''
      return h(
        'button',
        {
          type: 'button',
          disabled: Boolean(props.disabled),
          title: props.title || undefined,
          onClick: props.disabled ? undefined : props.onClick,
          className: 'twr-btn' + tone,
          'aria-label': props.ariaLabel || props.title || undefined,
        },
        props.children,
      )
    }

    function IconButton(props) {
      return h(
        'button',
        {
          type: 'button',
          title: props.title || undefined,
          'aria-label': props.title || undefined,
          onClick: props.onClick,
          className: 'twr-icon-btn',
          'data-spin': props.spin ? '1' : '0',
        },
        props.children,
      )
    }

    function SectionTitle(props) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, letterSpacing: '0.02em', color: T.faint } },
        props.kind ? h(SectionIcon, { kind: props.kind }) : null,
        h('span', { style: { color: T.text2, fontWeight: 600 } }, props.title),
        props.count ? h('span', { className: 'twr-num', style: { color: T.faint } }, String(props.count)) : null,
        h('span', { className: 'twr-divider' }),
        props.trailing || null,
      )
    }

    function Section(props) {
      return h(
        'section',
        { className: 'twr-section', style: { display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 12px 0' } },
        h(SectionTitle, { title: props.title, count: props.count, kind: props.kind, trailing: props.trailing }),
        props.children,
      )
    }

    function Skeleton() {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 7, padding: '4px 0' } },
        ['62%', '84%', '48%'].map((width, index) =>
          h('div', { key: index, className: 'twr-skel', style: { width } }),
        ),
      )
    }

    function EmptyLine(props) {
      return h('div', { style: { fontSize: 11, color: T.faint, lineHeight: 1.6, padding: '1px 0 3px' } }, props.children)
    }

    /** 空态不是「没东西」，而是三条可直接复制发给 agent 的起手式。 */
    function EmptyGuide(props) {
      const t = props.t
      const onCopy = props.onCopy
      const copied = props.copied
      const steps = [
        { key: 'goal', label: t('empty.flights.t1'), prompt: t('empty.flights.p1') },
        { key: 'job', label: t('empty.flights.t2'), prompt: t('empty.flights.p2') },
        { key: 'schedule', label: t('empty.flights.t3'), prompt: t('empty.flights.p3') },
      ]
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            padding: '12px 11px 13px',
            border: '1px solid ' + T.border,
            borderRadius: 10,
            background: T.surface,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, color: T.text2, fontSize: 12 } },
          h(Glyph, { size: 15 }),
          h('span', { style: { fontWeight: 600 } }, t('empty.flights.title')),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 10, color: T.faint } }, t('empty.flights.hint')),
        ),
        steps.map((step) =>
          h(
            'button',
            {
              key: step.key,
              type: 'button',
              className: 'twr-hint',
              title: t('empty.flights.copyHint'),
              onClick: () => onCopy(step.key, step.prompt),
            },
            h('span', { className: 'twr-hint__idx' }, copied === step.key ? '✓' : '＋'),
            h('span', { style: { flex: 1, minWidth: 0 } }, step.label),
          ),
        ),
        h('div', { style: { fontSize: 10, color: T.faint } }, t('empty.flights.foot')),
      )
    }
    // #endregion
    // #region panel
    function makePanel(ctx, t, store) {
      const SNOOZE_KEY = 'dsh-tower.snooze.v1'
      const DENSITY_KEY = 'dsh-tower.density.v1'
      const SECTIONS_KEY = 'dsh-tower.sections.v1'

      function readDensity() {
        try {
          return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
        } catch {
          return 'comfortable'
        }
      }

      function readSections() {
        try {
          const raw = window.localStorage.getItem(SECTIONS_KEY)
          const parsed = raw ? JSON.parse(raw) : null
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch {
          return {}
        }
      }

      function writeSections(value) {
        try {
          window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(value))
        } catch {
          /* 隐私模式下不持久，本轮仍生效 */
        }
      }
      const SNOOZE_MS = 30 * 60 * 1000

      function readSnooze() {
        try {
          const raw = window.localStorage.getItem(SNOOZE_KEY)
          const parsed = raw ? JSON.parse(raw) : null
          return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
          return {}
        }
      }

      function writeSnooze(map) {
        try {
          window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(map))
        } catch {
          /* 隐私模式下写不进去：本轮仍然生效，只是不持久 */
        }
      }

      function attentionKey(item) {
        return [item.code, item.sessionId, item.jobId || ''].join(':')
      }

      function copyText(value) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value)
            return true
          }
        } catch {
          /* 落到下面的兜底 */
        }
        return false
      }

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
        const run = React.useCallback(async (key, payload) => {
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
        }, [])
        return { pending, error, run, clear: () => setError('') }
      }

      function openSession(sessionId) {
        openSessionById(ctx, sessionId)
      }

      function GoalLine(props) {
        const goal = props.goal
        const now = props.now
        const color = phaseColor(goal.phase)
        const max = goal.maxGoalRounds || 0
        const rounds = goal.roundsStarted || 0
        const ratio = max > 0 ? Math.min(1, rounds / max) : 0
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 } },
          h('div', { className: 'twr-clamp3', style: { fontSize: 12, lineHeight: 1.55, color: T.text } }, goal.objective),
          max > 0
            ? h(
                'div',
                { style: { height: 2, borderRadius: 999, background: T.surface2, overflow: 'hidden' } },
                h('div', { style: { width: Math.max(4, ratio * 100) + '%', height: '100%', background: color } }),
              )
            : null,
          goal.phase === 'blocked' && goal.blockedMessage
            ? h(
                'div',
                {
                  style: {
                    fontSize: 11,
                    lineHeight: 1.55,
                    padding: '4px 7px',
                    borderRadius: 6,
                    color: T.bad,
                    background: 'color-mix(in srgb, ' + T.bad + ' 9%, transparent)',
                    border: '1px solid color-mix(in srgb, ' + T.bad + ' 24%, transparent)',
                  },
                },
                goal.blockedMessage,
              )
            : null,
        )
      }

      function JobLog(props) {
        const log = props.log
        const t = props.t
        if (log.loading) {
          return h('div', { style: { padding: '2px 0' } }, h(Skeleton, null))
        }
        if (log.error) {
          return h(
            'div',
            {
              style: {
                fontSize: 10,
                lineHeight: 1.5,
                color: T.bad,
                padding: '4px 6px',
                borderRadius: 6,
                background: 'color-mix(in srgb, ' + T.bad + ' 8%, transparent)',
              },
            },
            log.error,
          )
        }
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 } },
          h('pre', { className: 'twr-log' }, log.text && log.text.length > 0 ? log.text : t('job.logEmpty')),
          log.truncated || log.lossy
            ? h(
                'div',
                { style: { fontSize: 9.5, color: T.faint } },
                [log.truncated ? t('job.logLeft', { n: formatBytes(log.from) }) : '', log.lossy ? t('job.logLossy') : '']
                  .filter(Boolean)
                  .join(' · '),
              )
            : null,
        )
      }

      function FlightCard(props) {
        const flight = props.flight
        const action = props.action
        const now = props.now
        const current = props.current
        const focused = props.focused
        const onNewGoal = props.onNewGoal
        const goal = flight.goal
        const liveJobs = flight.jobs.filter((job) => job.status === 'running' || job.status === 'stopping')
        const failedJobs = flight.jobs.filter((job) => job.status === 'failed')
        const goalKey = 'goal:' + flight.sessionId + ':'
        const busy = action.pending.indexOf(goalKey) === 0
        const meta = flightMetaParts(flight, now, t).join(' · ')

        return h(
          'article',
          { className: 'twr-card' + (focused ? ' twr-card--focus' : '') },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
            h(StatusDot, { color: flight.running ? T.ok : goal ? phaseColor(goal.phase) : T.idle, live: flight.running }),
            h(
              'span',
              { className: 'twr-ellipsis', style: { fontWeight: 600, fontSize: 12.5, color: T.text, minWidth: 0 } },
              flight.cwdName,
            ),
            current ? h(Chip, { color: T.brand }, t('chip.current')) : null,
            flight.origin === 'subagent' ? h(Chip, { color: T.idle }, t('flight.subagent')) : null,
            h('span', { style: { flex: 1 } }),
            h('span', { className: 'twr-num', style: { fontSize: 10, color: T.faint } }, flight.short),
          ),
          goal ? h(GoalLine, { goal, now }) : null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 10, color: T.text2 } },
            flight.running ? h(Chip, { color: T.ok }, t('flight.running')) : null,
            !flight.running && goal && goal.phase !== 'complete'
              ? h(Chip, { color: phaseColor(goal.phase) }, t('phase.' + goal.phase))
              : null,
            !goal ? h(Chip, { color: T.idle }, t('flight.noGoalChip')) : null,
            liveJobs.length > 0 ? h('span', null, t('flight.jobs', { n: liveJobs.length })) : null,
            failedJobs.length > 0 ? h('span', { style: { color: T.bad } }, t('flight.failedJobs', { n: failedJobs.length })) : null,
            h('span', { style: { flex: 1 } }),
            meta.length > 0
              ? h('span', { className: 'twr-card__meta', style: { color: T.faint, whiteSpace: 'nowrap' } }, meta)
              : null,
          ),
          h(
            'div',
            { className: 'twr-card__actions', style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 1 } },
            h(Button, { tone: 'ghost', onClick: () => openSession(flight.sessionId) }, t('act.open')),
            !goal ? h(Button, { onClick: onNewGoal }, t('act.newGoal')) : null,
            goal && goal.phase === 'active' && goal.activation === 'armed'
              ? h(
                  Button,
                  {
                    disabled: busy,
                    onClick: () =>
                      action.run(goalKey + 'pause', {
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
                      action.run(goalKey + 'resume', {
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
                    tone: 'accent',
                    disabled: busy,
                    onClick: () =>
                      action.run(goalKey + 'complete', {
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
        const onSnooze = props.onSnooze
        const goal = props.goal
        const urgent = item.level === 'urgent'
        const color = urgent ? T.bad : T.warn
        const jobKey = 'job:' + item.jobId + ':' + item.sessionId
        return h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '7px 9px 7px 10px',
              borderRadius: 8,
              border: '1px solid ' + (urgent ? 'color-mix(in srgb, ' + T.bad + ' 26%, transparent)' : T.border),
              borderLeft: '3px solid ' + color,
              background: urgent ? 'color-mix(in srgb, ' + T.bad + ' 6%, transparent)' : T.surface,
              minWidth: 0,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, minWidth: 0 } },
            h('span', { style: { color: T.text, fontWeight: 600, whiteSpace: 'nowrap' } }, item.label),
            h('span', { className: 'twr-ellipsis', style: { color: T.text2, minWidth: 0 } }, item.title),
            h('span', { style: { flex: 1 } }),
            h('span', { className: 'twr-num', style: { color: T.faint, fontSize: 10 } }, formatElapsed(item.at, props.now) + '前'),
          ),
          item.detail
            ? h('div', { className: 'twr-clamp2', style: { fontSize: 10.5, lineHeight: 1.55, color: T.muted } }, item.detail)
            : null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
            item.code === 'job.failed' ? h(Chip, { color: T.bad }, t('job.failed')) : null,
            item.code === 'goal.paused' && goal
              ? h(
                  Button,
                  {
                    tone: 'accent',
                    disabled: action.pending === 'attn:' + item.sessionId,
                    onClick: () =>
                      action.run('attn:' + item.sessionId, {
                        action: 'goal.resume',
                        sessionId: item.sessionId,
                        goalId: goal.id,
                        revision: goal.revision,
                      }),
                  },
                  t('act.resume'),
                )
              : null,
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
            h(Button, { tone: 'ghost', onClick: () => props.onOpen(item.sessionId) }, t('act.open')),
            h('span', { style: { flex: 1 } }),
            h(Button, { tone: 'ghost', title: t('act.snoozeHint'), onClick: () => onSnooze(item) }, t('act.snooze')),
          ),
        )
      }

      function PanelBody(props) {
        const snapshot = useSnapshot()
        const action = useAction()
        const now = Date.now()

        const ownSession = props && props.sessionId ? String(props.sessionId) : ''
        const allFlights = snapshot.flights || []
        const allSchedules = snapshot.schedules || []
        const [scope, setScope] = React.useState('all')
        const [snooze, setSnooze] = React.useState(readSnooze)
        const [copied, setCopied] = React.useState('')
        const [density, setDensity] = React.useState(readDensity)
        const [sections, setSections] = React.useState(readSections)
        const [refreshing, setRefreshing] = React.useState(false)
        const [logs, setLogs] = React.useState({})
        const [cursor, setCursor] = React.useState(-1)
        const [capsOpen, setCapsOpen] = React.useState(false)
        const [closed, setClosed] = React.useState({ loading: false, rows: [], error: '', loaded: false })
        const [notifyOn, setNotifyOn] = React.useState(readNotifyOn)
        const [notifyNote, setNotifyNote] = React.useState('')
        const [history, setHistory] = React.useState({ loading: false, rows: [], error: '', loaded: false, total: 0, scanned: 0 })
        const [report, setReport] = React.useState({
          loading: false,
          loaded: false,
          markdown: '',
          generatedAt: 0,
          windowHours: 24,
          showPreview: false,
          copied: false,
          error: '',
        })
        const [audit, setAudit] = React.useState({
          loading: false,
          loaded: false,
          enabled: false,
          count: 0,
          path: '',
          verify: null,
          error: '',
        })

        const showScope = Boolean(ownSession) && allFlights.length > 1
        const activeScope = showScope ? scope : 'all'
        const flights = activeScope === 'mine' ? allFlights.filter((flight) => flight.sessionId === ownSession) : allFlights
        const schedules =
          activeScope === 'mine'
            ? allSchedules.filter((entry) => entry.targetSessionId === ownSession)
            : allSchedules

        const snoozeMap = {}
        for (const key of Object.keys(snooze)) {
          const until = Number(snooze[key])
          if (Number.isFinite(until) && until > now) snoozeMap[key] = until
        }
        const rawAttention = (snapshot.attention || []).filter(
          (item) => activeScope !== 'mine' || item.sessionId === ownSession,
        )
        const attention = rawAttention.filter((item) => !snoozeMap[attentionKey(item)])
        const snoozedCount = rawAttention.length - attention.length

        const goalBySession = {}
        for (const flight of allFlights) goalBySession[flight.sessionId] = flight.goal

        const jobs = []
        for (const flight of flights) {
          for (const job of flight.jobs) {
            if (job.status === 'running' || job.status === 'stopping' || job.status === 'failed') jobs.push({ job, flight })
          }
        }

        const counts = {
          live: flights.length,
          running: flights.filter((flight) => flight.running).length,
          urgent: attention.filter((item) => item.level === 'urgent').length,
          jobsLive: jobs.filter((row) => row.job.status === 'running' || row.job.status === 'stopping').length,
          schedules: schedules.filter((entry) => entry.status === 'active').length,
        }

        function snoozeItem(item) {
          const next = Object.assign({}, snooze, { [attentionKey(item)]: now + SNOOZE_MS })
          setSnooze(next)
          writeSnooze(next)
        }

        function restoreSnoozed() {
          setSnooze({})
          writeSnooze({})
        }

        async function toggleLog(row) {
          const id = row.job.id
          const current = logs[id]
          if (current && current.open) {
            setLogs((prev) => Object.assign({}, prev, { [id]: Object.assign({}, prev[id], { open: false }) }))
            return
          }
          setLogs((prev) => Object.assign({}, prev, { [id]: { open: true, loading: true, text: '', error: '', from: 0, truncated: false, lossy: false } }))
          try {
            const url =
              API +
              '?job=' +
              encodeURIComponent(id) +
              '&session=' +
              encodeURIComponent(row.flight.sessionId) +
              '&tail=4000'
            const response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
            const data = await response.json().catch(() => null)
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status)
            const meta = data.job || {}
            setLogs((prev) =>
              Object.assign({}, prev, {
                [id]: {
                  open: true,
                  loading: false,
                  text: String(data.text || ''),
                  error: '',
                  from: Number(meta.from) || 0,
                  truncated: Boolean(meta.truncated),
                  lossy: Boolean(meta.lossy),
                },
              }),
            )
          } catch (error) {
            setLogs((prev) =>
              Object.assign({}, prev, {
                [id]: {
                  open: true,
                  loading: false,
                  text: '',
                  error: String(error && error.message ? error.message : error),
                  from: 0,
                  truncated: false,
                  lossy: false,
                },
              }),
            )
          }
        }

        function onCopy(key, prompt) {
          copyText(prompt)
          setCopied(key)
          window.setTimeout(() => setCopied(''), 1400)
        }

        function sectionOpen(key, autoValue) {
          return Object.prototype.hasOwnProperty.call(sections, key) ? Boolean(sections[key]) : autoValue
        }

        function toggleSection(key, autoValue) {
          const next = Object.assign({}, sections, { [key]: !sectionOpen(key, autoValue) })
          setSections(next)
          writeSections(next)
        }

        React.useEffect(() => {
          const sync = () => setNotifyOn(readNotifyOn())
          window.addEventListener('dsh-tower:notify', sync)
          window.addEventListener('storage', sync)
          return () => {
            window.removeEventListener('dsh-tower:notify', sync)
            window.removeEventListener('storage', sync)
          }
        }, [])

        async function toggleNotify() {
          setNotifyNote('')
          if (notifyOn) {
            writeNotifyOn(false)
            setNotifyOn(false)
            announceNotifyChange()
            return
          }
          if (typeof Notification === 'undefined') {
            setNotifyNote(t('notify.unsupported'))
            return
          }
          let permission = Notification.permission
          if (permission === 'default') {
            try {
              permission = await Notification.requestPermission()
            } catch {
              permission = 'denied'
            }
          }
          if (permission !== 'granted') {
            setNotifyNote(t('notify.blocked'))
            return
          }
          writeNotifyOn(true)
          setNotifyOn(true)
          announceNotifyChange()
          try {
            new Notification(t('notify.enableTitle'), { body: t('notify.enableBody'), tag: 'dsh-tower:enabled' })
          } catch {
            /* 权限刚授予也可能失败：不影响面板 */
          }
        }

        function toggleDensity() {
          const next = density === 'compact' ? 'comfortable' : 'compact'
          setDensity(next)
          try {
            window.localStorage.setItem(DENSITY_KEY, next)
          } catch {
            /* 不持久也不影响本轮 */
          }
        }

        const jobsExpanded = sectionOpen('jobs', jobs.length > 0)
        const schedulesExpanded = sectionOpen('schedules', schedules.length > 0)
        const recent = snapshot.recent || []
        const historyExpanded = sectionOpen('history', false)
        const auditExpanded = sectionOpen('audit', false)
        const reportExpanded = sectionOpen('report', false)

        const loadReport = React.useCallback(async () => {
          setReport((prev) => Object.assign({}, prev, { loading: true, error: '' }))
          try {
            const response = await fetch(API + '?report=1&hours=24', { cache: 'no-store', headers: { accept: 'application/json' } })
            const data = await response.json().catch(() => null)
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status)
            setReport((prev) =>
              Object.assign({}, prev, {
                loading: false,
                loaded: true,
                markdown: String(data.markdown || ''),
                generatedAt: Number(data.generatedAt) || Date.now(),
                windowHours: Number(data.windowHours) || 24,
                error: '',
              }),
            )
          } catch (error) {
            setReport((prev) => Object.assign({}, prev, { loading: false, loaded: true, error: String(error && error.message ? error.message : error) }))
          }
        }, [])

        function downloadReport() {
          try {
            const blob = new Blob([report.markdown || ''], { type: 'text/markdown;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = 'tower-report-' + new Date(report.generatedAt || Date.now()).toISOString().slice(0, 10) + '.md'
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.setTimeout(() => URL.revokeObjectURL(url), 2000)
          } catch {
            /* 下载失败不影响面板 */
          }
        }

        function copyReport() {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(report.markdown || '')
              setReport((prev) => Object.assign({}, prev, { copied: true }))
              window.setTimeout(() => setReport((prev) => Object.assign({}, prev, { copied: false })), 1400)
            }
          } catch {
            /* 复制失败不影响面板 */
          }
        }

        React.useEffect(() => {
          if (reportExpanded && !report.loaded && !report.loading) loadReport()
        }, [reportExpanded, report.loaded, report.loading, loadReport])

        const loadAudit = React.useCallback(async (withVerify) => {
          setAudit((prev) => Object.assign({}, prev, { loading: true, error: '' }))
          try {
            const suffix = withVerify ? '?audit=1&verify=1' : '?audit=1'
            const response = await fetch(API + suffix, { cache: 'no-store', headers: { accept: 'application/json' } })
            const data = await response.json().catch(() => null)
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status)
            setAudit({
              loading: false,
              loaded: true,
              enabled: Boolean(data.status && data.status.enabled),
              count: Number(data.status && data.status.count) || 0,
              path: String((data.status && data.status.path) || ''),
              verify: data.verify || null,
              error: '',
            })
          } catch (error) {
            setAudit((prev) => Object.assign({}, prev, { loading: false, loaded: true, error: String(error && error.message ? error.message : error) }))
          }
        }, [])

        async function toggleAudit() {
          setAudit((prev) => Object.assign({}, prev, { loading: true, error: '' }))
          try {
            const response = await fetch(API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: audit.enabled ? 'audit.disable' : 'audit.enable' }),
            })
            const data = await response.json().catch(() => null)
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status)
            const status = data.result || {}
            setAudit({
              loading: false,
              loaded: true,
              enabled: Boolean(status.enabled),
              count: Number(status.count) || 0,
              path: String(status.path || ''),
              verify: null,
              error: '',
            })
          } catch (error) {
            setAudit((prev) => Object.assign({}, prev, { loading: false, error: String(error && error.message ? error.message : error) }))
          }
        }

        function exportAudit() {
          try {
            const link = document.createElement('a')
            link.href = API + '?audit=1&download=1'
            link.download = 'tower-audit.jsonl'
            document.body.appendChild(link)
            link.click()
            link.remove()
          } catch {
            /* 下载失败不影响面板 */
          }
        }

        React.useEffect(() => {
          if (auditExpanded && !audit.loaded && !audit.loading) loadAudit(false)
        }, [auditExpanded, audit.loaded, audit.loading, loadAudit])
        const closedExpanded = sectionOpen('closed', false)

        const loadHistory = React.useCallback(async () => {
          setHistory((prev) => Object.assign({}, prev, { loading: true, error: '' }))
          try {
            const response = await fetch(API + '?history=1&limit=20', {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            })
            const data = await response.json().catch(() => null)
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status)
            setHistory({
              loading: false,
              rows: Array.isArray(data.jobs) ? data.jobs : [],
              total: Number(data.total) || 0,
              scanned: Number(data.scanned) || 0,
              error: '',
              loaded: true,
            })
          } catch (error) {
            setHistory({
              loading: false,
              rows: [],
              total: 0,
              scanned: 0,
              error: String(error && error.message ? error.message : error),
              loaded: true,
            })
          }
        }, [])

        React.useEffect(() => {
          if (historyExpanded && !history.loaded && !history.loading) loadHistory()
        }, [historyExpanded, history.loaded, history.loading, loadHistory])

        const loadClosed = React.useCallback(async () => {
          setClosed((prev) => Object.assign({}, prev, { loading: true, error: '' }))
          try {
            const response = await fetch(API + '?closed=1&limit=8', {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            })
            const data = await response.json().catch(() => null)
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'HTTP ' + response.status)
            setClosed({ loading: false, rows: Array.isArray(data.closed) ? data.closed : [], error: '', loaded: true })
          } catch (error) {
            setClosed({
              loading: false,
              rows: [],
              error: String(error && error.message ? error.message : error),
              loaded: true,
            })
          }
        }, [])

        React.useEffect(() => {
          if (closedExpanded && !closed.loaded && !closed.loading) loadClosed()
        }, [closedExpanded, closed.loaded, closed.loading, loadClosed])

        const recentExpanded = sectionOpen('recent', false)
        const caps = snapshot.caps || null
        const missingCaps = caps ? Object.keys(caps).filter((key) => !caps[key]) : []
        const degraded = missingCaps.length > 0
        const loading = snapshot.loading && !snapshot.at
        const banner = action.error || (!snapshot.ok && snapshot.error ? snapshot.error : '')

        const statItems = [
          { key: 'live', value: counts.live, color: T.text },
          { key: 'running', value: counts.running, color: T.ok },
          { key: 'urgent', value: counts.urgent, color: T.bad },
          { key: 'jobs', value: counts.jobsLive, color: T.text },
          { key: 'schedules', value: counts.schedules, color: T.text },
        ]

        const statNodes = []
        statItems.forEach((stat, index) => {
          if (index > 0) statNodes.push(h('span', { key: 'sep' + index, style: { color: T.faint } }, '·'))
          statNodes.push(
            h(
              'span',
              { key: stat.key, style: { display: 'inline-flex', alignItems: 'baseline', gap: 3, whiteSpace: 'nowrap' } },
              h(
                'span',
                {
                  className: 'twr-num',
                  style: { fontSize: 12, fontWeight: 600, color: stat.value > 0 ? stat.color : T.faint },
                },
                String(stat.value),
              ),
              h('span', { style: { color: T.faint } }, t('strip.' + stat.key)),
            ),
          )
        })

        // 键盘只在面板获得焦点时生效（不劫持输入框里的 j/k）
        function onKeyDown(event) {
          if (event.key === 'j' || event.key === 'ArrowDown') {
            if (flights.length === 0) return
            event.preventDefault()
            setCursor((value) => Math.min(flights.length - 1, value + 1))
            return
          }
          if (event.key === 'k' || event.key === 'ArrowUp') {
            if (flights.length === 0) return
            event.preventDefault()
            setCursor((value) => Math.max(0, value - 1))
            return
          }
          if (event.key === 'Enter' && cursor >= 0 && flights[cursor]) {
            event.preventDefault()
            openSession(flights[cursor].sessionId)
            return
          }
          if (event.key === 'Escape') setCursor(-1)
        }

        return h(
          React.Fragment,
          null,
          h('style', null, CSS),
          h(
            'div',
            {
              className: 'twr-root',
              'data-density': density,
              tabIndex: 0,
              onKeyDown,
              'aria-label': t('title'),
              style: {
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
                fontSize: 12,
                color: T.text,
                background: T.sidebar,
              },
            },
            // 头部
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 12px 7px',
                  borderBottom: '1px solid ' + T.border,
                },
              },
              h(Glyph, { size: 15 }),
              h('span', { style: { fontWeight: 600, fontSize: 12.5 } }, t('title')),
              h('span', { style: { color: T.faint, fontSize: 10 } }, t('head.sub')),
              h('span', { style: { flex: 1 } }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'twr-btn twr-btn--ghost twr-mini',
                  title: notifyOn ? t('act.notifyOn') : t('act.notify'),
                  style: notifyOn ? { color: T.ok } : undefined,
                  onClick: toggleNotify,
                },
                notifyOn ? t('act.notifyOn') : t('act.notify'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'twr-btn twr-btn--ghost twr-mini',
                  title: t('act.density'),
                  onClick: toggleDensity,
                },
                density === 'compact' ? t('density.comfortable') : t('density.compact'),
              ),
              h(
                IconButton,
                {
                  title: t('head.refresh'),
                  spin: refreshing,
                  onClick: async () => {
                    setRefreshing(true)
                    await store.refresh()
                    window.setTimeout(() => setRefreshing(false), 400)
                  },
                },
                h('span', { style: { fontSize: 13, lineHeight: 1 } }, '↻'),
              ),
            ),
            // 状态行：作用域 + 一句话计数
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  padding: '7px 12px',
                  borderBottom: '1px solid ' + T.border,
                  background: T.surface,
                },
              },
              showScope
                ? h(
                    'div',
                    { className: 'twr-scope' },
                    h(
                      'button',
                      { type: 'button', 'data-on': activeScope === 'all' ? '1' : '0', onClick: () => setScope('all') },
                      t('scope.all'),
                    ),
                    h(
                      'button',
                      { type: 'button', 'data-on': activeScope === 'mine' ? '1' : '0', onClick: () => setScope('mine') },
                      t('scope.mine'),
                    ),
                  )
                : null,
              showScope ? null : h('span', { style: { fontSize: 10.5, color: T.faint } }, t('scope.all')),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', fontSize: 10.5, color: T.text2 } },
                statNodes,
              ),
            ),
            // 主体
            h(
              'div',
              { className: 'twr-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 10 } },
              banner
                ? h(
                    'div',
                    {
                      className: 'twr-banner',
                      style: {
                        margin: '9px 12px 0',
                        color: action.error ? T.bad : T.warn,
                        background: 'color-mix(in srgb, ' + (action.error ? T.bad : T.warn) + ' 9%, transparent)',
                        border: '1px solid color-mix(in srgb, ' + (action.error ? T.bad : T.warn) + ' 26%, transparent)',
                      },
                    },
                    h('span', { style: { flex: 1, minWidth: 0 } }, banner),
                    action.error
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'twr-btn twr-btn--ghost',
                            style: { height: 18, padding: '0 6px' },
                            onClick: action.clear,
                          },
                          '×',
                        )
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'twr-btn twr-btn--ghost',
                            style: { height: 18, padding: '0 6px' },
                            onClick: () => store.refresh(),
                          },
                          t('head.refresh'),
                        ),
                  )
                : null,

              loading
                ? h('div', { style: { padding: '14px 12px' } }, h(Skeleton, null))
                : null,

              // ① 需要你
              attention.length > 0
                ? h(
                    Section,
                    {
                      title: t('section.attention'),
                      count: attention.length,
                      kind: 'attention',
                      trailing:
                        snoozedCount > 0
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'twr-btn twr-btn--ghost',
                                style: { height: 18, padding: '0 6px', fontSize: 10 },
                                onClick: restoreSnoozed,
                              },
                              t('snooze.note', { n: snoozedCount }),
                            )
                          : null,
                    },
                    attention.map((item, index) =>
                      h(AttentionItem, {
                        key: attentionKey(item) + ':' + index,
                        item,
                        now,
                        action,
                        onOpen: openSession,
                        onSnooze: snoozeItem,
                        goal: goalBySession[item.sessionId],
                      }),
                    ),
                  )
                : null,

              // ② 航班
              h(
                Section,
                {
                  title: t('section.flights'),
                  count: flights.length,
                  kind: 'flights',
                  trailing:
                    flights.length > 1
                      ? h('span', { style: { fontSize: 9.5, color: T.faint, whiteSpace: 'nowrap' } }, t('hint.keys'))
                      : null,
                },
                flights.length === 0
                  ? loading
                    ? null
                    : h(EmptyGuide, { t, onCopy, copied })
                  : h(
                      'div',
                      { className: 'twr-grid' },
                      flights.map((flight, index) =>
                        h(FlightCard, {
                          key: flight.sessionId,
                          flight,
                          now,
                          action,
                          focused: cursor === index,
                          onNewGoal: () => onCopy('goal:' + flight.sessionId, t('empty.flights.p1')),
                          current: Boolean(ownSession) && flight.sessionId === ownSession,
                        }),
                      ),
                    ),
                flights.length > 0 && !flights.some((flight) => flight.goal)
                  ? h('div', { style: { fontSize: 10, lineHeight: 1.6, color: T.faint } }, t('flights.hint.goal'))
                  : null,
              ),

              // ③ 后台
              h(
                Section,
                {
                  title: t('section.jobs'),
                  count: jobs.length,
                  kind: 'jobs',
                  trailing:
                    jobs.length > 0
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'twr-plus',
                            title: jobsExpanded ? t('act.collapse') : t('act.expand'),
                            onClick: () => toggleSection('jobs', jobs.length > 0),
                          },
                          jobsExpanded ? '−' : '+',
                        )
                      : null,
                },
                jobs.length === 0
                  ? h(EmptyLine, null, t('empty.jobs'))
                  : jobsExpanded
                    ? jobs.map((row) =>
                        h(
                          'div',
                          {
                            key: row.job.id,
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                              padding: '6px 9px',
                              border: '1px solid ' + T.border,
                              borderRadius: 8,
                              background: T.surface,
                              minWidth: 0,
                            },
                          },
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
                            h(Chip, { color: jobColor(row.job.status) }, jobStatusLabel(t, row.job.status)),
                            h(
                              'span',
                              { className: 'twr-ellipsis', style: { fontSize: 11, color: T.text, minWidth: 0 } },
                              row.job.label,
                            ),
                            h('span', { style: { flex: 1 } }),
                            h('span', { className: 'twr-num', style: { fontSize: 10, color: T.faint } }, formatBytes(row.job.outputBytes)),
                          ),
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T.text2, minWidth: 0 } },
                            h('span', { style: { color: T.faint, whiteSpace: 'nowrap' } }, row.flight.cwdName),
                            h('span', { className: 'twr-num', style: { color: T.faint } }, '·'),
                            h(
                              'span',
                              { className: 'twr-num', style: { whiteSpace: 'nowrap' } },
                              row.job.status === 'running'
                                ? formatElapsed(row.job.startedAt, now)
                                : formatElapsed(row.job.startedAt, row.job.finishedAt || now),
                            ),
                            row.job.progress ? h('span', { className: 'twr-ellipsis', style: { minWidth: 0 } }, '· ' + row.job.progress) : null,
                            h('span', { style: { flex: 1 } }),
                            h(
                              Button,
                              {
                                tone: row.job.status === 'failed' ? 'danger' : 'ghost',
                                onClick: () => toggleLog(row),
                              },
                              t('job.log'),
                            ),
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
                                  className: 'twr-ellipsis',
                                  style: { fontSize: 10, color: row.job.status === 'failed' ? T.bad : T.faint },
                                },
                                row.job.detail,
                              )
                            : null,
                          logs[row.job.id] && logs[row.job.id].open
                            ? h(JobLog, { log: logs[row.job.id], t })
                            : null,
                        ),
                      )
                    : null,
              ),

              // ④ 定时
              h(
                Section,
                {
                  title: t('section.schedules'),
                  count: schedules.length,
                  kind: 'schedules',
                  trailing:
                    schedules.length > 0
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'twr-plus',
                            title: schedulesExpanded ? t('act.collapse') : t('act.expand'),
                            onClick: () => toggleSection('schedules', schedules.length > 0),
                          },
                          schedulesExpanded ? '−' : '+',
                        )
                      : null,
                },
                schedules.length === 0
                  ? h(EmptyLine, null, t('empty.schedules'))
                  : schedulesExpanded
                    ? schedules.map((entry) =>
                        h(
                          'div',
                          {
                            key: entry.id,
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '5px 9px',
                              border: '1px solid ' + T.border,
                              borderRadius: 8,
                              background: T.surface,
                              minWidth: 0,
                            },
                          },
                          h(Chip, { color: entry.status === 'active' ? T.ok : T.warn }, t('sched.' + entry.status)),
                          h('span', { className: 'twr-ellipsis', style: { fontSize: 11, color: T.text, minWidth: 0 } }, entry.title),
                          h('span', { style: { flex: 1 } }),
                          h(
                            'span',
                            { className: 'twr-num', style: { fontSize: 10, color: T.faint, whiteSpace: 'nowrap' } },
                            entry.scheduledAt ? formatAhead(entry.scheduledAt, now, t) : t('sched.target.session'),
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
                      )
                    : null,
              ),
            ),

            // ④.5 审计（L4 起点：本地哈希链，默认关闭）
            h(
              Section,
              {
                title: t('section.audit'),
                count: audit.enabled ? audit.count : 0,
                kind: 'attention',
                trailing: h(
                  'button',
                  {
                    type: 'button',
                    className: 'twr-plus',
                    title: auditExpanded ? t('act.collapse') : t('act.expand'),
                    onClick: () => toggleSection('audit', false),
                  },
                  auditExpanded ? '−' : '+',
                ),
              },
              auditExpanded
                ? audit.loading && !audit.loaded
                  ? h('div', { style: { padding: '2px 0' } }, h(Skeleton, null))
                  : h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 } },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, minWidth: 0 } },
                        h(Chip, { color: audit.enabled ? T.ok : T.idle }, audit.enabled ? t('audit.on') : t('audit.off')),
                        h('span', { className: 'twr-num', style: { color: T.faint } }, t('audit.count', { n: audit.count })),
                        h('span', { style: { flex: 1 } }),
                        h(Button, { tone: audit.enabled ? 'danger' : 'accent', onClick: toggleAudit }, audit.enabled ? t('audit.disable') : t('audit.enable')),
                        h(Button, { tone: 'ghost', disabled: audit.count === 0, onClick: exportAudit }, t('audit.export')),
                        h(Button, { tone: 'ghost', disabled: audit.count === 0, onClick: () => loadAudit(true) }, t('audit.verify')),
                      ),
                      audit.verify
                        ? h(
                            'div',
                            {
                              style: {
                                fontSize: 10,
                                lineHeight: 1.5,
                                color: audit.verify.ok ? T.ok : T.bad,
                              },
                            },
                            audit.verify.ok
                              ? t('audit.ok', { n: audit.verify.count })
                              : t('audit.broken', { n: audit.verify.at, why: audit.verify.reason }),
                          )
                        : null,
                      audit.error
                        ? h('div', { style: { fontSize: 10, color: T.bad } }, t('audit.failed') + '：' + audit.error)
                        : null,
                      h('div', { style: { fontSize: 9, color: T.faint, wordBreak: 'break-all' } }, audit.path || ''),
                      h('div', { style: { fontSize: 9.5, color: T.faint, lineHeight: 1.5 } }, t('audit.note')),
                      h(
                        'div',
                        { style: { fontSize: 9.5, color: T.faint, lineHeight: 1.5, marginTop: 2 } },
                        t('policy.line', {
                          idle: (snapshot.policy && snapshot.policy.idleMinutes) || 20,
                          hours: (snapshot.policy && snapshot.policy.historyHours) || 24,
                          auto:
                            snapshot.policy && snapshot.policy.autoPauseEnabled
                              ? t('policy.autoOn', { n: snapshot.policy.autoPauseAfterMinutes })
                              : t('policy.autoOff'),
                        }),
                      ),
                      h('div', { style: { fontSize: 9, color: T.faint, lineHeight: 1.5 } }, t('policy.path')),
                    )
                : null,
            ),

            // ⑤ 作业历史（持久化日志复算，最近 24h）
            h(
              Section,
              {
                title: t('section.history'),
                count: history.rows.length,
                kind: 'jobs',
                trailing: h(
                  'button',
                  {
                    type: 'button',
                    className: 'twr-plus',
                    title: historyExpanded ? t('act.collapse') : t('act.expand'),
                    onClick: () => toggleSection('history', false),
                  },
                  historyExpanded ? '−' : '+',
                ),
              },
              historyExpanded
                ? history.loading
                  ? h('div', { style: { padding: '2px 0' } }, h(Skeleton, null))
                  : history.error
                    ? h('div', { style: { fontSize: 10.5, color: T.bad, lineHeight: 1.5 } }, t('history.failed') + '：' + history.error)
                    : history.rows.length === 0
                      ? h(EmptyLine, null, t('history.empty'))
                      : history.rows.map((row) =>
                          h(
                            'div',
                            {
                              key: row.jobId || row.sessionId + ':' + row.finishedAt,
                              style: {
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 3,
                                padding: '6px 9px',
                                border: '1px solid ' + T.border,
                                borderRadius: 8,
                                background: T.surface,
                                minWidth: 0,
                              },
                            },
                            h(
                              'div',
                              { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
                              h(Chip, { color: jobColor(row.status) }, jobStatusLabel(t, row.status)),
                              h(
                                'span',
                                { className: 'twr-ellipsis', style: { fontSize: 11, color: T.text, minWidth: 0 } },
                                row.label || row.jobId || '—',
                              ),
                              h('span', { style: { flex: 1 } }),
                              h(
                                'span',
                                { className: 'twr-num', style: { fontSize: 9.5, color: T.faint, whiteSpace: 'nowrap' } },
                                row.finishedAt ? formatClock(row.finishedAt) : '',
                              ),
                            ),
                            h(
                              'div',
                              { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 9.5, color: T.faint, minWidth: 0 } },
                              h('span', { style: { whiteSpace: 'nowrap' } }, row.cwdName),
                              row.durationMs ? h('span', { className: 'twr-num' }, '· ' + formatElapsed(0, row.durationMs)) : null,
                              row.detail
                                ? h(
                                    'span',
                                    { className: 'twr-ellipsis', style: { color: row.status === 'failed' ? T.bad : T.faint, minWidth: 0 } },
                                    '· ' + row.detail,
                                  )
                                : null,
                            ),
                          ),
                        )
                : null,
              historyExpanded
                ? h(
                    'div',
                    { style: { fontSize: 9.5, color: T.faint, paddingTop: 2 } },
                    t('history.note', { n: history.scanned }) +
                      (history.total > history.rows.length ? ' · ' + t('history.total', { n: history.total }) : ''),
                  )
                : null,
            ),

            // ⑤ 最近处置（本次运行内的动作账）
            recent.length > 0
              ? h(
                  Section,
                  {
                    title: t('section.recent'),
                    count: recent.length,
                    kind: 'recent',
                    trailing: h(
                      'button',
                      {
                        type: 'button',
                        className: 'twr-plus',
                        title: recentExpanded ? t('act.collapse') : t('act.expand'),
                        onClick: () => toggleSection('recent', false),
                      },
                      recentExpanded ? '−' : '+',
                    ),
                  },
                  recentExpanded
                    ? recent.map((entry, index) =>
                        h(
                          'div',
                          {
                            key: String(entry.at) + ':' + index,
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 10.5,
                              color: T.text2,
                              minWidth: 0,
                            },
                          },
                          h(
                            'span',
                            { className: 'twr-num', style: { color: T.faint, whiteSpace: 'nowrap' } },
                            formatClock(entry.at),
                          ),
                          h('span', { style: { whiteSpace: 'nowrap' } }, t('verb.' + entry.verb)),
                          h(
                            'span',
                            { className: 'twr-ellipsis', style: { color: T.text, minWidth: 0 } },
                            entry.label || '—',
                          ),
                          h('span', { style: { flex: 1 } }),
                          entry.outcome && entry.outcome !== 'ok' && entry.outcome !== 'requested'
                            ? h(Chip, { color: T.warn }, String(entry.outcome))
                            : null,
                        ),
                      )
                    : null,
                  recentExpanded
                    ? h('div', { style: { fontSize: 9.5, color: T.faint, paddingTop: 2 } }, t('recent.note'))
                    : h(EmptyLine, null, t('recent.note')),
                )
              : null,
            // 降级明细（只在用户点开时展开）
            capsOpen && degraded
              ? h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 5,
                      padding: '7px 12px',
                      borderTop: '1px solid ' + T.border,
                      background: 'color-mix(in srgb, ' + T.warn + ' 6%, transparent)',
                    },
                  },
                  missingCaps.map((key) =>
                    h(Chip, { key, color: T.warn }, t('caps.unavailable', { name: t('cap.' + key) })),
                  ),
                  h('div', { style: { fontSize: 9.5, lineHeight: 1.5, color: T.faint, width: '100%' } }, t('caps.hint')),
                )
              : null,
            // ⑥ 已收场（关掉的会话，只读复算最后目标）
            h(
              Section,
              {
                title: t('section.closed'),
                count: closed.rows.length || 0,
                kind: 'recent',
                trailing: h(
                  'button',
                  {
                    type: 'button',
                    className: 'twr-plus',
                    title: closedExpanded ? t('act.collapse') : t('act.expand'),
                    onClick: () => toggleSection('closed', false),
                  },
                  closedExpanded ? '−' : '+',
                ),
              },
              closedExpanded
                ? closed.loading
                  ? h('div', { style: { padding: '2px 0' } }, h(Skeleton, null))
                  : closed.error
                    ? h('div', { style: { fontSize: 10.5, color: T.bad, lineHeight: 1.5 } }, t('closed.failed') + '：' + closed.error)
                    : closed.rows.length === 0
                      ? h(EmptyLine, null, t('closed.empty'))
                      : closed.rows.map((row) =>
                          h(
                            'div',
                            {
                              key: row.sessionId,
                              style: {
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                padding: '7px 9px',
                                border: '1px solid ' + T.border,
                                borderRadius: 8,
                                background: T.surface,
                                minWidth: 0,
                                opacity: 0.92,
                              },
                            },
                            h(
                              'div',
                              { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                              h(StatusDot, { color: phaseColor(row.goal.phase), live: false }),
                              h(
                                'span',
                                { className: 'twr-ellipsis', style: { fontSize: 11.5, fontWeight: 600, minWidth: 0 } },
                                row.cwdName,
                              ),
                              h(Chip, { color: phaseColor(row.goal.phase) }, t('phase.' + row.goal.phase)),
                              h('span', { style: { flex: 1 } }),
                              h(
                                'span',
                                { className: 'twr-num', style: { fontSize: 9.5, color: T.faint, whiteSpace: 'nowrap' } },
                                row.goal.updatedAt ? formatClock(row.goal.updatedAt) : '',
                              ),
                            ),
                            h(
                              'div',
                              { className: 'twr-clamp2', style: { fontSize: 11, lineHeight: 1.5, color: T.text2 } },
                              row.goal.objective,
                            ),
                            h(
                              'div',
                              { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 9.5, color: T.faint } },
                              h(
                                'span',
                                { className: 'twr-num' },
                                t('flight.rounds', { n: row.goal.roundsStarted, max: row.goal.maxGoalRounds || '∞' }),
                              ),
                              row.goal.blockedMessage
                                ? h('span', { className: 'twr-ellipsis', style: { color: T.bad, minWidth: 0 } }, row.goal.blockedMessage)
                                : null,
                              h('span', { style: { flex: 1 } }),
                              h(Button, { tone: 'ghost', onClick: () => openSession(row.sessionId) }, t('act.reopen')),
                            ),
                          ),
                        )
                : null,
              closedExpanded ? h('div', { style: { fontSize: 9.5, color: T.faint, paddingTop: 2 } }, t('closed.note')) : null,
            ),

            // ⑦ 值守报告（L3：可交接的一页）
            h(
              Section,
              {
                title: t('section.report'),
                count: 0,
                kind: 'schedules',
                trailing: h(
                  'button',
                  {
                    type: 'button',
                    className: 'twr-plus',
                    title: reportExpanded ? t('act.collapse') : t('act.expand'),
                    onClick: () => toggleSection('report', false),
                  },
                  reportExpanded ? '−' : '+',
                ),
              },
              reportExpanded
                ? report.loading && !report.loaded
                  ? h('div', { style: { padding: '2px 0' } }, h(Skeleton, null))
                  : report.error
                    ? h('div', { style: { fontSize: 10.5, color: T.bad, lineHeight: 1.5 } }, t('report.failed') + '：' + report.error)
                    : h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: T.faint, flexWrap: 'wrap' } },
                          h('span', { className: 'twr-num' }, t('report.window', { n: report.windowHours })),
                          h('span', { className: 'twr-num' }, report.generatedAt ? formatClock(report.generatedAt) : ''),
                          h('span', { style: { flex: 1 } }),
                          h(
                            Button,
                            {
                              tone: 'ghost',
                              onClick: () =>
                                setReport((prev) => Object.assign({}, prev, { showPreview: !prev.showPreview })),
                            },
                            report.showPreview ? t('report.hidePreview') : t('report.preview'),
                          ),
                          h(Button, { tone: 'ghost', onClick: copyReport }, report.copied ? t('report.copied') : t('report.copy')),
                          h(Button, { tone: 'accent', onClick: downloadReport }, t('report.download')),
                        ),
                        report.showPreview
                          ? h(
                              'pre',
                              {
                                className: 'twr-log',
                                style: { maxHeight: 260, fontSize: 9.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' },
                              },
                              report.markdown,
                            )
                          : null,
                        h('div', { style: { fontSize: 9.5, color: T.faint, lineHeight: 1.5 } }, t('report.note')),
                      )
                : null,
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
                  borderTop: '1px solid ' + T.border,
                  fontSize: 9.5,
                  color: T.faint,
                },
              },
              h(
                'span',
                { className: 'twr-ellipsis', style: { flex: 1, color: notifyNote ? T.warn : T.faint } },
                notifyNote || (snapshot.version ? 'v' + snapshot.version + ' · ' : '') + t('foot.note'),
              ),
              degraded
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'twr-btn twr-btn--ghost twr-mini',
                      style: { height: 16, padding: '0 5px', color: T.warn },
                      title: t('caps.hint'),
                      onClick: () => setCapsOpen(!capsOpen),
                    },
                    t('caps.degraded', { n: missingCaps.length }),
                  )
                : h('span', {
                    title: t('caps.ok'),
                    style: { width: 6, height: 6, borderRadius: 999, background: T.ok, opacity: 0.7, flex: '0 0 auto' },
                  }),
              h('span', { className: 'twr-num', style: { whiteSpace: 'nowrap' } }, snapshot.at ? formatClock(snapshot.at) : '—'),
            ),
          ),
        )
      }
    

      /**
       * 渲染边界：面板内部任何异常都收敛成一句可读错误 + 重试，
       * 绝不让右栏变成白屏（白屏会让用户以为整个宿主坏了）。
       */
      class PanelBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { error: '' }
        }

        static getDerivedStateFromError(error) {
          return { error: String(error && error.message ? error.message : error) }
        }

        componentDidCatch(error) {
          try {
            console.warn('[tower] 面板渲染异常：', error)
          } catch {
            /* 控制台不可用也不影响兜底 */
          }
        }

        render() {
          if (!this.state.error) return this.props.children
          return h(
            'div',
            {
              className: 'twr-root',
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '16px 14px',
                fontSize: 12,
                color: T.text,
                background: T.sidebar,
                height: '100%',
              },
            },
            h('style', null, CSS),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, color: T.warn } },
              h(Glyph, { size: 15 }),
              h('span', { style: { fontWeight: 600 } }, t('crash.title')),
            ),
            h('div', { style: { fontSize: 11, lineHeight: 1.6, color: T.muted } }, t('crash.body')),
            h('div', { style: { fontSize: 10.5, fontFamily: T.mono, color: T.faint, wordBreak: 'break-word' } }, this.state.error),
            h(
              'div',
              { style: { display: 'flex', gap: 6, marginTop: 2 } },
              h(
                Button,
                { onClick: () => this.setState({ error: '' }) },
                t('crash.retry'),
              ),
              h(Button, { tone: 'ghost', onClick: () => openSession() }, t('act.open')),
            ),
          )
        }
      }

      return function TowerPanel(props) {
        return h(PanelBoundary, null, h(PanelBody, props))
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
          React.Fragment,
          null,
          h('style', null, CSS),
          h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 } },
            h(Glyph, { size: 12 }),
            h('span', { className: 'twr-ellipsis' }, t('title')),
            urgent > 0 ? h('span', { className: 'twr-entry__badge' }, String(urgent)) : null,
          ),
        )
      }
    }

    /** 输入框工具栏入口：常驻入口 + 待处置角标。 */
    function makeEntry(t, store, openPanel, ctx) {
      return function TowerEntryButton() {
        const [snapshot, setSnapshot] = React.useState(store.get())
        const [notifyOn, setNotifyOn] = React.useState(readNotifyOn)

        React.useEffect(() => {
          const sync = () => setNotifyOn(readNotifyOn())
          const unsubscribe = store.subscribe(() => setSnapshot(store.get()))
          window.addEventListener('dsh-tower:notify', sync)
          window.addEventListener('storage', sync)
          return () => {
            unsubscribe()
            window.removeEventListener('dsh-tower:notify', sync)
            window.removeEventListener('storage', sync)
          }
        }, [])

        // 通知引擎：入口按钮常驻，因此面板关着也能提醒。
        React.useEffect(() => {
          if (!notifyOn) return
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus()) return
          const seen = readNotified()
          const fresh = notificationCandidates(snapshot.attention, seen, Date.now(), !snapshot.policy || snapshot.policy.notifyOnlyUrgent !== false)
          if (fresh.length === 0) return
          for (const row of fresh) {
            if (notifiedNow.has(row.key)) continue
            try {
              const note = new Notification(t('notify.title', { what: row.item.title || row.item.code }), {
                body: t('notify.body', { where: row.item.label || '', detail: row.item.detail || '' }),
                tag: 'dsh-tower:' + row.key,
              })
              note.onclick = () => {
                try {
                  window.focus()
                } catch {
                  /* 聚焦失败不阻塞跳转 */
                }
                openPanel()
                openSessionById(ctx, row.item.sessionId)
              }
              notifiedNow.add(row.key)
              seen[row.key] = Date.now()
            } catch {
              /* 弹窗失败不影响面板 */
            }
          }
          writeNotified(seen)
        }, [snapshot, notifyOn])

        const urgent = snapshot.counts.urgent || 0
        const live = snapshot.counts.live || 0
        const hint = t('entry.label') + (urgent > 0 ? ' · ' + t('strip.urgent') + ' ' + urgent : ' · ' + live)
        return h(
          React.Fragment,
          null,
          h('style', null, CSS),
          h(
            'button',
            {
              type: 'button',
              className: 'twr-entry',
              'data-urgent': urgent > 0 ? '1' : '0',
              title: hint,
              'aria-label': hint,
              onClick: openPanel,
            },
            h(Glyph, { size: 13 }),
            urgent > 0 ? h('span', { className: 'twr-entry__badge' }, String(urgent)) : null,
          ),
        )
      }
    }

    /** 按会话 id 打开会话：已核实形态是裸字符串（见 dsh-better-sidebar 调用点）。 */
    function openSessionById(ctx, sessionId) {
      const uiWorkspace = getService(ctx, 'uiWorkspace')
      if (typeof uiWorkspace?.openSession !== 'function') return
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
              makeEntry(t, store, openPanel, ctx),
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
      // 仅供离线测试使用：不参与宿主装配。
      __test: { makePanel, makeTitle, makeEntry, makeT, createStore, notificationCandidates },
    }
  },
})
