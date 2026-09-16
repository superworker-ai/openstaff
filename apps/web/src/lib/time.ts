function clockTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const target = new Date(iso)
  if (Number.isNaN(target.getTime()) || Number.isNaN(now.getTime())) return ''
  const diff = target.getTime() - now.getTime()
  const future = diff > 0
  const seconds = Math.abs(diff) / 1000
  const dayDelta = Math.round((calendarDay(target) - calendarDay(now)) / 86_400_000)

  if (dayDelta === 1) return `tomorrow ${clockTime(target)}`
  if (dayDelta === -1) return `yesterday ${clockTime(target)}`
  if (seconds < 45) return future ? 'in less than a minute' : 'just now'
  if (seconds < 60 * 60) {
    const minutes = Math.max(1, Math.round(seconds / 60))
    return future ? `in ${minutes}m` : `${minutes}m ago`
  }
  if (seconds < 24 * 60 * 60) {
    const hours = Math.max(1, Math.round(seconds / (60 * 60)))
    return future ? `in ${hours}h` : `${hours}h ago`
  }
  if (future && dayDelta > 1 && dayDelta < 7) return `${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(target)} ${clockTime(target)}`
  if (!future && dayDelta < -1 && dayDelta > -7) return `${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(target)} ${clockTime(target)}`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(target)
}
