/**
 * 宿主半侧构建配置：ESM、node 平台，产物 lib/index.js。
 * 不压缩——网关从函数签名读参数名，压缩会破坏它。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/** 同客户端配置：tsdown 以配置文件所在目录为基准，这里钉回包根。 */
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  name: 'dsh-file-editor/host',
  cwd: packageRoot,
  entry: { index: 'src/host/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: false,
  sourcemap: false,
  clean: false,
  outputOptions: { entryFileNames: 'index.js' },
})
