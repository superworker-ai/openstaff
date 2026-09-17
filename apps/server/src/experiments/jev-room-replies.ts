import '../load-env.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createId, type Turn } from '@openstaff/shared'
import { eq } from 'drizzle-orm'
import { AgentRuntime } from '../agent/runtime.js'
import { JevDecisionService, ReplyDecisionExperiment, REPLY_QUESTION_VERSION, type ReplyObservation } from '../agent/reply-decision.js'
import { resolveModel } from '../agent/models.js'
import { bots, roomMembers, rooms, turns } from '../db/schema.js'
import { fixture } from '../test/fixture.js'
import { ROOM_REPLY_SCENARIOS } from './room-reply-scenarios.js'

const root = path.resolve(import.meta.dirname, '../../../..')
const output = path.resolve(root, process.env.JEV_EXPERIMENT_OUTPUT || '.context/jev-room-replies.json')
const model = process.env.JEV_BASELINE_MODEL || process.env.REPLY_DECISION_MODEL || process.env.DEFAULT_MODEL
if (!process.env.TYPESAFE_API_KEY) throw new Error('Set TYPESAFE_API_KEY for this opt-in paid experiment')
if (!model) throw new Error('Set JEV_BASELINE_MODEL to a configured provider/model')
process.env.REPLY_DECISION_MODEL = model
const repeats = Number(process.env.JEV_EXPERIMENT_REPEATS || 1)
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('JEV_EXPERIMENT_REPEATS must be 1, 2, or 3')
const timeoutMs = Number(process.env.JEV_EXPERIMENT_TIMEOUT_MS || 1_200)
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 6_000) throw new Error('JEV_EXPERIMENT_TIMEOUT_MS must be from 100 to 6000')
resolveModel(model) // Fail before creating fixtures if the baseline key is unavailable.
const observations = new Map<string, ReplyObservation>()
const experiment = new ReplyDecisionExperiment(new JevDecisionService(process.env.TYPESAFE_API_KEY, process.env.JEV_EXPERIMENT_MODEL || 'jev-latest'), {
  timeoutMs, record: async (context, observation) => { observations.set(context.turnId!, observation) },
})
const rows: Array<{ id: string; repeat: number; expected: string; baselineError?: boolean; observation?: ReplyObservation }> = []
const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = values.toSorted((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

try {
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const scenario of ROOM_REPLY_SCENARIOS) {
      const f = await fixture()
      try {
        const original = (await f.db.select().from(bots))[0]!, teammate = createId('bot')
        const candidateName = scenario.candidateName ?? 'Candidate'
        const teammateDetails = scenario.teammate ?? { name: 'Teammate', job: 'Another room participant' }
        await f.db.update(bots).set({ name: candidateName, slug: candidateName.toLocaleLowerCase(), job: scenario.job }).where(eq(bots.id, f.botId))
        await f.db.insert(bots).values({ ...original, id: teammate, slug: teammateDetails.name.toLocaleLowerCase(), name: teammateDetails.name, job: teammateDetails.job })
        await f.db.insert(roomMembers).values({ roomId: f.roomId, memberId: teammate, memberKind: 'bot', joinedAt: new Date().toISOString() })
        await f.db.update(rooms).set({ kind: 'group' }).where(eq(rooms.id, f.roomId))
        for (const text of scenario.earlier ?? []) {
          await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: teammate, text: text.replace(/^\[Teammate\] /, ''), planReplies: false })
        }
        const posted = await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: scenario.request })
        const stored = await f.db.select().from(turns)
        const candidateTurn = stored.find((turn) => turn.triggerMessageId === posted.message.id && turn.botId === f.botId)!
        const teammateTurn = stored.find((turn) => turn.triggerMessageId === posted.message.id && turn.botId === teammate)!
        for (const text of scenario.teammateReplies ?? []) {
          await f.admission.post({ roomId: f.roomId, authorKind: 'bot', authorId: teammate, text, turnId: teammateTurn.id, planReplies: false })
        }
        await f.db.update(turns).set({ status: 'done' }).where(eq(turns.id, teammateTurn.id))
        const runtime = new AgentRuntime({ ...f, contextMessages: 60, modelResolver: (id, options) => resolveModel(id, undefined, options), replyDecisionExperiment: () => experiment })
        let baselineError = false
        try { await runtime.decideReply(candidateTurn as Turn) } catch { baselineError = true }
        await experiment.drain()
        const observation = observations.get(candidateTurn.id)
        const row = { id: scenario.id, repeat, expected: scenario.expected, ...(baselineError ? { baselineError } : {}), observation }
        rows.push(row)
        console.log(JSON.stringify({ id: row.id, repeat, expected: row.expected, baseline: observation?.baseline, jev: observation?.jev, agrees: observation?.agrees }))
      } finally { await f.close() }
    }
  }
} finally {
  await experiment.close()
  const completed = rows.flatMap((row) => row.observation ? [{ ...row, observation: row.observation }] : [])
  const jevSuccesses = completed.flatMap((row) => 'probabilities' in row.observation.jev ? [row.observation.jev] : [])
  const baselineSuccesses = completed.flatMap((row) => 'reply' in row.observation.baseline ? [row.observation.baseline] : [])
  const labeled = completed.filter((row) => row.expected !== 'ambiguous')
  const accepted = labeled.filter((row) => 'recommendation' in row.observation.jev && row.observation.jev.recommendation !== 'defer')
  const summary = {
    questionVersion: REPLY_QUESTION_VERSION, baselineModel: model, repeats, requests: rows.length, timeoutMs,
    jevSuccesses: jevSuccesses.length, baselineSuccesses: baselineSuccesses.length,
    jevMedianMs: median(jevSuccesses.map((r) => r.elapsedMs)), baselineMedianMs: median(baselineSuccesses.map((r) => r.elapsedMs)),
    labeledCases: labeled.length, acceptedCases: accepted.length,
    acceptedCorrect: accepted.filter((r) => 'recommendation' in r.observation.jev && r.observation.jev.recommendation === r.expected).length,
    baselineCorrect: labeled.filter((r) => 'reply' in r.observation.baseline && (r.observation.baseline.reply ? 'reply' : 'skip') === r.expected).length,
    jevInputTokens: jevSuccesses.reduce((sum, row) => sum + row.inputTokens, 0),
    baselineInputTokens: baselineSuccesses.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    baselineOutputTokens: baselineSuccesses.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    method: 'Synthetic SQLite room snapshots through the actual AgentRuntime.decideReply path. Real Jev and baseline calls run concurrently. Earlier teammate messages are scripted, not generated. No tools or user rooms are accessed. Exploratory thresholds fixed before this run; no held-out validation.',
  }
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, JSON.stringify({ timestamp: new Date().toISOString(), summary, rows }, null, 2))
  console.log(JSON.stringify({ summary, output }))
}
