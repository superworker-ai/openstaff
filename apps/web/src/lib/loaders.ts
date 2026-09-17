import { createServerFn } from '@tanstack/react-start'
import type { Approval, Avatar, Bot, HomeFeed, Message, PublicTurn, Room, Task, User, WorkspacePlanDetails } from '@openstaff/shared'
import { serverApi } from './server-api'

export interface RoomMemberView {
  roomId: string
  memberKind: 'user' | 'bot'
  memberId: string
  joinedAt: string
  entity?: Bot | User
}

export interface RoomView extends Room {
  members: RoomMemberView[]
}

export interface RoomData {
  room: RoomView
  rooms: RoomView[]
  messages: Message[]
  turns: PublicTurn[]
  bots: Bot[]
  users: User[]
  tasks: Task[]
  approvals: Approval[]
}

export interface AuthConfig {
  password: boolean
  magicLink: boolean
  signup: 'open' | 'code' | 'invite'
  socialProviders: string[]
  sso: boolean
  emailVerification: boolean
}

export const loadMe = createServerFn({ method: 'GET' }).handler(() => serverApi<{ user: User }>('/api/auth/get-session'))
export const loadPlan = createServerFn({ method: 'GET' }).handler(() => serverApi<WorkspacePlanDetails>('/api/plan'))
export const loadAuthConfig = createServerFn({ method: 'GET' }).handler(() => serverApi<AuthConfig>('/api/auth-config'))

export const loadRooms = createServerFn({ method: 'GET' }).handler(() => serverApi<{ rooms: RoomView[] }>('/api/rooms'))

export const loadAppShell = createServerFn({ method: 'GET' }).handler(async () => {
  const [roomList, botList, userList] = await Promise.all([
    serverApi<{ rooms: RoomView[] }>('/api/rooms'),
    serverApi<{ bots: Bot[] }>('/api/bots'),
    serverApi<{ users: User[] }>('/api/users'),
  ])
  return { rooms: roomList.rooms, bots: botList.bots, users: userList.users }
})

export const loadHomeFeed = createServerFn({ method: 'GET' }).handler(() => serverApi<HomeFeed>('/api/home/feed'))

export interface BotTemplate { id: string; name: string; job: string; instructions: string; avatar: Avatar; suggestedApps: string[] }
export const loadBotTemplates = createServerFn({ method: 'GET' }).handler(() => serverApi<{ templates: BotTemplate[] }>('/api/bots/templates'))

export const loadBot = createServerFn({ method: 'GET' })
  .validator((data: { botId: string }) => data)
  .handler(({ data }) => serverApi<{ bot: Bot }>(`/api/bots/${data.botId}`))

export const loadRoomData = createServerFn({ method: 'GET' })
  .validator((data: { roomId: string }) => data)
  .handler(async ({ data }): Promise<RoomData> => {
    const [room, roomList, messageList, turnList, botList, userList, taskList, approvalList] = await Promise.all([
      serverApi<{ room: RoomView }>(`/api/rooms/${data.roomId}`),
      serverApi<{ rooms: RoomView[] }>('/api/rooms'),
      serverApi<{ messages: Message[] }>(`/api/rooms/${data.roomId}/messages?limit=200`),
      serverApi<{ turns: PublicTurn[] }>(`/api/rooms/${data.roomId}/turns`),
      serverApi<{ bots: Bot[] }>('/api/bots'),
      serverApi<{ users: User[] }>('/api/users'),
      serverApi<{ tasks: Task[] }>(`/api/tasks?roomId=${encodeURIComponent(data.roomId)}`),
      serverApi<{ approvals: Approval[] }>(`/api/approvals?roomId=${encodeURIComponent(data.roomId)}`),
    ])
    return { room: room.room, rooms: roomList.rooms, messages: messageList.messages, turns: turnList.turns, bots: botList.bots, users: userList.users, tasks: taskList.tasks, approvals: approvalList.approvals }
  })
