import { avatarSchema, type Avatar, type Bot } from '@openstaff/shared'
import type { BotTemplate } from './loaders'

export type AgentApprovalPolicy = 'auto' | 'writes' | 'all'

export const AGENT_DOCUMENT_COVERS = [
  { id: 'frontier-day', label: 'Open frontier', src: '/agent-covers/frontier-day.webp' },
  { id: 'golden-hour', label: 'Golden horizon', src: '/agent-covers/golden-hour.webp' },
  { id: 'blue-hour', label: 'Blue horizon', src: '/agent-covers/blue-hour.webp' },
  { id: 'ocean-horizon', label: 'Ocean horizon', src: '/agent-covers/ocean-horizon.webp' },
  { id: 'jungle-river', label: 'Jungle river', src: '/agent-covers/jungle-river.webp' },
  { id: 'city-sunrise', label: 'City sunrise', src: '/agent-covers/city-sunrise.webp' },
  { id: 'alpine-lake', label: 'Alpine lake', src: '/agent-covers/alpine-lake.webp' },
  { id: 'rolling-hills', label: 'Rolling hills', src: '/agent-covers/rolling-hills.webp' },
  { id: 'monterrey-huasteca', label: 'Monterrey · La Huasteca', src: '/agent-covers/monterrey-huasteca.webp' },
  { id: 'san-francisco-horizon', label: 'San Francisco · Golden Gate', src: '/agent-covers/san-francisco-horizon.webp' },
  { id: 'lake-tahoe-horizon', label: 'Lake Tahoe', src: '/agent-covers/lake-tahoe-horizon.webp' },
  { id: 'barcelona-horizon', label: 'Barcelona', src: '/agent-covers/barcelona-horizon.webp' },
  { id: 'bogota-horizon', label: 'Bogotá', src: '/agent-covers/bogota-horizon.webp' },
] as const

type AgentDocumentCoverImage = typeof AGENT_DOCUMENT_COVERS[number]['id']
export type AgentDocumentCover = AgentDocumentCoverImage | 'none'

export type AgentDocumentJson =
  | string
  | number
  | boolean
  | null
  | AgentDocumentJson[]
  | { [key: string]: AgentDocumentJson }

export interface AgentDocumentBlock {
  id?: string
  type: string
  props?: Record<string, AgentDocumentJson>
  content?: AgentDocumentJson
  children?: AgentDocumentBlock[]
}

export interface AgentDocumentDraft {
  templateId: string
  name: string
  job: string
  avatar: Avatar
  model: string
  approvalPolicy: AgentApprovalPolicy
  cover: AgentDocumentCover
  blocks: AgentDocumentBlock[]
}

export const AGENT_DOCUMENT_STORAGE_VERSION = 2 as const
export const AGENT_DOCUMENT_LIMITS = {
  name: 80,
  job: 160,
  model: 200,
  blockCount: 250,
  blockDepth: 10,
  blockId: 128,
  storedChars: 500_000,
  instructions: 20_000,
} as const

const agentDocumentCoverIds = new Set<string>(AGENT_DOCUMENT_COVERS.map((cover) => cover.id))

const allowedBlockTypes = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'codeBlock',
])

type StoredAgentDocument = {
  version: typeof AGENT_DOCUMENT_STORAGE_VERSION
  draft: AgentDocumentDraft
}

interface StoredAgentEditDocument {
  version: typeof AGENT_DOCUMENT_STORAGE_VERSION
  kind: 'edit'
  botId: string
  baseline: string
  originalInstructions: string
  instructionsDirty: boolean
  draft: AgentDocumentDraft
}

export interface AgentEditDocumentDraft {
  draft: AgentDocumentDraft
  originalInstructions: string
  instructionsDirty: boolean
}

export type AgentEditDocumentDraftResult =
  | { status: 'restored'; value: AgentEditDocumentDraft }
  | { status: 'stale' }
  | { status: 'invalid' }

export interface AgentDocumentBotPatch {
  name?: string
  job?: string
  instructions?: string
  avatar?: Avatar
  model?: string | null
  approvalPolicy?: AgentApprovalPolicy
}

interface LegacyAgentDocumentSection {
  id: string
  title: string
  body: string
}

interface LegacyAgentDocumentDraft {
  templateId: string
  name: string
  job: string
  avatar: Avatar
  model: string
  approvalPolicy: AgentApprovalPolicy
  cover: 'sand' | 'sky' | 'sage' | 'none'
  sections: LegacyAgentDocumentSection[]
}

