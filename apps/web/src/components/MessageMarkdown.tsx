import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ConnectedApp } from '@openstaff/shared'

function appText(children: ReactNode, apps: ConnectedApp[], connect: (app: string) => void): ReactNode {
  const names = apps.filter((app) => app.status !== 'connected').sort((a, b) => b.appName.length - a.appName.length)
  if (!names.length) return children
  const pattern = new RegExp(`\\b(${names.map((app) => app.appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
  return Children.map(children, (child): ReactNode => {
    if (typeof child === 'string') return child.split(pattern).map((part, index) => {
      const app = names.find((app) => app.appName.toLowerCase() === part.toLowerCase())
      return app ? <button key={index} onClick={() => connect(app.slug)} className="inline rounded-md border border-zinc-300/70 bg-white/70 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-white active:scale-[.97]" title={`Connect ${app.appName}`}>{part} · {app.status}</button> : part
    })
    if (isValidElement<{ children?: ReactNode }>(child) && !['a', 'code', 'pre', 'button'].includes(String(child.type))) return cloneElement(child, {}, appText(child.props.children, apps, connect))
    return child
  })
}

export function MessageMarkdown({ text, apps, connect }: { text: string; apps: ConnectedApp[]; connect: (app: string) => void }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <p>{appText(children, apps, connect)}</p>, li: ({ children }) => <li>{appText(children, apps, connect)}</li> }}>{text}</ReactMarkdown>
}
