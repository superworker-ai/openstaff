import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type PartialBlock,
} from '@blocknote/core'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { en } from '@blocknote/core/locales'
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/ariakit'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/ariakit/style.css'
import type { AgentDocumentBlock } from '../../lib/agent-document'

const instructionSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
  },
})

type InstructionBlock = PartialBlock<
  typeof instructionSchema.blockSchema,
  typeof instructionSchema.inlineContentSchema,
  typeof instructionSchema.styleSchema
>

const instructionDictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Write instructions or type '/' for commands",
    emptyDocument: "Write instructions or type '/' for commands",
  },
}

export interface AgentRichTextEditorHandle {
  getBlocks: () => AgentDocumentBlock[]
  getMarkdown: () => string
  focus: () => void
}

interface Props {
  blocks: AgentDocumentBlock[]
  initialMarkdown?: string
  disabled: boolean
  onChange: (blocks: AgentDocumentBlock[], markdown: string) => void
  onImportError: () => void
  onReady: (blocks: AgentDocumentBlock[]) => void
}

function currentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export const AgentRichTextEditor = forwardRef<AgentRichTextEditorHandle, Props>(function AgentRichTextEditor(
  { blocks, initialMarkdown, disabled, onChange, onImportError, onReady },
  ref,
) {
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme)
  const [loaded, setLoaded] = useState(initialMarkdown === undefined)
  const importing = useRef(initialMarkdown !== undefined)
  const editor = useCreateBlockNote({
    schema: instructionSchema,
    dictionary: instructionDictionary,
    domAttributes: {
      editor: {
        'aria-label': 'Agent instructions',
        'aria-multiline': 'true',
      },
    },
    initialContent: blocks as unknown as InstructionBlock[],
  })

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    importing.current = initialMarkdown !== undefined
    try {
      if (initialMarkdown !== undefined) {
        const imported = initialMarkdown === ''
          ? [{ type: 'paragraph' as const, content: '' }]
          : editor.tryParseMarkdownToBlocks(initialMarkdown)
        editor.replaceBlocks(editor.document, imported)
      }
      importing.current = false
      setLoaded(true)
      onReady(editor.document as unknown as AgentDocumentBlock[])
    } catch {
      importing.current = false
      onImportError()
    }
  }, [editor, initialMarkdown, onImportError, onReady])

  useImperativeHandle(ref, () => ({
    getBlocks: () => editor.document as unknown as AgentDocumentBlock[],
    getMarkdown: () => editor.blocksToMarkdownLossy(editor.document),
    focus: () => editor.focus(),
  }), [editor])

  return <BlockNoteView
    className="agent-rich-editor"
    editor={editor}
    editable={!disabled && loaded}
    emojiPicker={false}
    filePanel={false}
    tableHandles={false}
    theme={theme}
    slashMenu={false}
    onChange={() => {
      if (importing.current) return
      onChange(
        editor.document as unknown as AgentDocumentBlock[],
        editor.blocksToMarkdownLossy(editor.document),
      )
    }}
  >
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={async (query) => {
        const items = getDefaultReactSlashMenuItems(editor).filter((item) => (
          (item as typeof item & { key?: string }).key !== 'emoji'
        ))
        return filterSuggestionItems(items, query)
      }}
    />
  </BlockNoteView>
})

export default AgentRichTextEditor
