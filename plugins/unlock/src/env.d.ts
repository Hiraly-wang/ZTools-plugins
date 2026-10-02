/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export type TabType = 'unlock' | 'shredder' | 'port'

export interface WhySource {
  type: string
  name: string
  description: string
  unitFile?: string
  details?: Record<string, string> | null
}

export interface AncestryNode {
  pid: number
  name: string
  ppid?: number
  exe?: string
  cmd?: string
}

export interface WitrSocket {
  port: number
  address: string
  state: string
  protocol: string
}

/** Full witr-style Result: causal chain + source + context. */
export interface WhyInfo {
  engine: 'witr' | 'native'
  target?: { type: string; value: string }
  resolvedTarget?: string
  process?: {
    pid: number
    ppid: number
    command: string
    cmdLine: string
    exe: string
    startedAt?: string
    user?: string
    workingDir?: string
    gitRepo?: string
    gitBranch?: string
    container?: string
    service?: string
    health?: string
    deleted?: boolean
  }
  restartCount?: number
  ancestry: AncestryNode[]
  ancestryText: string
  source: WhySource
  /** Human form: `Name (type)` e.g. `pwsh.exe (shell)` */
  sourceLine?: string
  warnings: string[]
  workingDir: string
  cmdLine: string
  gitRepo?: string
  gitBranch?: string
  user?: string
  startedAt?: string
  sockets?: WitrSocket[]
  children?: AncestryNode[]
}

export interface ProcessInfo {
  pid: number
  name: string
  exePath: string
  /** How the holder was confirmed */
  detectSource?: 'witr' | 'resourcemanager' | string
  confidence?: 'high' | 'medium' | 'low'
  source?: string
  reason?: string
  cmdLine?: string
  user?: string
  startedAt?: string
  /** Windows 服务短名（重启管理器可提供） */
  service?: string
  score?: number
  why?: WhyInfo
}

/** 提示级别：决定前端提示条的颜色与语气 */
export type MessageLevel = 'success' | 'info' | 'warning' | 'error'

export interface LockScanResult {
  locked: boolean | null
  /** 文件当前能否被独占打开；null = 无法确认（例如文件夹） */
  blocked?: boolean | null
  /** 占用者数量 */
  holders?: number
  /** 路径状态：locked / free / directory / missing / unknown */
  state?: string
  processes: ProcessInfo[]
  note?: string
  noteLevel?: MessageLevel
  engine: string
}

export interface OperationResult {
  success: boolean
  message: string
  level?: MessageLevel
}

export interface KillResult extends OperationResult {
  /** 结束进程后是否确认占用已解除；null = 无法确认 */
  released?: boolean | null
  needsAdmin?: boolean
  alreadyGone?: boolean
  killed?: number
  failed?: number
}

export interface ReleaseVerifyResult {
  released: boolean | null
  state: string
  attempts: number
  elapsedMs: number
}

export interface PortInfo {
  pid: number
  processName: string
  exePath: string
  protocol: 'TCP' | 'UDP'
  state: string
  localAddress: string
  localPort: number
  why?: WhyInfo
}

export interface ShredderResult extends OperationResult {
  filesProcessed?: number
  locked?: boolean
  /** 失败原因是权限不足（此时不必去查找占用进程） */
  permissionDenied?: boolean
}

export interface Services {
  findLockingProcesses: (filePath: string) => Promise<LockScanResult>
  killProcess: (pid: number, name?: string) => Promise<KillResult>
  /** 结束单个占用进程并验证占用是否真的解除 */
  killLockingProcess: (filePath: string, pid: number, name?: string) => Promise<KillResult>
  /** 一键结束全部占用进程并统一验证 */
  killAllLockingProcesses: (filePath: string, procs: ProcessInfo[]) => Promise<KillResult>
  verifyRelease: (filePath: string) => Promise<ReleaseVerifyResult>
  killPortProcess: (port: number, pid: number, name?: string) => Promise<KillResult>
  killAllPortProcesses: (port: number, entries: PortInfo[]) => Promise<KillResult>
  shredPath: (filePath: string, mode: 'delete' | 'shred') => Promise<ShredderResult>
  findPortProcess: (port: number) => Promise<PortInfo[]>
  explainPid: (pid: number) => Promise<WhyInfo | null>
  getWhyEngine: () => 'witr' | 'native'
  getDebugLog: () => string[]
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi & { getPathForFile(file: File): string }
  }
}

export {}
