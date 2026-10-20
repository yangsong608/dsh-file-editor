// 自证：客户端产物符合「模块工厂」格式，且没有把 React 之类的宿主模块打包进来。
// 用法：在插件根目录执行 node scripts/verify-client-bundle.mjs
import { readFileSync } from 'node:fs'

const artifact = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const head = artifact.slice(0, 400)
const tail = artifact.slice(-200)

const checks = [
  ['开头是模块加载器登记', head.includes('window.__ModuleLoader__.load(')],
  ['登记 id 是 dsh-file-editor', head.includes('"dsh-file-editor"')],
  ['工厂以 require 为参数', head.includes('factory: (require) =>')],
  ['开头建了 module/exports 壳', head.includes('var module = { exports: {} }')],
  ['结尾把模块导出返回', tail.includes('return module.exports;')],
  ['结尾闭合工厂与登记调用', tail.trimEnd().endsWith('});')],
  ['React 保持外部引用', /require\(["']react["']\)/.test(artifact)],
  ['没有内联 React 实现', !/react\.production|__SECRET_INTERNALS|useSyncExternalStore/.test(artifact)],
  ['没有内联 ReactDOM', !/react-dom/.test(artifact)],
  ['暴露 apply 与 inject', artifact.includes('exports.apply') && artifact.includes('exports.inject')],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed++
}
console.log(failed === 0 ? '客户端产物自证全部通过' : `客户端产物自证 ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
