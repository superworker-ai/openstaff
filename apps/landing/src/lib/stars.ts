/** Compact star count for the GitHub badge: 999, 1.2k, 12k. */
export function formatStars(count: number): string {
  if (count < 1000) return String(count)
  const thousands = (count / 1000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')
  return `${thousands}k`
}

/** `owner/repo` from a GitHub URL, or null when the URL is not a repository link. */
export function repoSlug(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url)
    if (hostname !== 'github.com') return null
    const [owner, repo] = pathname.split('/').filter(Boolean)
    return owner && repo ? `${owner}/${repo}` : null
  } catch {
    return null
  }
}
