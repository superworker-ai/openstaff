import { describe, expect, it } from 'vitest'
import type { Bot } from '@openstaff/shared'
import type { BotTemplate } from './loaders'
import {
  AGENT_DOCUMENT_LIMITS,
  applyAgentTemplate,
  buildAgentDocumentBotPatch,
  captureAgentDocumentDraft,
  createAgentDocument,
  createAgentDocumentForBot,
  getAgentDocumentContentFingerprint,
  getAgentDocumentCoverStorageKey,
  getAgentDocumentStorageKey,
  getAgentEditDocumentStorageKey,
  getLegacyAgentDocumentStorageKeys,
  normalizeAgentInstructions,
  parseAgentDocumentDraft,
  parseAgentEditDocumentDraft,
  serializeAgentEditDocumentDraft,
  serializeAgentDocumentDraft,
  type AgentDocumentDraft,
} from './agent-document'

const research: BotTemplate = {
  id: 'research',
  name: 'Research',
  job: 'Research partner',
  instructions: 'Find reliable information and compare sources.',
  avatar: { shape: 'drop', color: '#2E90FA', eyes: 'round', mouth: 'smile', accessory: 'glasses', personality: 'curious' },
  suggestedApps: [],
}

const engineer: BotTemplate = {
  id: 'engineer',
  name: 'Engineer',
  job: 'Software engineer',
  instructions: 'Build and debug reliable software.',
  avatar: { shape: 'hex', color: '#F04438', eyes: 'dot', mouth: 'flat', accessory: 'headphones', personality: 'calm' },
  suggestedApps: [],
}

const templates = [research, engineer]

const existingBot: Bot = {
  id: 'bot_existing',
  slug: 'existing',
  name: 'Existing agent',
  job: 'Deep researcher',
  instructions: '# Exact source\n\nKeep  two spaces.  \n\n- Parent\n  - Child',
  avatar: research.avatar,
  model: 'acme/custom-preview-2026',
  reasoningEffort: 'high',
  approvalPolicy: 'writes',
  status: 'idle',
  createdBy: 'user_existing',
  createdAt: '2026-09-16T12:00:00.000Z',
}

