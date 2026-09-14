import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { tool } from 'ai'
import { z } from 'zod'
import { createId, type Mention } from '@openstaff/shared'
import type { Computer } from '../computer/types.js'
import type { Database } from '../db/index.js'
import { bots, roomMembers, tasks } from '../db/schema.js'
import type { AdmissionService } from '../rooms/admission.js'
import type { RealtimeHub } from '../realtime/hub.js'
import type { PluginRegistry } from '../plugins/registry.js'
import type { DurableWorkspace, DurableWriteTarget } from '../storage/durable.js'

export const toolContextSchema = z.object({
  turnId: z.string(),
  botId: z.string(),
  roomId: z.string(),
  handoffDepth: z.number().int().min(0),
})
export type AgentToolContext = z.infer<typeof toolContextSchema>

export interface ToolDependencies {
  registry?: PluginRegistry
  computer: Computer
  durable?: DurableWorkspace
  db: Database
  admission: AdmissionService
  hub?: RealtimeHub
}

function safeSkillName(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) throw new Error('Invalid skill name')
  return name
}

async function botSlug(db: Database, botId: string): Promise<string> {
  const row = (await db.select({ slug: bots.slug }).from(bots).where(eq(bots.id, botId)).limit(1))[0]
  if (!row) throw new Error('Bot not found')
  return row.slug
}

