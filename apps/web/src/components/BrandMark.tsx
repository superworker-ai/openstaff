export function BrandMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth={5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 ${className}`}
  >
    <circle cx={32} cy={32} r={23} />
    <path d="M11 41h42M23 41v-4a9 9 0 0 1 18 0v4" />
  </svg>
}
