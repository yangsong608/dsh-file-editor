/**
 * 宿主半侧：给编辑器面板提供读接口（列目录、读文件、取版本）。
 *
 * 通道走 Typert 网关的保守（源码标记）路径：类原型上写版本化标记、实例上挂 typertRemote
 * 绑定、服务用 ctx.provide 注册；网关扫到即认领 /api 的 <namespace>/<method>，不需要跑
 * 生成器（生成器要求仓库内的工作区形状，第三方插件复刻不了；定案理由见验证记录三）。
 */

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const SERVICE_KEY = 'fileEditor'
const NAMESPACE = 'file-editor'

/** 只声明用到的文件服务成员，验证期先不引宿主内部类型包。 */
interface FsTargetFace {
  displayPath: string
}

interface FsInfoFace {
  version: string
  type: string
  size?: number
}

interface FsDirEntryFace {
  name: string
  type: string
  target: FsTargetFace
  version?: string
  size?: number
}

type WriteIntentFace =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: string }

interface WriteOutcomeFace {
  operation: 'create' | 'update'
  version: string
}

interface WritePolicyFace {
  mode: string
  workspaceRoot: string
}

interface FileSystemFace {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetFace>
  processPath(target: FsTargetFace): string
  stat(target: FsTargetFace, signal?: AbortSignal): Promise<FsInfoFace | undefined>
  listDir(target: FsTargetFace, signal?: AbortSignal): Promise<readonly FsDirEntryFace[]>
  readText(target: FsTargetFace, signal?: AbortSignal): Promise<string>
  writeText(
    target: FsTargetFace,
    content: string,
    expected?: WriteIntentFace,
    signal?: AbortSignal,
    sandboxPolicy?: WritePolicyFace,
  ): Promise<WriteOutcomeFace>
}

interface SandboxPolicyFace {
  resolve(request?: { mode?: string }): { mode: string; workspaceRoot: string }
}

interface HostContext {
  fs: FileSystemFace
  sandboxPolicy: SandboxPolicyFace
  provide(name: string, value: unknown): unknown
}

/** 返回给界面的目录项，全部 JSON 可表示。 */
export interface DirectoryEntry {
  name: string
  type: string
  path: string
  displayPath: string
  version: string | null
  size: number | null
}

/** 读文件的结果：内容加当时的版本标记。 */
export interface FileReadout {
  path: string
  content: string
  version: string
}

/** 写文件的结果：这次是新建还是覆盖、写后的新版本。 */
export interface FileWriteout {
  path: string
  operation: 'create' | 'update'
  version: string
}

/** 取版本的结果。 */
export interface PathStat {
  path: string
  type: string
  version: string | null
  size: number | null
}

export class FileEditorService {
  readonly typertRemote: { service: FileEditorService; serviceKey: string; namespace: string }

  readonly #ctx: HostContext

  constructor(ctx: HostContext) {
    this.#ctx = ctx
    this.typertRemote = Object.freeze({ service: this, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  }

  /** 宿主进程的工作目录。 */
  async cwd(): Promise<string> {
    return process.cwd()
  }

  /** 列出一个目录的直接子项（只取元数据，不读文件内容）。 */
  async listDir(path: string, signal?: AbortSignal): Promise<DirectoryEntry[]> {
    const fs = this.#ctx.fs
    const target = await fs.resolve(path, { signal })
    const entries = await fs.listDir(target, signal)
    return entries.map(entry => ({
      name: entry.name,
      type: entry.type,
      path: fs.processPath(entry.target),
      displayPath: entry.target.displayPath,
      version: entry.version ?? null,
      size: entry.size ?? null,
    }))
  }

  /** 读一个文本文件的内容与版本标记。 */
  async readText(path: string, signal?: AbortSignal): Promise<FileReadout> {
    const fs = this.#ctx.fs
    const target = await fs.resolve(path, { signal })
    const info = await fs.stat(target, signal)
    if (info === undefined) throw new Error(`文件不存在：${path}`)
    if (info.type !== 'file') throw new Error(`不是常规文件：${path}（${info.type}）`)
    const content = await fs.readText(target, signal)
    return { path: fs.processPath(target), content, version: info.version }
  }

  /** 取一个路径的类型与版本标记。 */
  async stat(path: string, signal?: AbortSignal): Promise<PathStat> {
    const fs = this.#ctx.fs
    const target = await fs.resolve(path, { signal })
    const info = await fs.stat(target, signal)
    return {
      path: fs.processPath(target),
      type: info?.type ?? 'missing',
      version: info?.version ?? null,
      size: info?.size ?? null,
    }
  }

  /**
   * 带守卫地写一个文本文件：expectedVersion 为字符串时要求版本相符，为 null 时要求文件不存在。
   * sandboxRoot 为 null 时按桌面版默认沙箱口径写入；给了路径则按「该路径为工作区根、模式取默认」的逐调用策略写入
   * （验证四第二段的探测口；第一期要换成从桌面版的工作区模型解析根，不由调用方随意声明）。
   */
  async writeText(
    path: string,
    content: string,
    expectedVersion: string | null,
    sandboxRoot: string | null,
    signal?: AbortSignal,
  ): Promise<FileWriteout> {
    const fs = this.#ctx.fs
    const target = await fs.resolve(path, { signal })
    const expected: WriteIntentFace = expectedVersion === null
      ? { kind: 'createIfAbsent' }
      : { kind: 'replaceIfVersion', version: expectedVersion }
    const policy: WritePolicyFace | undefined = sandboxRoot === null
      ? undefined
      : { mode: this.#ctx.sandboxPolicy.resolve().mode, workspaceRoot: sandboxRoot }
    const outcome = await fs.writeText(target, content, expected, signal, policy)
    return { path: fs.processPath(target), operation: outcome.operation, version: outcome.version }
  }
}

Object.defineProperty(FileEditorService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: 'cwd', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'listDir', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'readText', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'stat', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'writeText', invocation: Object.freeze({ kind: 'direct' }) }),
    ]),
  }),
})

export const inject = ['fs', 'sandboxPolicy']

export function apply(ctx: HostContext): void {
  ctx.provide(SERVICE_KEY, new FileEditorService(ctx))
  console.log('[file-editor] host half loaded')
}
