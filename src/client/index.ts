/**
 * 客户端半侧：主列「编辑器」面板——从宿主读目录、读文件、看版本标记；侧栏入口与面板共用同一个 key。
 * 与宿主的通信走 Connection 的 /api 通道（通道定案见验证记录三）。
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'

const PANEL_ID = 'file-editor'
const NAMESPACE = 'file-editor'
const API_CHANNEL = '/api'

/** 只声明用到的插槽与连接接口，验证期先不引宿主内部类型包。 */
interface SlotsFace {
  inject(slot: string, contribute: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}

interface RpcFailure {
  code?: string
  message?: string
}

interface RpcOutcome {
  ok: boolean
  value?: unknown
  error?: RpcFailure
}

interface ConnectionFace {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcOutcome>
  }
}

interface ClientContext {
  slots: SlotsFace
  connection: ConnectionFace
}

/** 宿主返回的目录项。 */
interface DirectoryEntry {
  name: string
  type: string
  path: string
  displayPath: string
  version: string | null
  size: number | null
}

/** 宿主返回的文件内容。 */
interface FileReadout {
  path: string
  content: string
  version: string
}

/** 宿主写入文件的结果。 */
interface FileWriteout {
  path: string
  operation: 'create' | 'update'
  version: string
}

type HostCall = (method: string, args: Record<string, unknown>) => Promise<unknown>

/** 调一次宿主方法；失败按网关错误码如实抛出。 */
async function callHost(ctx: ClientContext, method: string, args: Record<string, unknown>): Promise<unknown> {
  const outcome = await ctx.connection.rpc.call(API_CHANNEL, `${NAMESPACE}/${method}`, { args })
  if (outcome.ok !== true) {
    const failure = outcome.error ?? {}
    throw new Error(`${failure.code ?? 'gateway/unknown'}: ${failure.message ?? '远程调用失败'}`)
  }
  return outcome.value
}

const panelStyle = { display: 'flex', flexDirection: 'column' as const, gap: '8px', padding: '12px', height: '100%', boxSizing: 'border-box' as const, fontSize: '13px' }
const rowStyle = { display: 'flex', gap: '8px', alignItems: 'center' }
const inputStyle = { flex: '1', padding: '4px 8px', fontSize: '13px' }
const buttonStyle = { padding: '4px 12px', fontSize: '13px' }
const columnsStyle = { display: 'flex', gap: '12px', flex: '1', minHeight: '0' }
const listStyle = { flex: '0 0 320px', overflow: 'auto' as const, border: '1px solid rgba(128,128,128,0.35)', borderRadius: '6px', padding: '4px' }
const entryStyle = { display: 'block', width: '100%', textAlign: 'left' as const, padding: '3px 6px', fontSize: '13px', background: 'transparent', border: 'none', color: 'inherit' }
const contentStyle = { flex: '1', overflow: 'auto' as const, border: '1px solid rgba(128,128,128,0.35)', borderRadius: '6px', padding: '8px', whiteSpace: 'pre-wrap' as const, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }
const errorStyle = { color: '#c0392b', whiteSpace: 'pre-wrap' as const }
const metaStyle = { opacity: 0.7, fontSize: '12px' }
const noticeStyle = { color: '#1e8449', fontSize: '12px' }

/** 按扩展名挑语言扩展；验证期只有 JavaScript 系与 JSON 两种。 */
function languageFor(path: string): unknown {
  if (/\.(mjs|cjs|js|jsx|ts|tsx)$/i.test(path)) return javascript({ jsx: true, typescript: true })
  if (/\.json$/i.test(path)) return json()
  return null
}

/** CodeMirror 6 编辑区：挂载一次，外部换文件时全量替换文档。 */
function CodeArea(props: { path: string; value: string; onChange: (value: string) => void }): unknown {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(props.onChange)
  onChangeRef.current = props.onChange

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const language = languageFor(props.path)
    const view = new EditorView({
      doc: props.value,
      parent: host,
      extensions: [
        basicSetup,
        ...(language === null ? [] : [language]),
        EditorView.theme({
          '&': { backgroundColor: 'transparent', color: 'inherit', fontSize: '12px' },
          '.cm-gutters': { backgroundColor: 'transparent', color: 'inherit', opacity: '0.6' },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
      ],
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [props.path])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    if (view.state.doc.toString() !== props.value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } })
    }
  }, [props.value])

  return createElement('div', { ref: hostRef, style: { flex: '1', minHeight: '160px', overflow: 'auto', border: '1px solid rgba(128,128,128,0.25)', borderRadius: '4px' } })
}

