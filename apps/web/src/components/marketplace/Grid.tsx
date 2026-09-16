import { useEffect, useRef, type ReactNode } from 'react'
import { buttonClass } from '../settings/common'

export function MarketplaceGrid({ children, loading, count, total, warming, q, more, fetching, loadMore }: {
  children: ReactNode; loading: boolean; count: number; total: number; warming: boolean; q: string; more: boolean; fetching: boolean; loadMore: () => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sentinel.current || !more || fetching || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) loadMore() }, { rootMargin: '400px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [more, fetching, loadMore])
  return <>
    <div className="sticky top-0 z-10 mb-4 bg-app/95 py-3 text-sm text-fg-muted" aria-live="polite">
      <p data-testid="marketplace-count">Showing {count} of {total}</p>
      {warming && <p className="mt-1 text-xs">Loading the full catalog…</p>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loading || fetching}>
      {loading ? Array.from({ length: 6 }, (_, index) => <div key={index} data-testid="marketplace-skeleton" className="h-72 animate-pulse rounded-lg border border-line bg-surface-2 p-5"><div className="h-10 w-10 rounded-md bg-surface-3" /><div className="mt-5 h-5 w-2/3 rounded-sm bg-surface-3" /><div className="mt-3 h-12 rounded-sm bg-surface-3" /></div>) : children}
    </div>
    {!loading && !count && <p className="py-12 text-center text-fg-muted">{q ? `No results for “${q}”.` : 'No items available yet.'}</p>}
    <div ref={sentinel} data-testid="marketplace-sentinel" className="h-px" />
    {more && <div className="py-6 text-center"><button className={buttonClass} disabled={fetching} onClick={loadMore}>{fetching ? 'Loading…' : 'Load more'}</button></div>}
  </>
}