describe('agent document draft', () => {
  it('creates a document with a scenic cover and editable instruction blocks', () => {
    const draft = createAgentDocument(research)

    expect(draft).toMatchObject({
      templateId: 'research',
      name: '',
      job: 'Research partner',
      avatar: research.avatar,
      model: '',
      approvalPolicy: 'writes',
      cover: 'frontier-day',
    })
    expect(draft.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ])
    expect(draft.blocks[1]?.content).toBe(research.instructions)
  })

  it('applies a template while preserving identity and preferences', () => {
    const original: AgentDocumentDraft = {
      ...createAgentDocument(research),
      name: 'Ada',
      model: 'openai/gpt-5.6-sol',
      approvalPolicy: 'all',
      cover: 'golden-hour',
    }

    const next = applyAgentTemplate(original, engineer)

    expect(next).toMatchObject({
      templateId: 'engineer',
      name: 'Ada',
      job: engineer.job,
      avatar: engineer.avatar,
      model: 'openai/gpt-5.6-sol',
      approvalPolicy: 'all',
      cover: 'golden-hour',
    })
    expect(next.blocks[1]?.content).toBe(engineer.instructions)
    expect(original.templateId).toBe('research')
  })

  it('captures the live rich document for a lossless template undo snapshot', () => {
    const persisted = createAgentDocument(research)
    const liveBlocks: AgentDocumentDraft['blocks'] = [
      {
        id: 'rich-paragraph',
        type: 'paragraph',
        props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' },
        content: [
          { type: 'text', text: 'ShortcutBold', styles: { bold: true } },
          { type: 'text', text: ' ', styles: {} },
          { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'ToolbarLink', styles: { bold: true } }] },
        ],
        children: [],
      },
      {
        id: 'bullet-one',
        type: 'bulletListItem',
        props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' },
        content: [{ type: 'text', text: 'First bullet', styles: {} }],
        children: [],
      },
      {
        id: 'bullet-two',
        type: 'bulletListItem',
        props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' },
        content: [{ type: 'text', text: 'Second bullet', styles: {} }],
        children: [],
      },
    ]

    const snapshot = captureAgentDocumentDraft(persisted, liveBlocks)
    liveBlocks.splice(0, liveBlocks.length)

    expect(snapshot.blocks).toHaveLength(3)
    expect(snapshot.blocks[0]?.content).toEqual([
      { type: 'text', text: 'ShortcutBold', styles: { bold: true } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'ToolbarLink', styles: { bold: true } }] },
    ])
    expect(snapshot.blocks.slice(1).map((block) => block.content)).toEqual([
      [{ type: 'text', text: 'First bullet', styles: {} }],
      [{ type: 'text', text: 'Second bullet', styles: {} }],
    ])
    expect(snapshot.blocks).not.toBe(liveBlocks)
  })

  it('round trips rich block JSON without losing inline formatting, links, or nesting', () => {
    const draft: AgentDocumentDraft = {
      ...createAgentDocument(research),
      cover: 'alpine-lake',
      blocks: [{
        id: 'intro',
        type: 'paragraph',
        props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' },
        content: [
          { type: 'text', text: 'Read ', styles: { bold: true } },
          { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'the source', styles: { italic: true } }] },
        ],
        children: [{
          id: 'child',
          type: 'bulletListItem',
          props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' },
          content: 'Summarize the evidence',
          children: [],
        }],
      }],
    }

    expect(parseAgentDocumentDraft(serializeAgentDocumentDraft(draft), templates)).toEqual(draft)
  })

  it('migrates v1 sections and keeps line breaks and markdown source together', () => {
    const legacy = {
      version: 1,
      draft: {
        templateId: research.id,
        name: 'Scout',
        job: research.job,
        avatar: research.avatar,
        model: 'openai/gpt-5.6-sol',
        approvalPolicy: 'auto',
        cover: 'sky',
        sections: [{ id: 'role', title: 'Role', body: '**Compare sources.**\nThen explain the tradeoff.' }],
      },
    }

    const migrated = parseAgentDocumentDraft(JSON.stringify(legacy), templates)

    expect(migrated).toMatchObject({
      name: 'Scout',
      model: 'openai/gpt-5.6-sol',
      approvalPolicy: 'auto',
      cover: 'blue-hour',
    })
    expect(migrated?.blocks).toEqual([
      { type: 'heading', props: { level: 2 }, content: 'Role' },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Compare sources.', styles: { bold: true } },
          { type: 'text', text: '\nThen explain the tradeoff.', styles: {} },
        ],
      },
    ])
  })

  it('sanitizes malformed supported blocks, drops unsafe siblings, and produces loadable content', () => {
    const draft = createAgentDocument(research)
    const raw = JSON.stringify({
      version: 2,
      draft: {
        ...draft,
        blocks: [
          { id: 'same', type: 'paragraph', content: [{ type: 'text', text: 'Keep me', styles: { bold: true, invented: true } }] },
          { id: 'same', type: 'heading', props: { level: 'two' }, content: 'Safe heading' },
          { type: 'paragraph', content: 42 },
          { type: 'image', props: { url: 'https://example.com/image.png' } },
        ],
      },
    })

    const restored = parseAgentDocumentDraft(raw, templates)

    expect(restored?.blocks).toEqual([
      {
        id: 'same',
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: 'Keep me', styles: { bold: true } }],
        children: [],
      },
      {
        type: 'heading',
        props: { level: 2, isToggleable: false },
        content: 'Safe heading',
        children: [],
      },
    ])
  })

  it('rejects unreadable drafts while allowing the client to preserve their raw storage', () => {
    const draft = createAgentDocument(research)
    expect(parseAgentDocumentDraft('{bad', templates)).toBeNull()
    expect(parseAgentDocumentDraft(JSON.stringify({ version: 3, draft }), templates)).toBeNull()
    expect(parseAgentDocumentDraft(JSON.stringify({ version: 2, draft: { ...draft, blocks: [{ type: 'image' }] } }), templates)).toBeNull()
  })

  it.each([
    ['approval policy', { approvalPolicy: 'sometimes' }],
    ['cover', { cover: 'ocean' }],
    ['avatar', { avatar: { shape: 'star', color: '#2E90FA' } }],
    ['template', { templateId: 'missing' }],
  ])('rejects an invalid %s', (_label, change) => {
    const draft = { ...createAgentDocument(research), ...change }
    expect(parseAgentDocumentDraft(JSON.stringify({ version: 2, draft }), templates)).toBeNull()
  })

  it('rejects drafts beyond persisted metadata limits', () => {
    const draft = createAgentDocument(research)
    expect(parseAgentDocumentDraft(serializeAgentDocumentDraft({ ...draft, name: 'n'.repeat(81) }), templates)).toBeNull()
    expect(parseAgentDocumentDraft(serializeAgentDocumentDraft({ ...draft, job: 'j'.repeat(161) }), templates)).toBeNull()
    expect(parseAgentDocumentDraft(serializeAgentDocumentDraft({ ...draft, model: 'm'.repeat(201) }), templates)).toBeNull()
    expect(parseAgentDocumentDraft(' '.repeat(AGENT_DOCUMENT_LIMITS.storedChars + 1), templates)).toBeNull()
  })

  it('normalizes only the exported document boundary', () => {
    expect(normalizeAgentInstructions('\n## Role\nKeep internal spacing.  \n\n')).toBe('## Role\nKeep internal spacing.')
  })

  it('scopes current and historical storage keys to the user', () => {
    expect(getAgentDocumentStorageKey('user@example.com')).toBe('openstaff-agent-document-v2:user%40example.com')
    expect(getLegacyAgentDocumentStorageKeys('user@example.com')).toEqual([
      'openstaff-agent-document-v1:user%40example.com',
      'openstaff:agent-document:v1:user@example.com',
    ])
    expect(getAgentDocumentStorageKey('  ')).toBe('openstaff-agent-document-v2:anonymous')
  })

  it('creates an edit document from the bot without replacing its identity or custom model', () => {
    const draft = createAgentDocumentForBot(existingBot, templates, 'blue-hour')

    expect(draft).toMatchObject({
      templateId: research.id,
      name: existingBot.name,
      job: existingBot.job,
      avatar: existingBot.avatar,
      model: existingBot.model,
      approvalPolicy: existingBot.approvalPolicy,
      cover: 'blue-hour',
    })
    expect(draft.blocks).toEqual([{ type: 'paragraph', content: '' }])
  })

  it('isolates edit drafts and covers by user and bot', () => {
    expect(getAgentEditDocumentStorageKey('user@example.com', 'bot/one')).toBe(
      'openstaff-agent-document-edit-v2:user%40example.com:bot%2Fone',
    )
    expect(getAgentDocumentCoverStorageKey('user@example.com', 'bot/one')).toBe(
      'openstaff-agent-cover-v1:user%40example.com:bot%2Fone',
    )
    expect(getAgentEditDocumentStorageKey('user@example.com', 'bot/two')).not.toBe(
      getAgentEditDocumentStorageKey('user@example.com', 'bot/one'),
    )
  })

  it('restores edit drafts only while their editable server baseline still matches', () => {
    const draft = {
      ...createAgentDocumentForBot(existingBot, templates),
      name: 'Unsaved local name',
      blocks: [{ type: 'heading', props: { level: 1 }, content: 'Edited locally' }],
    }
    const raw = serializeAgentEditDocumentDraft(existingBot, {
      draft,
      originalInstructions: existingBot.instructions,
      instructionsDirty: true,
    })

    expect(parseAgentEditDocumentDraft(raw, existingBot, templates)).toEqual({
      status: 'restored',
      value: {
        draft: {
          ...draft,
          blocks: [{ type: 'heading', props: { level: 1, isToggleable: false }, content: 'Edited locally', children: [] }],
        },
        originalInstructions: existingBot.instructions,
        instructionsDirty: true,
      },
    })
    expect(parseAgentEditDocumentDraft(raw, { ...existingBot, name: 'Changed elsewhere' }, templates)).toEqual({ status: 'stale' })
  })

  it('omits exact instructions and an unavailable model from metadata-only patches', () => {
    const unchanged = createAgentDocumentForBot(existingBot, templates)
    const draft = { ...unchanged, name: 'Renamed agent' }

    expect(buildAgentDocumentBotPatch(existingBot, unchanged, 'normalized output', false)).toEqual({})
    expect(buildAgentDocumentBotPatch(existingBot, draft, 'normalized output', false)).toEqual({
      name: 'Renamed agent',
    })
    expect(buildAgentDocumentBotPatch(existingBot, draft, 'normalized output', true)).toEqual({
      name: 'Renamed agent',
      instructions: 'normalized output',
    })
    expect(existingBot.reasoningEffort).toBe('high')
  })

  it('fingerprints document content without generated block identifiers', () => {
    const first = [{ id: 'first', type: 'paragraph', props: { textAlignment: 'left' }, content: 'Same', children: [] }]
    const second = [{ id: 'second', type: 'paragraph', content: 'Same', children: [], props: { textAlignment: 'left' } }]
    expect(getAgentDocumentContentFingerprint(first)).toBe(getAgentDocumentContentFingerprint(second))
  })
})
