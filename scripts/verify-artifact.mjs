/**
 * 产物验收：把「从 npm 装出来的那一份」当成验收对象。
 *
 * 仓库里测试全绿，不代表发出去的包是对的——少一个文件、patch 指错、client 入口
 * 带了 import，都会让用户在装完之后看到「插件没出现」。这个脚本只跑产物本身。
 *
 * 用法：
 *   node scripts/verify-artifact.mjs --artifact /tmp/x/node_modules/dsh-plugin-tower --tests ./test
 *
 * 检查项：
 *   1) manifest：名字/版本/入口/icon/locale/patch，且不含任何账本依赖（隔离）
 *   2) patch：insert 行的 name 必须等于包名
 *   3) index.js：语法、apply/inject 导出、能在 Node 里真正 import 成功
 *   4) client.js：classic script 形态（无 import/export）、__ModuleLoader__ 入口、id 正确
 *   5) 资源：icon 可解析、locale 有 meta
 *   6) 把仓库测试拷进产物目录跑一遍（验证的是「发出去的代码」）
 */
import { existsSync, readFileSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
/**
 * --pack：直接从仓库打包出一个 tarball 再验收（不联网、不依赖 registry）。
 * 这是发布前最该跑的形式：验的是「即将发出去的那份」。
 */
const wantPack = args.includes('--pack')
let packedRoot = null
if (wantPack) {
  const tmp = join(process.env.TMPDIR || '/tmp', 'tower-artifact-' + process.pid)
  mkdirSync(tmp, { recursive: true })
  // 打包器回退：显式指定的 → pnpm → npm。CI 里两者可能只装了一个。
  const attempts = [process.env.PNPM_BIN, 'pnpm', 'npm'].filter(Boolean)
  let packed = false
  let lastError = null
  for (const bin of attempts) {
    try {
      execFileSync(bin, ['pack', '--pack-destination', tmp], { stdio: 'pipe' })
      packed = true
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!packed) {
    console.error('打包失败：pnpm 与 npm 都不可用 → ' + String(lastError && lastError.message).slice(0, 120))
    process.exit(2)
  }
  const tarball = readdirSync(tmp).find((name) => name.endsWith('.tgz'))
  if (!tarball) {
    console.error('pack 失败：没有生成 tarball')
    process.exit(2)
  }
  execFileSync('tar', ['-xzf', join(tmp, tarball), '-C', tmp], { stdio: 'pipe' })
  packedRoot = join(tmp, 'package')
  console.log('# 打包产物：' + tarball + '\n')
}

const artifact = resolve(packedRoot || argOf('artifact', ''))
const testsDir = resolve(argOf('tests', 'test'))

let failures = 0
const ok = (label) => console.log('ok   ' + label)
const bad = (label, detail) => {
  failures += 1
  console.log('FAIL ' + label + (detail ? '  → ' + detail : ''))
}
const check = (condition, label, detail) => (condition ? ok(label) : bad(label, detail))

if (!artifact || !existsSync(artifact)) {
  console.error('artifact 目录不存在：' + artifact)
  process.exit(2)
}
// 缺文件要在解析任何内容之前就报出来，否则脚本会以未捕获异常的形式崩掉——
// 闸门必须「清晰地失败」，而不是「看起来崩了」。
const required = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/zh.json', 'locale/en.json']
const missing = required.filter((file) => !existsSync(join(artifact, file)))
if (missing.length > 0) {
  console.error('FAIL 产物缺文件：' + missing.join(', '))
  console.error('ARTIFACT FAILED (缺文件)')
  process.exit(1)
}

console.log('# 产物验收：' + artifact + '\n')

// ---------- 1) manifest ----------
const pkgPath = join(artifact, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
check(pkg.name === 'dsh-plugin-tower', 'manifest.name = dsh-plugin-tower', pkg.name)
check(/^\d+\.\d+\.\d+/.test(pkg.version || ''), 'manifest.version 形如 x.y.z', pkg.version)
check(pkg.private !== true, 'manifest 不是 private')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch 指向 cordis.patch.yml')
check(existsSync(join(artifact, pkg.dsh?.bundle?.patch || 'cordis.patch.yml')), 'patch 文件真实存在')
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform = web')
check(Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.length > 0, 'dsh.client.inject 非空')
check(pkg.exports?.['.'] === './index.js' && pkg.exports?.['./client'] === './client.js', 'exports 有 . 与 ./client')
check(typeof pkg.exports?.['./locale/*.json'] === 'string', 'exports 暴露 locale')
check(typeof pkg.exports?.['./icon'] === 'string', 'exports 暴露 icon')
check(existsSync(join(artifact, 'icon.svg')), 'icon.svg 存在')
const deps = Object.assign({}, pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies)
check(!Object.keys(deps).some((name) => name.includes('ledger')), '不依赖账本（插件隔离）')

// ---------- 2) patch ----------
const patch = readFileSync(join(artifact, 'cordis.patch.yml'), 'utf8')
check(/-\s*insert:/.test(patch), 'patch 含 insert')
check(patch.includes("name: 'dsh-plugin-tower'") || patch.includes('name: "dsh-plugin-tower"') || patch.includes('name: dsh-plugin-tower'), 'patch 的 name 与包名一致')
check(/id:\s*dsh-tower/.test(patch), 'patch 行 id = dsh-tower')

// ---------- 3) index.js ----------
const hostSrc = readFileSync(join(artifact, 'index.js'), 'utf8')
try {
  execFileSync(process.execPath, ['--check', join(artifact, 'index.js')], { stdio: 'pipe' })
  ok('index.js 语法通过')
} catch (error) {
  bad('index.js 语法通过', String(error.stderr || error.message).slice(0, 120))
}
check(/export\s+function\s+apply/.test(hostSrc), 'Host 导出 apply')
check(/export\s+const\s+inject\s*=\s*\['webServer'\]/.test(hostSrc), "Host inject = ['webServer']")
check(!hostSrc.includes('@lingda-ai'), 'Host 源码不出现账本包名')
const mod = await import(pathToFileURL(join(artifact, 'index.js')).href)
check(typeof mod.apply === 'function', 'Host 模块可被 Node 真正 import')
check(typeof mod.__internal?.buildShiftReport === 'function', '产物内含 报告/审计 等实现')
check(typeof mod.__internal?.readLedgerCosts === 'function', '产物内含 账本读取器')

// ---------- 4) client.js ----------
const clientSrc = readFileSync(join(artifact, 'client.js'), 'utf8')
// 注释里提到加载器是允许的（文档会写），所以先剥注释再判断
const clientCode = clientSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')
const firstStatement = clientCode.trimStart()
check(firstStatement.startsWith('window.__ModuleLoader__.load('), 'client 第一条语句是 __ModuleLoader__.load')
check((clientCode.match(/window\.__ModuleLoader__\.load\(/g) || []).length === 1, 'client 只调用一次 __ModuleLoader__.load')
check(/^import\s/m.test(clientSrc) === false && /^export\s/m.test(clientSrc) === false, 'client 无 import/export（classic script）')
check(clientSrc.includes("id: 'dsh-plugin-tower'"), 'client 模块 id 正确')
check(clientSrc.includes('tower.supervision'), 'client 注册 tower.supervision 类型')
check(!clientSrc.includes('@lingda-ai'), 'client 源码不出现账本包名')
try {
  execFileSync(process.execPath, ['--check', join(artifact, 'client.js')], { stdio: 'pipe' })
  ok('client.js 语法通过')
} catch (error) {
  bad('client.js 语法通过', String(error.stderr || error.message).slice(0, 120))
}

// ---------- 5) 资源 ----------
for (const locale of ['zh', 'en']) {
  const file = join(artifact, 'locale', locale + '.json')
  try {
    const dict = JSON.parse(readFileSync(file, 'utf8'))
    check(Boolean(dict.meta?.title && dict.meta?.description), 'locale/' + locale + ' 有 meta', JSON.stringify(dict.meta))
  } catch (error) {
    bad('locale/' + locale + ' 可解析', String(error.message).slice(0, 80))
  }
}
const icon = readFileSync(join(artifact, 'icon.svg'), 'utf8')
check(icon.includes('<svg') && icon.length < 256 * 1024, 'icon.svg 是 SVG 且 < 256KiB', String(icon.length))

// ---------- 6) 把仓库测试拷进产物跑 ----------
if (existsSync(testsDir)) {
  const target = join(artifact, '__tests__')
  mkdirSync(target, { recursive: true })
  const files = readdirSync(testsDir).filter((name) => name.endsWith('.mjs'))
  for (const file of files) copyFileSync(join(testsDir, file), join(target, file))
  let passed = 0
  for (const file of files) {
    try {
      execFileSync(process.execPath, [join('__tests__', file)], { cwd: artifact, stdio: 'pipe', timeout: 60000 })
      passed += 1
    } catch (error) {
      bad('产物内运行 ' + file, String(error.stdout || error.message).slice(0, 160))
    }
  }
  if (passed === files.length) ok('产物内运行 ' + files.length + ' 个测试文件全部通过')
} else {
  console.log('（跳过产物内测试：未找到 tests 目录）')
}

console.log('\n' + (failures === 0 ? 'ARTIFACT PASSED' : 'ARTIFACT FAILED (' + failures + ' 项)'))
process.exit(failures === 0 ? 0 : 1)
