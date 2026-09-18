import { and, asc, desc, eq } from 'drizzle-orm'
import { generateText, isStepCount, Output, ToolLoopAgent, type ModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'
import { connectionPath, createId, MESSAGE_DELTA_INTERVAL_MS, type AppConnection, type Approval, type ComputerProviderId, type JsonValue, type Turn } from '@openstaff/shared'
import type { BrowserService, BrowserSession } from '../browser/service.js'
import { browserTools } from '../browser/tools.js'
import type { BrowserActionExperiment } from '../browser/jev-actions.js'
import { observedBrowserTools } from '../browser/observed-tools.js'
import type { Computer } from '../computer/types.js'
import type { Database } from '../db/index.js'
import { approvals, bots, messages, roomMembers, turns, workspace } from '../db/schema.js'
import { labelMessage, loadRoomHistory } from './history.js'
import { approvalSummary } from './approval-summary.js'
import { mergeUsage } from './usage.js'
export { appendApprovalResponse } from './approval-responses.js'
import type { RealtimeHub } from '../realtime/hub.js'
import type { AdmissionService } from '../rooms/admission.js'
import { toolApprovalFor } from './approval-policy.js'
import { TurnEventRecorder } from './events.js'
import { resolveModel, type ModelResolver } from './models.js'
import type { ReplyDecisionExperiment } from './reply-decision.js'
import { buildTurnPrompt } from './prompt.js'
import { createAgentTools, type AgentToolContext } from './tools.js'
import type { PluginRegistry } from '../plugins/registry.js'
import { openPluginTools } from '../plugins/mcp.js'
import type { ComposioService } from '../composio/service.js'
import { composioTools } from '../composio/tools.js'
import type { AutomationService } from '../automations/service.js'
import { automationTools } from '../automations/tools.js'
import { AgentConnections, ConnectionRequiredError } from './connections.js'
import { availableApps } from './app-catalog.js'
import type { DurableWorkspace } from '../storage/durable.js'
import { ComputerUseSession, computerTools, type DesktopToolComputer } from '../computer/computer-tools.js'
import { pruneScreenshotContext, screenshotContextLimit, stripInlineFileData } from './screenshot-context.js'
import { publicApprovals } from '../db/public.js'
export { stripInlineFileData } from './screenshot-context.js'

export type RunResult = { kind: 'done'; text: string; usage: Record<string, JsonValue> } | { kind: 'waiting' } | { kind: 'skipped' }

/** One conversation per bot per room; used as the provider session id (OpenCode Go requires one). */
const conversationId = (turn: Pick<Turn, 'botId' | 'roomId'>): string => `${turn.botId}:${turn.roomId}`

function serializable(value: unknown): JsonValue {
  try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
}

function eventInput(toolName: string, input: unknown): JsonValue {
  if (toolName === 'computer_type' && input && typeof input === 'object' && typeof (input as { text?: unknown }).text === 'string') {
    const value = input as Record<string, unknown>
    const text = value.text as string
    return serializable({ ...value, text: `[redacted ${text.length} characters]` })
  }
  return serializable(input)
}

class DeltaBroadcaster {
  private text = ''
  private lastSentAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly hub: RealtimeHub | undefined, private readonly turn: Turn) {}

  add(delta: string): void {
    this.text += delta
    const remaining = MESSAGE_DELTA_INTERVAL_MS - (Date.now() - this.lastSentAt)
    if (remaining <= 0) this.send()
    else if (!this.timer) this.timer = setTimeout(() => this.send(), remaining)
  }

  private send(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.lastSentAt = Date.now()
    this.hub?.broadcastRoom(this.turn.roomId, {
      type: 'message.delta', roomId: this.turn.roomId, turnId: this.turn.id, botId: this.turn.botId, text: this.text, ts: new Date().toISOString(),
    })
  }

  flush(): string {
    if (this.timer) this.send()
    else if (this.text && Date.now() !== this.lastSentAt) this.send()
    return this.text
  }
}

export interface AgentRuntimeOptions {
  browser?: BrowserService
  registry?: PluginRegistry
  composio?: ComposioService
  automationService?: AutomationService
  db: Database
  computer: Computer
  durable?: DurableWorkspace
  admission: AdmissionService
  hub?: RealtimeHub
  contextMessages: number
  modelResolver?: ModelResolver
  /** A getter, so a hot-swapped experiment instance is picked up on the next decision. */
  replyDecisionExperiment?: () => ReplyDecisionExperiment | undefined
  /** Same contract: shadow observation of the browser actions this turn takes. */
  browserActionExperiment?: () => BrowserActionExperiment | undefined
}

export class AgentRuntime {
  private readonly modelResolver: ModelResolver

  constructor(private readonly options: AgentRuntimeOptions) {
    this.modelResolver = options.modelResolver ?? ((id, resolve) => resolveModel(id, undefined, resolve))
  }