interface EditorPanelProps {
  call?: HostCall
}

/** 面板：上行是路径输入与两个按钮，下面左目录右编辑区。 */
function EditorPanel(props: EditorPanelProps): unknown {
  const call = props.call
  const [pathText, setPathText] = useState('')
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [file, setFile] = useState<FileReadout | null>(null)
  const [draft, setDraft] = useState('')
  const [sandboxRoot, setSandboxRoot] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const list = useCallback(async (target: string): Promise<void> => {
    if (call === undefined) return
    setBusy(true)
    setError('')
    setFile(null)
    try {
      const result = await call('listDir', { path: target }) as DirectoryEntry[]
      setEntries(result)
      setPathText(target)
    } catch (cause) {
      setEntries([])
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [call])

  useEffect(() => {
    if (call === undefined) return
    void (async () => {
      try {
        const cwd = await call('cwd', {}) as string
        await list(cwd)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [call, list])

  const openFile = useCallback(async (entry: DirectoryEntry): Promise<void> => {
    if (call === undefined) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const readout = await call('readText', { path: entry.path }) as FileReadout
      setFile(readout)
      setDraft(readout.content)
    } catch (cause) {
      setFile(null)
      setDraft('')
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [call])

  const save = useCallback(async (): Promise<void> => {
    if (call === undefined || file === null) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const outcome = await call('writeText', {
        path: file.path,
        content: draft,
        expectedVersion: file.version,
        sandboxRoot: sandboxRoot.trim() === '' ? null : sandboxRoot.trim(),
      }) as FileWriteout
      setFile({ path: outcome.path, content: draft, version: outcome.version })
      setNotice(outcome.operation === 'create' ? '已新建保存' : '已保存')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [call, file, draft])

  const parentOf = (target: string): string => {
    const trimmed = target.endsWith('/') ? target.slice(0, -1) : target
    if (trimmed === '') return '/'
    const cut = trimmed.lastIndexOf('/')
    return cut <= 0 ? '/' : trimmed.slice(0, cut)
  }

  return createElement('div', { style: panelStyle },
    createElement('div', { style: rowStyle },
      createElement('input', {
        style: inputStyle,
        value: pathText,
        placeholder: '目录或文件路径',
        onChange: (event: { currentTarget: { value: string } }) => setPathText(event.currentTarget.value),
        onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') void list(pathText) },
      }),
      createElement('button', { style: buttonStyle, onClick: () => { void list(pathText) } }, '打开'),
      createElement('button', { style: buttonStyle, onClick: () => { void list(parentOf(pathText)) } }, '上一层'),
      busy ? createElement('span', { style: metaStyle }, '读取中') : null,
    ),
    error === '' ? null : createElement('div', { style: errorStyle }, error),
    createElement('div', { style: columnsStyle },
      createElement('div', { style: listStyle },
        entries.map(entry => createElement('button', {
          key: entry.path,
          style: entryStyle,
          title: entry.path,
          onClick: () => { if (entry.type === 'directory') void list(entry.path); else void openFile(entry) },
        }, `${entry.type === 'directory' ? '[目录]' : '[文件]'} ${entry.name}`)),
      ),
      createElement('div', { style: contentStyle },
        file === null
          ? createElement('span', { style: metaStyle }, '点左侧文件打开，这里显示内容与版本标记')
          : createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, height: '100%', gap: '4px' } },
            createElement('div', { style: metaStyle }, `${file.path}（版本 ${file.version}）`),
            createElement('div', { style: rowStyle },
              createElement('button', { style: buttonStyle, onClick: () => { void save() } }, '保存'),
              createElement('input', {
                style: { ...inputStyle, flex: '0 1 320px', fontSize: '12px' },
                value: sandboxRoot,
                placeholder: '工作区根（留空按默认口径）',
                onChange: (event: { currentTarget: { value: string } }) => setSandboxRoot(event.currentTarget.value),
              }),
              notice === '' ? null : createElement('span', { style: noticeStyle }, notice),
            ),
            createElement(CodeArea, { path: file.path, value: draft, onChange: setDraft }),
          ),
      ),
    ),
  )
}

/** 侧栏入口图标：先放一个方块。 */
function EditorPanelIcon(): unknown {
  return createElement('span', {
    style: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '1.5px solid currentColor',
      borderRadius: '3px',
    },
  })
}

export const inject = ['slots', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    inject: () => ({ call: (method: string, args: Record<string, unknown>) => callHost(ctx, method, args) }),
  }, EditorPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 100,
    label: () => '编辑器',
  }, EditorPanelIcon))
}
