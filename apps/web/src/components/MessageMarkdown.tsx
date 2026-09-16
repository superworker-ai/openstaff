import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MessageMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
}
