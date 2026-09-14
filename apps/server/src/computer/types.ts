import type { ComputerCapabilities, ComputerStatus, DesktopInputAction } from '@openstaff/shared'

export interface ExecOptions {
  signal?: AbortSignal
  cwd?: string
  timeoutMs?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

export interface FileStat {
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface ProxiedDesktopEndpoints {
  kind: 'proxied'
  cdpUrl: string
  streamUrl: string
  viewer: { user: string; password: string }
  controller: { user: string; password: string }
}

export interface ExternalDesktopEndpoints {
  kind: 'external'
  cdpUrl: string
  viewerUrl(): Promise<string>
  controllerUrl(): Promise<string>
  revoke(): Promise<void>
}

export type DesktopEndpoints = ProxiedDesktopEndpoints | ExternalDesktopEndpoints

export interface DesktopWindow { id: string; title: string; active: boolean }
export interface DesktopCapture { image: Uint8Array; mediaType: 'image/jpeg' | 'image/png'; width: number; height: number }

export interface Computer {
  readonly root: string
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  readFile(filePath: string): Promise<string>
  readFileBytes(filePath: string): Promise<Uint8Array>
  writeFile(filePath: string, contents: string | Uint8Array): Promise<void>
  mkdir(directoryPath: string): Promise<void>
  list(directoryPath: string): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>>
  stat(filePath: string): Promise<FileStat>
}

export interface ManagedComputer extends Computer {
  readonly runtimeCapabilities?: ComputerCapabilities
  readonly notice?: string
  status(): Promise<ComputerStatus>
  desktop?(): Promise<DesktopEndpoints | null>
  captureScreen?(options?: { quality?: number }): Promise<DesktopCapture>
  desktopInput?(action: DesktopInputAction): Promise<void>
  desktopCursor?(): Promise<{ x: number; y: number }>
  desktopWindows?(): Promise<DesktopWindow[]>
  focusDesktopWindow?(input: { id?: string; titleContains?: string }): Promise<void>
  restart(): Promise<void>
  stop?(): Promise<void>
  destroy(): Promise<void>
  close(): Promise<void>
}
