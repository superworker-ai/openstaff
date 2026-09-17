import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApplication } from '../app.js'

describe('bots API', () => {
  it('updates only supplied fields without applying creation defaults', async () => {
    const directory = await fs.mkdtemp(path.resolve('data-test-bots-api-'))
    const running = await createApplication({ config: { dataDir: directory, maxConcurrentTurns: 0 } })
    let cookie = ''
    const request = async (url: string, method = 'GET', body?: unknown) => {
      const response = await running.app.request(url, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { response, data: await response.json() as Record<string, any> }
    }
    try {
      const signup = await request('/api/auth/sign-up/email', 'POST', { name: 'Owner', email: 'owner@example.test', password: 'password123' })
      cookie = signup.response.headers.get('set-cookie')!.split(';')[0]!
      const avatar = { shape: 'hex', color: '#7A5AF8', eyes: 'happy', mouth: 'grin', accessory: 'glasses', personality: 'gremlin' }
      const created = await request('/api/bots', 'POST', {
        name: 'Researcher',
        job: 'Deep research partner',
        instructions: 'Keep these exact instructions.\nThey must survive a rename.',
        avatar,
        model: 'openai/custom-model',
        reasoningEffort: 'high',
        approvalPolicy: 'auto',
      })
      expect(created.response.status).toBe(201)
      const id = created.data.bot.id as string

      const renamed = await request(`/api/bots/${id}`, 'PATCH', { name: 'Renamed researcher' })
      expect(renamed.response.status).toBe(200)
      expect(renamed.data.bot).toMatchObject({
        name: 'Renamed researcher',
        job: 'Deep research partner',
        instructions: 'Keep these exact instructions.\nThey must survive a rename.',
        avatar,
        model: 'openai/custom-model',
        reasoningEffort: 'high',
        approvalPolicy: 'auto',
      })

      const explicitlyChanged = await request(`/api/bots/${id}`, 'PATCH', { instructions: '', approvalPolicy: 'all' })
      expect(explicitlyChanged.response.status).toBe(200)
      expect(explicitlyChanged.data.bot).toMatchObject({
        name: 'Renamed researcher',
        job: 'Deep research partner',
        instructions: '',
        avatar,
        model: 'openai/custom-model',
        reasoningEffort: 'high',
        approvalPolicy: 'all',
      })
    } finally {
      await running.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
