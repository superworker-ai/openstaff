import path from 'node:path'
import Docker from 'dockerode'
import { LocalComputer } from './local.js'
import { assertJailedRealPath, resolveJailedPath } from './path-jail.js'
import { computerEnvironment } from './environment.js'
import { desktopPasswords, type DesktopPasswords } from './desktop-secrets.js'
import { execDocker } from './docker-exec.js'
import { DockerComputerError, dockerDiagnostic } from './docker-errors.js'
import type { ExecOptions, ExecResult, ProxiedDesktopEndpoints } from './types.js'

export function dockerClient(): Docker {
  const value = process.env.DOCKER_HOST
  if (!value) return new Docker()
  const url = new URL(value)
  return new Docker({ host: url.hostname, port: Number(url.port || 2375), protocol: url.protocol === 'https:' ? 'https' : 'http' })
}

export class DockerComputer extends LocalComputer {
  private starting?: Promise<Docker.Container>
  private endpointCache?: { containerId: string; cdpUrl: string; streamUrl: string }
  private lastError?: DockerComputerError
  constructor(root: string, private readonly docker = dockerClient(), private readonly name = 'superworkers-computer', private readonly configuredPasswords?: DesktopPasswords) { super(root) }
  protected async ensure(): Promise<Docker.Container> {
    if (this.starting) return this.starting
    this.starting = this.ensureContainer().then((container) => { this.lastError = undefined; return container }).catch((error: unknown) => {
      if (error instanceof DockerComputerError) this.lastError = error
      throw error
    }).finally(() => { this.starting = undefined })
    return this.starting
  }
  private async ensureContainer(): Promise<Docker.Container> {
    let container = this.docker.getContainer(this.name)
    let info: Docker.ContainerInspectInfo | undefined
    try { info = await container.inspect() } catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error }
    const workspaceSetting = process.env.COMPUTER_WORKSPACE_VOLUME
    const workspaceHostPath = workspaceSetting?.startsWith('bind:') ? workspaceSetting.slice('bind:'.length) : undefined
    const workspaceVolume = workspaceHostPath ? undefined : workspaceSetting
    const devMode = !workspaceVolume && !workspaceHostPath
    const image = process.env.COMPUTER_IMAGE ?? 'superworkers/computer:local'
    if (info) {
      this.assertWorkspace(info)
      // Compare image ids too: a rebuilt image keeps the same tag but the container still runs the old layers.
      const imageId = await this.docker.getImage?.(image).inspect().then((detail) => detail.Id).catch(() => undefined)
      const reason = info.Config.Labels?.['superworkers.desktop'] !== '1'
        ? 'desktop label is missing'
        : info.Config.Image !== image
          ? 'configured image changed'
          : imageId && info.Image !== imageId
            ? 'image was rebuilt'
          : devMode && !info.HostConfig.PortBindings?.['9222/tcp']?.length
            ? 'CDP host port binding is missing'
            : undefined
      if (reason) {
        console.info(`Recreating computer container: ${reason}`)
        try { await container.stop({ t: 10 }) } catch (error) { if ((error as { statusCode?: number }).statusCode !== 304) throw error }
        await container.remove()
        this.endpointCache = undefined
        info = undefined
      }
    }
    if (!info) {
      const passwords = this.configuredPasswords ?? await desktopPasswords(path.dirname(this.root))
      const mounts: Docker.MountSettings[] = [
        ...(workspaceVolume ? [{ Type: 'volume' as const, Source: workspaceVolume, Target: '/workspace', VolumeOptions: { Subpath: 'workspace' } as Docker.MountSettings['VolumeOptions'] }] : []),
        { Type: 'volume', Source: process.env.COMPUTER_HOME_VOLUME ?? 'superworkers-home', Target: '/home/worker' },
      ]
      const environment = [
        `COMPUTER_VIEWER_PASSWORD=${passwords.viewer}`,
        `COMPUTER_CONTROLLER_PASSWORD=${passwords.controller}`,
        ...(process.env.COMPUTER_CHROME_NO_SANDBOX === '1' ? ['COMPUTER_CHROME_NO_SANDBOX=1'] : []),
      ]
      try {
        container = await this.docker.createContainer({
          name: this.name,
          Image: image,
          WorkingDir: '/workspace',
          Env: environment,
          Labels: { 'superworkers.workspace': this.root, 'superworkers.desktop': '1' },
          ...(devMode ? { ExposedPorts: { '9222/tcp': {}, '6901/tcp': {} } } : {}),
          HostConfig: {
            ...(!devMode ? workspaceHostPath ? { Binds: [`${workspaceHostPath}:/workspace`] } : {} : { Binds: [`${this.root}:/workspace`] }),
            Mounts: mounts,
            ...(devMode ? { PortBindings: {
              '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }],
              '6901/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }],
            } } : {}),
            NetworkMode: process.env.COMPUTER_NETWORK ?? 'bridge',
            ShmSize: 1024 ** 3,
            Memory: 4 * 1024 ** 3,
            PidsLimit: 2048,
            Privileged: false,
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges'],
            RestartPolicy: { Name: 'unless-stopped' },
          },
        })
        this.endpointCache = undefined
      } catch (error) {
        const safe = dockerDiagnostic(error, 'Computer container could not be created')
        const diagnostic = (error as { statusCode?: number }).statusCode === 404 && safe !== 'Computer network is missing'
          ? `Computer image ${image} not found; run pnpm computer:build`
          : safe
        throw new DockerComputerError(diagnostic)
      }
    }
    info = await container.inspect()
    this.assertWorkspace(info)
    if (!info.State.Running) { await container.start(); this.endpointCache = undefined }
    return container
  }
  private assertWorkspace(info: Docker.ContainerInspectInfo) {
    const mount = info.Mounts.find((item) => item.Destination === '/workspace')
    // Refuse an unrelated pre-existing computer instead of taking it over.
    const workspaceSetting = process.env.COMPUTER_WORKSPACE_VOLUME
    const sharedCompose = workspaceSetting?.startsWith('bind:')
      ? mount?.Source === workspaceSetting.slice('bind:'.length)
      : workspaceSetting && mount?.Name === workspaceSetting
    if (mount?.Source !== this.root && !sharedCompose) throw new DockerComputerError('Computer container belongs to a different workspace')
  }
  protected async pingDaemon(): Promise<void> { await this.docker.ping() }
  async restart(): Promise<void> { this.endpointCache = undefined; await (await this.ensure()).restart(); this.endpointCache = undefined }
  async stop(): Promise<void> { await (await this.ensure()).stop() }
  async destroy(): Promise<void> { await (await this.ensure()).remove({ force: true }) }
  async containerStatus(): Promise<'ready' | 'paused' | 'stopped'> {
    try {
      const info = await this.docker.getContainer(this.name).inspect()
      this.assertWorkspace(info)
      return info.State.Paused ? 'paused' : info.State.Running ? 'ready' : 'stopped'
    } catch (error) { if ((error as { statusCode?: number }).statusCode === 404) { if (this.lastError) throw this.lastError; return 'stopped' } throw error }
  }
  protected async desktopEndpoints(): Promise<ProxiedDesktopEndpoints> {
    const container = await this.ensure()
    const info = await container.inspect()
    if (!this.endpointCache || this.endpointCache.containerId !== info.Id) {
      const hostPort = (port: string) => info.NetworkSettings.Ports?.[`${port}/tcp`]?.[0]?.HostPort
      this.endpointCache = {
        containerId: info.Id,
        cdpUrl: hostPort('9222') ? `http://127.0.0.1:${hostPort('9222')}` : `http://${this.name}:9222`,
        streamUrl: hostPort('6901') ? `http://127.0.0.1:${hostPort('6901')}` : `http://${this.name}:6901`,
      }
    }
    const passwords = this.configuredPasswords ?? await desktopPasswords(path.dirname(this.root))
    return {
      kind: 'proxied',
      cdpUrl: process.env.COMPUTER_CDP_URL ?? this.endpointCache.cdpUrl,
      streamUrl: process.env.COMPUTER_DESKTOP_URL ?? this.endpointCache.streamUrl,
      viewer: { user: 'viewer', password: passwords.viewer },
      controller: { user: 'controller', password: passwords.controller },
    }
  }
  override async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const hostCwd = resolveJailedPath(this.root, options.cwd ?? '.')
    await assertJailedRealPath(this.root, hostCwd)
    return execDocker(await this.ensure(), command, path.posix.join('/workspace', path.relative(this.root, hostCwd)), computerEnvironment('/workspace', true, '/home/worker'), options.timeoutMs ?? 120_000, options.signal)
  }
}
