import { and, asc, eq, inArray } from 'drizzle-orm'
import type { ModelMessage } from 'ai'
import type { Computer } from '../computer/types.js'
import type { Database } from '../db/index.js'
import { bots, messages, roomMembers, rooms, tasks, users } from '../db/schema.js'
import { labelMessage, loadRoomHistory } from './history.js'
import type { PluginRegistry } from '../plugins/registry.js'
import type { DurableWorkspace } from '../storage/durable.js'

export interface TurnPrompt {
  instructions: string
  messages: ModelMessage[]
}

async function readMemory(computer: Computer, slug: string, durable?: DurableWorkspace): Promise<string> {
  try {
    const value = durable ? await durable.readText(`bots/${slug}/MEMORY.md`) : await computer.readFile(`bots/${slug}/MEMORY.md`)
    return Buffer.from(value).subarray(0, 8 * 1024).toString()
  } catch {
    return '(No memory saved yet.)'
  }
}

export async function skillsIndex(computer: Computer, durable?: DurableWorkspace): Promise<string> {
  try {
    if (durable) {
      return await durable.skillsIndex()
    }
    const directories = (await computer.list('skills')).filter((entry) => entry.type === 'directory')
    const lines: string[] = []
    for (const directory of directories) {
      try {
        const body = await computer.readFile(`skills/${directory.name}/SKILL.md`)
        const description = /^description:\s*(.+)$/m.exec(body)?.[1] ?? 'No description'
        lines.push(`${directory.name}: ${description}`)
      } catch { continue }
    }
    return lines.length ? lines.join('\n') : '(No skills saved yet.)'
  } catch {
    return '(No skills saved yet.)'
  }
}

export function environmentSection(now: Date = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const local = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(now)
  return `Environment\nCurrent date and time: ${now.toISOString()} (UTC), which is ${local} in the server timezone ${timeZone}. Use this for anything date-sensitive (deadlines, recency, "today", "this week"); never guess the date from training data.`
}

export async function buildTurnPrompt(
  db: Database,
  computer: Computer,
  turn: { roomId: string; botId: string; triggerMessageId: string },
  contextMessages: number,
  registry?: PluginRegistry,
  durable?: DurableWorkspace,
  now: Date = new Date(),
): Promise<TurnPrompt> {
  const bot = (await db.select().from(bots).where(eq(bots.id, turn.botId)).limit(1))[0]
  const room = (await db.select().from(rooms).where(eq(rooms.id, turn.roomId)).limit(1))[0]
  const trigger = (await db.select().from(messages).where(eq(messages.id, turn.triggerMessageId)).limit(1))[0]
  if (!bot || !room || !trigger) throw new Error('Turn context is incomplete')
  const botRoster = await db.select({ bot: bots }).from(roomMembers).innerJoin(bots, eq(roomMembers.memberId, bots.id)).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.memberKind, 'bot'))).orderBy(asc(roomMembers.joinedAt))
  const userRoster = await db.select({ user: users }).from(roomMembers).innerJoin(users, eq(roomMembers.memberId, users.id)).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.memberKind, 'user'))).orderBy(asc(roomMembers.joinedAt))
  const openTasks = await db.select().from(tasks).where(and(eq(tasks.roomId, room.id), eq(tasks.ownerBotId, bot.id), inArray(tasks.status, ['open', 'in_progress'])))
  const historyText = await loadRoomHistory(db, room.id, contextMessages, trigger.id) || '(No earlier messages.)'
  const roster = [
    ...botRoster.map(({ bot: member }) => `${member.name} (@${member.slug}), bot, ${member.job}`),
    ...userRoster.map(({ user }) => `${user.name}, human`),
  ].join('\n')
  const taskText = openTasks.map((task) => `${task.id}: ${task.title} (${task.status})\n${task.brief}`).join('\n\n') || '(No open tasks.)'

  const instructions = [
    `Identity\nYou are ${bot.name}, ${bot.job}.\n${bot.instructions}`,
    environmentSection(now),
    `Room contract\nYou are in a ${room.kind} chat named ${room.name ?? bot.name}. Reply concisely like a teammate in chat. Do not @mention teammates unless you need them to act; to delegate, use the handoff tool. Never address humans by their full name; use their first name or nothing. Never reply just to agree, acknowledge, or repeat what a teammate said; if you have nothing new, reply with nothing. Stay in your lane. Never narrate tool calls. Ask for approval only through tools. When a tool is denied, do not retry the same action. A human may take over the computer, so browser tools wait until control returns; then take a fresh snapshot and never repeat a password, 2FA, CAPTCHA, or payment step the human completed.\n\nRoster\n${roster}`,
    `Memory\n${await readMemory(computer, bot.slug, durable)}`,
    `Skills index\n${await skillsIndex(computer, durable)}\n${registry?.enabled().flatMap((plugin) => plugin.skills.filter((skill) => skill.frontmatter['disable-model-invocation'] !== true).map((skill) => `${plugin.manifest.name}/${skill.name}: ${skill.description}`)).join('\n') ?? ''}\nLoad a skill body with read_skill only when needed; use read_plugin_file for sibling references.`,
    `Rules\n${registry?.enabled().flatMap((plugin) => plugin.rules.filter((rule) => rule.frontmatter.alwaysApply === true).map((rule) => rule.body)).join('\n\n') || '(No always-applied plugin rules.)'}`,
    `Computer\nPrefer browser_* when a web page has a usable browser_snapshot. browser_navigate reuses the tab already on screen; pass newTab only when that tab must stay open. Use computer_* for desktop apps, canvases, dialogs, or when browser tools fail. Always call computer_screenshot before the first desktop click and after unexpected results. Computer coordinates are native screenshot pixels and must come from the screenshot you were shown.`,
    `Delegation hints\n${registry?.enabled().flatMap((plugin) => plugin.agents.map((agent) => `${plugin.manifest.name}/${agent.name}: ${agent.description}`)).join('\n') || '(No delegation hints.)'}\nThese are reference hints, not executable agents.`,
    `Open tasks owned by you in this room\n${taskText}`,
  ].join('\n\n')
  return {
    instructions,
    messages: [
      { role: 'user', content: `Room history:\n${historyText}` },
      { role: 'user', content: await labelMessage(db, trigger) },
    ],
  }
}
