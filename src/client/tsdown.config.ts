/**
 * 客户端半侧构建配置：复刻仓库的「模块工厂」预置（预设不随产品发布，仓库外自建）。
 * 三行包裹照抄 deepseek-harness/packages/client/tsdown.client.ts:618-624。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/** 本配置放在 src/client/ 下，tsdown 默认以配置文件所在目录为基准；这里钉回包根，入口与产物路径都按包根写。 */
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

/** 基线九项：与宿主模块表一致（deepseek-harness/packages/client/web/src/platform.ts:8-14），只从宿主取，不打包副本。 */
const BASELINE_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

export default defineConfig({
  name: 'dsh-file-editor/client',
  cwd: packageRoot,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: false,
  clean: false,
  deps: { neverBundle: BASELINE_MODULES },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-file-editor", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