function textBlock(type: AgentDocumentBlock['type'], content: AgentDocumentJson, props?: Record<string, AgentDocumentJson>): AgentDocumentBlock {
  return { type, ...(props ? { props } : {}), content }
}

function sectionsToBlocks(sections: readonly Pick<LegacyAgentDocumentSection, 'title' | 'body'>[]): AgentDocumentBlock[] {
  const blocks: AgentDocumentBlock[] = []
  for (const section of sections) {
    const title = section.title.trim()
    if (title) blocks.push(textBlock('heading', title, { level: 2 }))

    const body = section.body.replace(/\r\n/g, '\n')
    if (body || !title) blocks.push(...markdownToAgentBlocks(body))
  }
  return blocks.length > 0 ? blocks : [textBlock('paragraph', '')]
}

function markdownToAgentBlocks(markdown: string): AgentDocumentBlock[] {
  if (markdown === '') return [textBlock('paragraph', '')]
  const lines = markdown.split('\n')
  const blocks: AgentDocumentBlock[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(textBlock('paragraph', inlineMarkdown(paragraph.join('\n'))))
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      flushParagraph()
      continue
    }

    const fence = line.match(/^```([\w+-]*)\s*$/)
    if (fence) {
      flushParagraph()
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      blocks.push(textBlock('codeBlock', code.join('\n'), { language: fence[1] || 'text' }))
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      blocks.push(textBlock('heading', inlineMarkdown(heading[2] ?? ''), { level: heading[1]?.length ?? 2 }))
      continue
    }

    const check = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/)
    if (check) {
      flushParagraph()
      blocks.push(textBlock('checkListItem', inlineMarkdown(check[2] ?? ''), { checked: check[1]?.toLowerCase() === 'x' }))
      continue
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    if (bullet) {
      flushParagraph()
      blocks.push(textBlock('bulletListItem', inlineMarkdown(bullet[1] ?? '')))
      continue
    }

    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    if (numbered) {
      flushParagraph()
      blocks.push(textBlock('numberedListItem', inlineMarkdown(numbered[2] ?? ''), { start: Number(numbered[1]) }))
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      blocks.push(textBlock('quote', inlineMarkdown(quote[1] ?? '')))
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return blocks.length > 0 ? blocks : [textBlock('paragraph', '')]
}

function inlineMarkdown(markdown: string): AgentDocumentJson {
  const token = /(\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g
  const content: AgentDocumentJson[] = []
  let cursor = 0

  for (const match of markdown.matchAll(token)) {
    const start = match.index ?? 0
    if (start > cursor) content.push({ type: 'text', text: markdown.slice(cursor, start), styles: {} })
    if (match[2] !== undefined && match[3] !== undefined) {
      content.push({ type: 'link', href: match[3], content: [{ type: 'text', text: match[2], styles: {} }] })
    } else if (match[4] !== undefined || match[5] !== undefined) {
      content.push({ type: 'text', text: match[4] ?? match[5] ?? '', styles: { bold: true } })
    } else if (match[6] !== undefined) {
      content.push({ type: 'text', text: match[6], styles: { code: true } })
    } else {
      content.push({ type: 'text', text: match[7] ?? match[8] ?? '', styles: { italic: true } })
    }
    cursor = start + (match[0]?.length ?? 0)
  }

  if (content.length === 0) return markdown
  if (cursor < markdown.length) content.push({ type: 'text', text: markdown.slice(cursor), styles: {} })
  return content
}

function templateBlocks(template: BotTemplate): AgentDocumentBlock[] {
  return sectionsToBlocks([
    { title: 'What I take care of', body: template.instructions },
    {
      title: 'How I work',
      body: 'Start with the recommendation, then show the evidence.\nBe concise, direct, and clear about uncertainty.',
    },
    {
      title: 'A good result looks like',
      body: 'A useful answer I can act on, with sources and a clear next step.',
    },
  ])
}

export function createAgentDocument(template: BotTemplate): AgentDocumentDraft {
  return {
    templateId: template.id,
    name: '',
    job: template.job,
    avatar: { ...template.avatar },
    model: '',
    approvalPolicy: 'writes',
    cover: 'frontier-day',
    blocks: templateBlocks(template),
  }
}

export function createAgentDocumentForBot(
  bot: Bot,
  templates: readonly BotTemplate[],
  cover: AgentDocumentCover = 'frontier-day',
): AgentDocumentDraft {
  const template = templates.find((item) => item.id === 'custom') ?? templates[0]
  if (!template) throw new Error('An agent template is required to edit an agent.')
  return {
    templateId: template.id,
    name: bot.name,
    job: bot.job,
    avatar: { ...bot.avatar },
    model: bot.model ?? '',
    approvalPolicy: bot.approvalPolicy,
    cover,
    blocks: [textBlock('paragraph', '')],
  }
}

export function applyAgentTemplate(draft: AgentDocumentDraft, template: BotTemplate): AgentDocumentDraft {
  return {
    ...draft,
    templateId: template.id,
    job: template.job,
    avatar: { ...template.avatar },
    blocks: templateBlocks(template),
  }
}

export function captureAgentDocumentDraft(draft: AgentDocumentDraft, liveBlocks: readonly AgentDocumentBlock[]): AgentDocumentDraft {
  return {
    ...draft,
    blocks: JSON.parse(JSON.stringify(liveBlocks)) as AgentDocumentBlock[],
  }
}

export function normalizeAgentInstructions(markdown: string): string {
  return markdown.trim()
}

export function getAgentDocumentContentFingerprint(blocks: readonly AgentDocumentBlock[]): string {
  const normalize = (value: AgentDocumentJson | AgentDocumentBlock): AgentDocumentJson => {
    if (Array.isArray(value)) return value.map(normalize)
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'id')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalize(entry as AgentDocumentJson | AgentDocumentBlock)]))
  }
  return JSON.stringify(blocks.map(normalize))
}

export function getAgentEditBaseline(bot: Bot): string {
  return JSON.stringify({
    id: bot.id,
    name: bot.name,
    job: bot.job,
    instructions: bot.instructions,
    avatar: bot.avatar,
    model: bot.model,
    approvalPolicy: bot.approvalPolicy,
  })
}

export function buildAgentDocumentBotPatch(
  bot: Bot,
  draft: AgentDocumentDraft,
  instructions: string,
  instructionsDirty: boolean,
): AgentDocumentBotPatch {
  const patch: AgentDocumentBotPatch = {}
  const name = draft.name.trim()
  const job = draft.job.trim()
  const model = draft.model || null
  if (name !== bot.name) patch.name = name
  if (job !== bot.job) patch.job = job
  if (JSON.stringify(draft.avatar) !== JSON.stringify(bot.avatar)) patch.avatar = draft.avatar
  if (model !== bot.model) patch.model = model
  if (draft.approvalPolicy !== bot.approvalPolicy) patch.approvalPolicy = draft.approvalPolicy
  if (instructionsDirty) patch.instructions = instructions
  return patch
}

export function serializeAgentDocumentDraft(draft: AgentDocumentDraft): string {
  const stored: StoredAgentDocument = { version: AGENT_DOCUMENT_STORAGE_VERSION, draft }
  return JSON.stringify(stored)
}

export function parseAgentDocumentDraft(raw: string, templates: readonly BotTemplate[]): AgentDocumentDraft | null {
  if (raw.length > AGENT_DOCUMENT_LIMITS.storedChars) return null

  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(stored) || !isRecord(stored.draft)) return null
  if (stored.version === AGENT_DOCUMENT_STORAGE_VERSION) return parseVersionTwoDraft(stored.draft, templates)
  if (stored.version === 1) return migrateVersionOneDraft(stored.draft, templates)
  return null
}

export function getAgentDocumentStorageKey(userId: string): string {
  const scope = userId.trim() || 'anonymous'
  return `openstaff-agent-document-v2:${encodeURIComponent(scope)}`
}

export function getLegacyAgentDocumentStorageKey(userId: string): string {
  const scope = userId.trim() || 'anonymous'
  return `openstaff-agent-document-v1:${encodeURIComponent(scope)}`
}

export function getLegacyAgentDocumentStorageKeys(userId: string): string[] {
  const scope = userId.trim() || 'anonymous'
  return [
    getLegacyAgentDocumentStorageKey(userId),
    `openstaff:agent-document:v1:${scope}`,
  ]
}

export function getAgentEditDocumentStorageKey(userId: string, botId: string): string {
  const userScope = userId.trim() || 'anonymous'
  return `openstaff-agent-document-edit-v2:${encodeURIComponent(userScope)}:${encodeURIComponent(botId)}`
}

export function getAgentDocumentCoverStorageKey(userId: string, botId: string): string {
  const userScope = userId.trim() || 'anonymous'
  return `openstaff-agent-cover-v1:${encodeURIComponent(userScope)}:${encodeURIComponent(botId)}`
}

export function parseAgentDocumentCover(value: string | null): AgentDocumentCover | null {
  return isCover(value) ? value : null
}

export function serializeAgentEditDocumentDraft(bot: Bot, value: AgentEditDocumentDraft): string {
  const stored: StoredAgentEditDocument = {
    version: AGENT_DOCUMENT_STORAGE_VERSION,
    kind: 'edit',
    botId: bot.id,
    baseline: getAgentEditBaseline(bot),
    originalInstructions: value.originalInstructions,
    instructionsDirty: value.instructionsDirty,
    draft: value.draft,
  }
  return JSON.stringify(stored)
}

export function parseAgentEditDocumentDraft(
  raw: string,
  bot: Bot,
  templates: readonly BotTemplate[],
): AgentEditDocumentDraftResult {
  if (raw.length > AGENT_DOCUMENT_LIMITS.storedChars) return { status: 'invalid' }
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return { status: 'invalid' }
  }
  if (!isRecord(stored)
    || stored.version !== AGENT_DOCUMENT_STORAGE_VERSION
    || stored.kind !== 'edit'
    || stored.botId !== bot.id
    || typeof stored.baseline !== 'string') return { status: 'invalid' }
  if (stored.baseline !== getAgentEditBaseline(bot)) return { status: 'stale' }
  if (typeof stored.originalInstructions !== 'string'
    || stored.originalInstructions !== bot.instructions
    || typeof stored.instructionsDirty !== 'boolean'
    || !isRecord(stored.draft)) return { status: 'invalid' }
  const draft = parseVersionTwoDraft(stored.draft, templates)
  if (!draft) return { status: 'invalid' }
  return {
    status: 'restored',
    value: {
      draft,
      originalInstructions: stored.originalInstructions,
      instructionsDirty: stored.instructionsDirty,
    },
  }
}

function parseVersionTwoDraft(draft: Record<string, unknown>, templates: readonly BotTemplate[]): AgentDocumentDraft | null {
  if (!hasValidBaseDraft(draft, templates) || !isCover(draft.cover) || !Array.isArray(draft.blocks)) return null

  const blockCounter = { count: 0 }
  const seenIds = new Set<string>()
  const blocks = draft.blocks
    .map((block) => sanitizeAgentBlock(block, 0, blockCounter, seenIds))
    .filter((block): block is AgentDocumentBlock => block !== null)
  if (blocks.length === 0) return null

  const avatar = avatarSchema.safeParse(draft.avatar)
  if (!avatar.success) return null

  return {
    templateId: draft.templateId,
    name: draft.name,
    job: draft.job,
    avatar: avatar.data,
    model: draft.model,
    approvalPolicy: draft.approvalPolicy,
    cover: draft.cover,
    blocks,
  }
}

function migrateVersionOneDraft(draft: Record<string, unknown>, templates: readonly BotTemplate[]): AgentDocumentDraft | null {
  if (!hasValidBaseDraft(draft, templates) || !isLegacyCover(draft.cover) || !Array.isArray(draft.sections)) return null
  if (draft.sections.length > 30 || !draft.sections.every(isLegacySection)) return null

  const ids = draft.sections.map((section) => section.id)
  if (new Set(ids).size !== ids.length) return null

  const avatar = avatarSchema.safeParse(draft.avatar)
  if (!avatar.success) return null
  const legacy = draft as unknown as LegacyAgentDocumentDraft

  return {
    templateId: legacy.templateId,
    name: legacy.name,
    job: legacy.job,
    avatar: avatar.data,
    model: legacy.model,
    approvalPolicy: legacy.approvalPolicy,
    cover: migrateLegacyCover(legacy.cover),
    blocks: sectionsToBlocks(legacy.sections),
  }
}

function hasValidBaseDraft(draft: Record<string, unknown>, templates: readonly BotTemplate[]): draft is Record<string, unknown> & {
  templateId: string
  name: string
  job: string
  model: string
  approvalPolicy: AgentApprovalPolicy
} {
  return typeof draft.templateId === 'string'
    && templates.some((template) => template.id === draft.templateId)
    && typeof draft.name === 'string'
    && draft.name.length <= AGENT_DOCUMENT_LIMITS.name
    && typeof draft.job === 'string'
    && draft.job.length <= AGENT_DOCUMENT_LIMITS.job
    && typeof draft.model === 'string'
    && draft.model.length <= AGENT_DOCUMENT_LIMITS.model
    && isApprovalPolicy(draft.approvalPolicy)
}

function sanitizeAgentBlock(
  value: unknown,
  depth: number,
  counter: { count: number },
  seenIds: Set<string>,
): AgentDocumentBlock | null {
  if (!isRecord(value) || depth > AGENT_DOCUMENT_LIMITS.blockDepth || counter.count >= AGENT_DOCUMENT_LIMITS.blockCount) return null
  if (typeof value.type !== 'string' || !allowedBlockTypes.has(value.type)) return null

  const content = sanitizeInlineContent(value.content)
  if (content === null) return null
  counter.count += 1

  const id = typeof value.id === 'string'
    && value.id.trim() !== ''
    && value.id.length <= AGENT_DOCUMENT_LIMITS.blockId
    && !seenIds.has(value.id)
      ? value.id
      : undefined
  if (id) seenIds.add(id)

  const children = Array.isArray(value.children)
    ? value.children
        .map((child) => sanitizeAgentBlock(child, depth + 1, counter, seenIds))
        .filter((child): child is AgentDocumentBlock => child !== null)
    : []

  return {
    ...(id ? { id } : {}),
    type: value.type,
    props: sanitizeBlockProps(value.type, value.props),
    content,
    children,
  }
}

function sanitizeInlineContent(value: unknown): AgentDocumentJson | null {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null

  const inline: AgentDocumentJson[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string') return null
    if (item.type === 'text') {
      if (typeof item.text !== 'string') return null
      inline.push({ type: 'text', text: item.text, styles: sanitizeStyles(item.styles) })
      continue
    }
    if (item.type === 'link') {
      if (typeof item.href !== 'string' || item.href.length > 4_000 || !Array.isArray(item.content)) return null
      const linkText: AgentDocumentJson[] = []
      for (const text of item.content) {
        if (!isRecord(text) || text.type !== 'text' || typeof text.text !== 'string') return null
        linkText.push({ type: 'text', text: text.text, styles: sanitizeStyles(text.styles) })
      }
      inline.push({ type: 'link', href: item.href, content: linkText })
      continue
    }
    return null
  }
  return inline
}

function sanitizeStyles(value: unknown): Record<string, AgentDocumentJson> {
  if (!isRecord(value)) return {}
  const styles: Record<string, AgentDocumentJson> = {}
  for (const key of ['bold', 'italic', 'underline', 'strike', 'code']) {
    if (typeof value[key] === 'boolean') styles[key] = value[key]
  }
  for (const key of ['textColor', 'backgroundColor']) {
    if (typeof value[key] === 'string' && value[key].length <= 80) styles[key] = value[key]
  }
  return styles
}

function sanitizeBlockProps(type: string, value: unknown): Record<string, AgentDocumentJson> {
  const props = isRecord(value) ? value : {}
  if (type === 'codeBlock') {
    return { language: typeof props.language === 'string' && props.language.length <= 100 ? props.language : 'text' }
  }

  const result: Record<string, AgentDocumentJson> = {}
  if (typeof props.backgroundColor === 'string' && props.backgroundColor.length <= 80) result.backgroundColor = props.backgroundColor
  if (typeof props.textColor === 'string' && props.textColor.length <= 80) result.textColor = props.textColor
  if (props.textAlignment === 'left' || props.textAlignment === 'center' || props.textAlignment === 'right' || props.textAlignment === 'justify') {
    result.textAlignment = props.textAlignment
  }
  if (type === 'heading') {
    result.level = typeof props.level === 'number' && Number.isInteger(props.level) && props.level >= 1 && props.level <= 6 ? props.level : 2
    result.isToggleable = false
  }
  if (type === 'checkListItem') result.checked = typeof props.checked === 'boolean' ? props.checked : false
  if (type === 'numberedListItem' && typeof props.start === 'number' && Number.isInteger(props.start) && props.start > 0) result.start = props.start
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isApprovalPolicy(value: unknown): value is AgentApprovalPolicy {
  return value === 'auto' || value === 'writes' || value === 'all'
}

function isCover(value: unknown): value is AgentDocumentCover {
  return value === 'none' || (typeof value === 'string' && agentDocumentCoverIds.has(value))
}

function isLegacyCover(value: unknown): value is LegacyAgentDocumentDraft['cover'] {
  return value === 'sand' || value === 'sky' || value === 'sage' || value === 'none'
}

function migrateLegacyCover(cover: LegacyAgentDocumentDraft['cover']): AgentDocumentCover {
  if (cover === 'sky') return 'blue-hour'
  if (cover === 'sage') return 'golden-hour'
  if (cover === 'none') return 'none'
  return 'frontier-day'
}

function isLegacySection(value: unknown): value is LegacyAgentDocumentSection {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.trim() !== ''
    && value.id.length <= 128
    && typeof value.title === 'string'
    && value.title.length <= 200
    && typeof value.body === 'string'
    && value.body.length <= AGENT_DOCUMENT_LIMITS.instructions
}