export function createAgentTools(dependencies: ToolDependencies) {
  const { computer, db, admission, hub } = dependencies
  const durableWrite = async (key: string, content: string) => {
    const data = new Uint8Array(Buffer.from(content))
    if (dependencies.durable) await dependencies.durable.writeThrough(computer as DurableWriteTarget, key, data, { contentType: 'text/markdown' })
    else await computer.writeFile(key, content)
  }
  return {
    shell: tool({
      description: 'Run a shell command in the shared workspace. Output is capped.',
      inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
      contextSchema: toolContextSchema,
      execute: ({ command, cwd }, { abortSignal }) => computer.exec(command, { cwd, timeoutMs: 120_000, signal: abortSignal }),
    }),
    read_file: tool({
      description: 'Read a UTF-8 file under /workspace.',
      inputSchema: z.object({ path: z.string() }),
      contextSchema: toolContextSchema,
      execute: ({ path: filePath }) => computer.readFile(filePath),
    }),
    write_file: tool({
      description: 'Write a UTF-8 file under /workspace, creating parent directories.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      contextSchema: toolContextSchema,
      execute: async ({ path: filePath, content }) => {
        await computer.writeFile(filePath, content)
        return { written: filePath, bytes: Buffer.byteLength(content) }
      },
    }),
    edit_file: tool({
      description: 'Replace one exact string in a UTF-8 file under /workspace.',
      inputSchema: z.object({ path: z.string(), oldText: z.string().min(1), newText: z.string() }),
      contextSchema: toolContextSchema,
      execute: async ({ path: filePath, oldText, newText }) => {
        const content = await computer.readFile(filePath)
        const first = content.indexOf(oldText)
        if (first < 0) throw new Error('Exact text was not found')
        if (content.indexOf(oldText, first + oldText.length) >= 0) throw new Error('Exact text is not unique')
        await computer.writeFile(filePath, content.replace(oldText, newText))
        return { edited: filePath }
      },
    }),
    list_dir: tool({
      description: 'List a directory under /workspace.',
      inputSchema: z.object({ path: z.string().default('.') }),
      contextSchema: toolContextSchema,
      execute: ({ path: directoryPath }) => computer.list(directoryPath),
    }),
    read_skill: tool({
      description: 'Load one saved skill body on demand.',
      inputSchema: z.object({ name: z.string() }),
      contextSchema: toolContextSchema,
      execute: async ({ name }) => await dependencies.registry?.readSkill(name) ?? (dependencies.durable
        ? dependencies.durable.readText(path.posix.join('skills', safeSkillName(name), 'SKILL.md'))
        : computer.readFile(path.posix.join('skills', safeSkillName(name), 'SKILL.md'))),
    }),
    read_plugin_file: tool({
      description: 'Read a file relative to an enabled plugin root, including skill sibling references.',
      inputSchema: z.object({ plugin: z.string(), relativePath: z.string() }),
      contextSchema: toolContextSchema,
      execute: async ({ plugin, relativePath }) => {
        if (!dependencies.registry) throw new Error('No plugins enabled')
        return dependencies.registry.readFile(plugin, relativePath)
      },
    }),
    save_skill: tool({
      description: 'Save a reusable skill in the shared workspace.',
      inputSchema: z.object({ name: z.string(), description: z.string(), body: z.string() }),
      contextSchema: toolContextSchema,
      execute: async ({ name, description, body }) => {
        const skill = safeSkillName(name)
        await durableWrite(path.posix.join('skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: ${description.replaceAll('\n', ' ')}\n---\n\n${body}`)
        return { saved: skill }
      },
    }),
    memory_update: tool({
      description: 'Replace or append to this bot’s durable memory.',
      inputSchema: z.object({ content: z.string(), mode: z.enum(['replace', 'append']).default('append') }),
      contextSchema: toolContextSchema,
      execute: async ({ content, mode }, { context }) => {
        const slug = await botSlug(db, context.botId)
        const filePath = path.posix.join('bots', slug, 'MEMORY.md')
        let next = content
        if (mode === 'append') {
          let current = ''
          try { current = dependencies.durable ? await dependencies.durable.readText(filePath) : await computer.readFile(filePath) } catch { current = '' }
          next = `${current}${current ? '\n\n' : ''}${content}`
        }
        await durableWrite(filePath, next)
        return { updated: true }
      },
    }),
    handoff: tool({
      description: 'Hand work to another bot in this room and assign or create a task.',
      inputSchema: z.object({ toBot: z.string(), brief: z.string().min(1), taskId: z.string().optional() }),
      contextSchema: toolContextSchema,
      execute: async ({ toBot, brief, taskId }, { context }) => {
        const target = (await db.select({ bot: bots }).from(roomMembers).innerJoin(bots, eq(roomMembers.memberId, bots.id)).where(and(
          eq(roomMembers.roomId, context.roomId), eq(roomMembers.memberKind, 'bot'),
        ))).find(({ bot }) => bot.id === toBot || bot.slug.toLowerCase() === toBot.toLowerCase() || bot.name.toLowerCase() === toBot.toLowerCase())?.bot
        if (!target) throw new Error('Target bot is not a member of this room')
        const now = new Date().toISOString()
        let resolvedTaskId = taskId
        if (taskId) {
          await db.update(tasks).set({ ownerBotId: target.id, handoffFromBotId: context.botId, brief, status: 'in_progress', updatedAt: now }).where(and(eq(tasks.id, taskId), eq(tasks.roomId, context.roomId)))
        } else {
          resolvedTaskId = createId('task')
          await db.insert(tasks).values({ id: resolvedTaskId, roomId: context.roomId, title: brief.slice(0, 100), brief, ownerBotId: target.id, createdByKind: 'bot', createdById: context.botId, status: 'in_progress', handoffFromBotId: context.botId, createdAt: now, updatedAt: now })
        }
        const task = resolvedTaskId ? (await db.select().from(tasks).where(eq(tasks.id, resolvedTaskId)).limit(1))[0] : undefined
        if (task) hub?.broadcastRoom(context.roomId, { type: 'task.updated', task, ts: now })
        const explicit: Mention[] = [{ kind: 'bot', id: target.id, handoff: true }]
        await admission.post({ roomId: context.roomId, authorKind: 'bot', authorId: context.botId, text: `@${target.name} ${brief}`, explicitMentions: explicit, handoffDepth: context.handoffDepth })
        return { handedOffTo: target.id, taskId: resolvedTaskId }
      },
    }),
    create_task: tool({
      description: 'Create a task owned by a bot in this room.',
      inputSchema: z.object({ title: z.string().min(1), brief: z.string(), ownerBotId: z.string() }),
      contextSchema: toolContextSchema,
      execute: async ({ title, brief, ownerBotId }, { context }) => {
        if (!await admission.isMember(context.roomId, 'bot', ownerBotId)) throw new Error('Owner bot is not in this room')
        const id = createId('task')
        const now = new Date().toISOString()
        await db.insert(tasks).values({ id, roomId: context.roomId, title, brief, ownerBotId, createdByKind: 'bot', createdById: context.botId, status: 'open', handoffFromBotId: null, createdAt: now, updatedAt: now })
        const task = (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0]!
        hub?.broadcastRoom(context.roomId, { type: 'task.updated', task, ts: now })
        return { id }
      },
    }),
    update_task: tool({
      description: 'Update a task in this room.',
      inputSchema: z.object({ taskId: z.string(), title: z.string().optional(), brief: z.string().optional(), ownerBotId: z.string().optional(), status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional() }),
      contextSchema: toolContextSchema,
      execute: async ({ taskId, ...changes }, { context }) => {
        if (changes.ownerBotId && !await admission.isMember(context.roomId, 'bot', changes.ownerBotId)) throw new Error('Owner bot is not in this room')
        await db.update(tasks).set({ ...changes, updatedAt: new Date().toISOString() }).where(and(eq(tasks.id, taskId), eq(tasks.roomId, context.roomId)))
        const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1))[0]
        if (task) hub?.broadcastRoom(context.roomId, { type: 'task.updated', task, ts: new Date().toISOString() })
        return { updated: taskId }
      },
    }),
  }
}
