// Only messages constructed here may cross the Docker API boundary. Dockerode
// error bodies can contain bind paths, request headers, or container credentials.
export class DockerComputerError extends Error {}

export function dockerDiagnostic(error: unknown, fallback = 'Computer container status could not be read'): string {
  if (error instanceof DockerComputerError) return error.message
  const status = (error as { statusCode?: number } | null)?.statusCode
  if (status === 401 || status === 403) return 'Docker daemon denied access'
  if (status === 404) {
    const message = error instanceof Error ? error.message : ''
    if (/no such image/i.test(message)) return 'Computer image is missing'
    if (/network .*not found/i.test(message)) return 'Computer network is missing'
    return 'Docker resource was not found'
  }
  if (status === 409) return 'Computer container conflicts with an existing Docker resource'
  if (status === 400) return 'Docker rejected the Computer container configuration'
  if (status && status >= 500) return 'Docker daemon could not complete the Computer operation'
  return fallback
}
