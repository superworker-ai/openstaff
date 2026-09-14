export function computerEnvironment(root: string, docker = false, home = root): Record<string, string> {
  const env: Record<string, string> = { PATH: docker ? '/usr/local/bin:/usr/bin:/bin' : process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: process.env.LANG ?? 'C.UTF-8', TERM: 'dumb' }
  for (const [name, value] of Object.entries(process.env)) if (name.startsWith('COMPUTER_ENV_') && value !== undefined) env[name.slice(13)] = value
  return env
}
