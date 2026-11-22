/**
 * 测试跑者：把测试放进**沙箱环境**里跑。
 *
 * 为什么需要它（两次真事故换来的）：
 *   1) 账本的 archive 测试隐式读取开发者本机 ~/.dsh/ledger/pricing.json，
 *      CI 上没有该文件 → 连红三次；
 *   2) 塔台自己也踩过同类：测试若读真实的 $DSH_HOME，本机一旦有 policy.json，
 *      「默认闲置阈值 20 分钟」这类断言就会在本机失败、在 CI 通过（或反过来）。
 *
 * 所以：每个测试进程都拿到**全新的 HOME 与 DSH_HOME**，与开发者机器无关。
 */
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const testsDir = process.argv[2] || 'test'
const only = process.argv[3]

const sandbox = mkdtempSync(join(tmpdir(), 'tower-tests-'))
const home = join(sandbox, 'home')
const dshHome = join(sandbox, 'dsh-home')
const env = Object.assign({}, process.env, {
  HOME: home,
  USERPROFILE: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_CACHE_HOME: join(home, '.cache'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
})
// 沙箱目录要先存在：有些测试会往 HOME 下写
for (const dir of [home, dshHome, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME]) {
  try {
    execFileSync('mkdir', ['-p', dir])
  } catch {
    /* 目录创建失败就让测试自己去暴露 */
  }
}

const files = only ? [only] : readdirSync(testsDir).filter((name) => name.endsWith('.mjs')).sort()
let failed = 0
let assertions = 0

console.log('# 沙箱测试：HOME=' + home + '  DSH_HOME=' + dshHome + '\n')
for (const file of files) {
  const path = join(testsDir, file)
  try {
    const out = execFileSync(process.execPath, [path], { env, encoding: 'utf8', timeout: 120000 })
    const count = (out.match(/^ok  /gm) || []).length
    assertions += count
    console.log('ok   ' + file.padEnd(24) + count + ' 条')
  } catch (error) {
    failed += 1
    const text = String(error.stdout || '') + String(error.stderr || '')
    const bad = text.split('\n').filter((line) => line.startsWith('FAIL')).slice(0, 5)
    console.log('FAIL ' + file)
    for (const line of bad) console.log('       ' + line)
    if (bad.length === 0) console.log('       ' + text.slice(-400).replace(/\n/g, '\n       '))
  }
}

rmSync(sandbox, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'HERMETIC PASSED' : 'HERMETIC FAILED') + ' — ' + files.length + ' 个文件 / ' + assertions + ' 条断言')
process.exit(failed === 0 ? 0 : 1)