  async computerProvider(): Promise<ComputerProviderId | undefined> {
    const computer = this.options.computer as Computer & { providerId?: () => Promise<ComputerProviderId> }
    return computer.providerId?.()
  }

  computerTurnStarted(): void { (this.options.computer as Computer & { turnStarted?: () => void }).turnStarted?.() }
  computerTurnFinished(): void { (this.options.computer as Computer & { turnFinished?: () => void }).turnFinished?.() }

  async decideReply(turn: Turn, signal?: AbortSignal): Promise<boolean> {
    const { db } = this.options
    const bot = (await db.select().from(bots).where(eq(bots.id, turn.botId)).limit(1))[0]
    const settings = (await db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
    if (!bot) return false
    const teammateRows = await db.select({ id: bots.id, name: bots.name, job: bots.job }).from(roomMembers)
      .innerJoin(bots, eq(roomMembers.memberId, bots.id))
      .where(and(eq(roomMembers.roomId, turn.roomId), eq(roomMembers.memberKind, 'bot')))
      .orderBy(asc(roomMembers.joinedAt))
    const teammates = teammateRows.filter((teammate) => teammate.id !== turn.botId)
      .map((teammate) => `${teammate.name}: ${teammate.job}`).join('\n') || '(None.)'
    const history = await loadRoomHistory(db, turn.roomId, this.options.contextMessages)
    const replies = await db.select({ message: messages }).from(messages).innerJoin(turns, eq(messages.turnId, turns.id))
      .where(and(eq(turns.triggerMessageId, turn.triggerMessageId), eq(messages.authorKind, 'bot'))).orderBy(desc(messages.seq)).limit(3)
    const recentReplies = (await Promise.all(replies.reverse().map(({ message }) => labelMessage(db, message)))).join('\n') || '(None yet.)'
    const timeout = AbortSignal.timeout(6_000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const modelId = process.env.REPLY_DECISION_MODEL || settings?.replyDecisionModel || turn.model
    const baseline = async () => {
      const result = await generateText({
        model: this.modelResolver(modelId, { sessionId: conversationId(turn) }),
        output: Output.object({ schema: z.object({ reply: z.boolean(), reason: z.string() }) }),
        abortSignal: combined,
        prompt: `You are deciding whether ${bot.name}, whose job is "${bot.job}", should reply in this room. Return reply:true when the latest message greets or addresses ${bot.name} by name (even misspelled) or asks ${bot.name} to respond, whatever the topic. Return reply:false when the latest message addresses a different teammate by name. Otherwise reply only for a unique, material contribution: its lane, a correction, or a blocker. Return reply:false for agreement, acknowledgement, emoji-only replies, restating a teammate, or no useful contribution.\n\nOther bots in this room (name: job):\n${teammates}\n\nLast 3 bot replies to this same trigger (author labeled):\n${recentReplies}\n\nRoom history:\n${history}`,
      })
      return { reply: result.output.reply, model: modelId, usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } }
    }
    const experiment = this.options.replyDecisionExperiment?.()
    if (!experiment?.applies(turn.roomId)) return (await baseline()).reply
    const trigger = (await db.select({ authorKind: messages.authorKind, text: messages.text }).from(messages).where(eq(messages.id, turn.triggerMessageId)).limit(1))[0]
    if (!trigger) return (await baseline()).reply
    return experiment.compare({
      roomId: turn.roomId, turnId: turn.id, botId: turn.botId,
      state: { candidate: { name: bot.name, job: bot.job }, teammates, trigger, history, recentReplies }, signal, baseline,
    })
  }

  async run(turn: Turn, signal?: AbortSignal): Promise<RunResult> {
    signal?.throwIfAborted()
    // Resolve credentials before launching plugin processes.
    this.modelResolver(turn.model, { sessionId: conversationId(turn) })
    const mcp = await openPluginTools(this.options.registry?.enabled() ?? [], signal, this.options.registry?.mcpPool, this.options.registry?.oauth)
    const recorder = new TurnEventRecorder(this.options.db, this.options.hub, turn.id, turn.roomId)
    const browser = this.options.browser?.session(turn.id, recorder, signal)
    let waiting = false
    try { const result = await this.runWithTools(turn, mcp.tools, mcp.readOnly, recorder, browser, signal, mcp.missingConnection, mcp.hiddenApps); waiting = result.kind === 'waiting'; return result }
    finally { if (!waiting) await this.options.browser?.finish(turn.id); await mcp.close() }
  }

  /** Identical tools unless the browser-action experiment covers this room; observation never changes a call. */
  private async observedBrowser(browser: BrowserSession, turn: Turn, signal?: AbortSignal): Promise<ReturnType<typeof browserTools>> {
    const tools = browserTools(browser)
    const experiment = this.options.browserActionExperiment?.()
    if (!experiment?.applies(turn.roomId) || !turn.triggerMessageId) return tools
    const trigger = (await this.options.db.select({ text: messages.text }).from(messages).where(eq(messages.id, turn.triggerMessageId)).limit(1))[0]
    return observedBrowserTools(tools, {
      experiment, session: browser, signal,
      context: { roomId: turn.roomId, turnId: turn.id, botId: turn.botId },
      goal: (trigger?.text ?? '').slice(0, 1_024),
    })
  }

  private async runWithTools(turn: Turn, externalTools: ToolSet, readOnly: Set<string>, recorder: TurnEventRecorder, browser?: BrowserSession, signal?: AbortSignal, missingConnection?: (name: string) => Promise<AppConnection | undefined>, hiddenApps: string[] = []): Promise<RunResult> {
    const { db, computer, admission, hub } = this.options
    const bot = (await db.select().from(bots).where(eq(bots.id, turn.botId)).limit(1))[0]
    if (!bot) throw new Error('Bot not found')
    const prompt = await buildTurnPrompt(db, computer, turn, this.options.contextMessages, this.options.registry, this.options.durable)
    const connections = new AgentConnections(this.options.registry, this.options.composio)
    const connectionRequests = new Map<string, AppConnection>()
    const failedConnections = new Map<string, { toolName: string; input: unknown; connection: AppConnection }>()
    const screenshotLimit = screenshotContextLimit()
    const callMessages = pruneScreenshotContext(turn.modelMessages.length ? turn.modelMessages as unknown as ModelMessage[] : prompt.messages, screenshotLimit)
    let hasConnectedToolkits = false
    try { hasConnectedToolkits = (await this.options.composio?.listConnections() ?? []).some((item) => item.status === 'ACTIVE' && (item.scope === 'workspace' || item.userId === turn.actorUserId)) } catch { /* An unavailable app provider must not prevent local tools from running. */ }
    hiddenApps.push(...(await availableApps(this.options.registry, this.options.composio, turn.actorUserId)).filter((item) => item.status !== 'connected').map((item) => item.appName))
    const managed = computer as Computer & { desktopSupported?: () => Promise<boolean> }
    const desktopTools = browser && await managed.desktopSupported?.() && typeof (computer as Partial<DesktopToolComputer>).captureScreen === 'function' && typeof (computer as Partial<DesktopToolComputer>).desktopInput === 'function'
      ? computerTools(new ComputerUseSession(computer as DesktopToolComputer, browser.screenRecorder, browser.displayGate, recorder, signal), browser.screenRecorder)
      : {}
    const agentTools: ToolSet & ReturnType<typeof createAgentTools> = {
      ...createAgentTools({ db, computer, durable: this.options.durable, admission, hub, registry: this.options.registry }),
      ...externalTools,
      ...connections.tools(turn.actorUserId),
      ...(browser ? await this.observedBrowser(browser, turn, signal) : {}),
      ...desktopTools,
      ...(this.options.composio && hasConnectedToolkits ? composioTools(this.options.composio) : {}),
      ...(this.options.automationService ? automationTools(this.options.automationService) : {}),
    }
    const context = { turnId: turn.id, botId: turn.botId, roomId: turn.roomId, actorUserId: turn.actorUserId, handoffDepth: turn.handoffDepth }
    await recorder.record('status', { tools: Object.keys(agentTools).length, hiddenApps: [...new Set(hiddenApps)] })
    const delta = new DeltaBroadcaster(hub, turn)
    const agent = new ToolLoopAgent({
      model: this.modelResolver(turn.model, { sessionId: conversationId(turn) }),
      instructions: `${prompt.instructions}\n\n${await connections.prompt(turn.actorUserId)}`,
      tools: agentTools,
      toolsContext: Object.fromEntries(Object.keys(agentTools).map((name) => [name, context])) as { [K in keyof typeof agentTools]: AgentToolContext },
      stopWhen: [isStepCount(40), () => failedConnections.size > 0],
      maxOutputTokens: 4096,
      prepareStep: ({ messages }) => ({ messages: pruneScreenshotContext(messages, screenshotLimit) }),
      toolApproval: toolApprovalFor(bot.approvalPolicy, readOnly, this.options.composio?.isReadOnly.bind(this.options.composio), async (call) => {
        const connection = await missingConnection?.(call.toolName) ?? await connections.missing(call.toolName, call.input, turn.actorUserId)
        if (connection) connectionRequests.set(call.toolCallId!, connection)
        return connection?.appName
      }),
    })
    signal?.throwIfAborted()
    const result = await agent.stream({
      messages: callMessages,
      abortSignal: signal,
      timeout: { totalMs: 900_000 },
    })
    const approvalRequests: Array<{ approvalId: string; reason?: string; toolCall: { toolName: string; toolCallId: string; input: unknown } }> = []
    let finalText = ''
    for await (const part of result.stream) {
      if (part.type === 'text-delta') {
        finalText += part.text
        delta.add(part.text)
      } else if (part.type === 'reasoning-delta') {
        await recorder.record('reasoning', { text: part.text })
      } else if (part.type === 'tool-call') {
        await recorder.record('tool-call', { toolName: part.toolName, toolCallId: part.toolCallId, input: eventInput(part.toolName, part.input) })
      } else if (part.type === 'tool-result') {
        await recorder.record('tool-result', { toolName: part.toolName, toolCallId: part.toolCallId, output: serializable(part.output) })
      } else if (part.type === 'tool-error') {
        if (part.error instanceof ConnectionRequiredError) {
          failedConnections.set(part.toolCallId, { toolName: part.toolName, input: part.input, connection: part.error.connection })
          hub?.broadcastAll({ type: 'connection.updated', app: part.error.connection.appName, status: 'expired', ts: new Date().toISOString() })
        }
        await recorder.record('tool-result', { toolName: part.toolName, toolCallId: part.toolCallId, error: String(part.error) })
      } else if (part.type === 'tool-output-denied') {
        await recorder.record('tool-result', { toolName: part.toolName, toolCallId: part.toolCallId, denied: true })
      } else if (part.type === 'tool-approval-request' && !part.isAutomatic) {
        approvalRequests.push(part)
      } else if (part.type === 'error') {
        throw part.error
      }
    }
    signal?.throwIfAborted()
    delta.flush()
    const responseMessages = await result.responseMessages
    for (const [toolCallId, failed] of failedConnections) {
      const approvalId = createId('approval')
      connectionRequests.set(toolCallId, failed.connection)
      approvalRequests.push({ approvalId, reason: `connect:${failed.connection.appName}`, toolCall: { toolCallId, toolName: failed.toolName, input: failed.input } })
      for (const message of responseMessages) if (message.role === 'tool' && Array.isArray(message.content)) for (const part of message.content) if (part.type === 'tool-result' && part.toolCallId === toolCallId) part.output = { type: 'error-text', value: 'connection expired' }
    }
    const usage = mergeUsage(turn.usage, serializable(await result.totalUsage) as Record<string, JsonValue>)
    if (approvalRequests.length) {
      const now = new Date().toISOString()
      const pendingApprovals: Approval[] = approvalRequests.map((approvalRequest) => {
        const id = createId('approval'), connection = approvalRequest.reason?.startsWith('connect:') ? connectionRequests.get(approvalRequest.toolCall.toolCallId) : undefined
        return ({
        resumeMode: failedConnections.has(approvalRequest.toolCall.toolCallId) ? 'retry' : 'tool',
        kind: connection ? 'connect' : 'approval',
        connection: connection ? { ...connection, connectUrl: connectionPath(connection, id) } : null,
        id,
        turnId: turn.id,
        roomId: turn.roomId,
        botId: turn.botId,
        approvalId: approvalRequest.approvalId,
        toolName: approvalRequest.toolCall.toolName,
        input: serializable(approvalRequest.toolCall.input),
        summary: connection ? `${bot.name} needs ${connection.appName} ${failedConnections.has(approvalRequest.toolCall.toolCallId) ? 'reconnected' : 'connected'}` : approvalSummary(approvalRequest.toolCall.toolName, approvalRequest.toolCall.input),
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
      }) })
      await db.transaction(async (transaction) => {
        await transaction.insert(approvals).values(pendingApprovals)
        await transaction.update(turns).set({ status: 'waiting_approval', usage, modelMessages: serializable(stripInlineFileData([...callMessages, ...responseMessages])) as JsonValue[] }).where(eq(turns.id, turn.id))
        await transaction.update(bots).set({ status: 'waiting_approval' }).where(eq(bots.id, turn.botId))
      })
      await recorder.record('status', { status: 'waiting_approval', approvalIds: pendingApprovals.map((approval) => approval.id) })
      for (const approval of await publicApprovals(db, pendingApprovals)) {
        await admission.post({ roomId: turn.roomId, authorKind: 'system', authorId: null, text: approval.summary, attachments: [{ subtype: 'approval', approvalId: approval.id, botName: bot.name, ...(approval.connection ? { kind: 'connect', appName: approval.connection.appName } : {}) }], planReplies: false })
        hub?.broadcastRoom(turn.roomId, { type: 'approval.updated', approval, ts: now })
      }
      return { kind: 'waiting' }
    }
    if (finalText.trim()) await recorder.record('text', { text: finalText })
    return finalText.trim() ? { kind: 'done', text: finalText, usage } : { kind: 'skipped' }
  }
}
