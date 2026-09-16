import { APP_URL, GITHUB_URL } from '../config'
import type { ComponentProps } from 'astro/types'
import type BotFace from '../components/BotFace.astro'

export interface StaffBot {
  name: string
  fullName: string
  role: string
  lastLine: string
  time: string
  avatar: Required<Pick<ComponentProps<typeof BotFace>, 'shape' | 'color' | 'eyes' | 'mouth' | 'accessory'>>
}

export const bots = [
  {
    name: 'Ada', fullName: 'Ada Lovelace', role: 'Ops',
    lastLine: 'Updating launch tasks', time: 'now',
    avatar: { shape: 'circle', color: '#5b8def', eyes: 'round', mouth: 'smile', accessory: 'glasses' },
  },
  {
    name: 'Grace', fullName: 'Grace Hopper', role: 'Support',
    lastLine: 'Inbox is clear', time: '9:38',
    avatar: { shape: 'hex', color: '#f0616d', eyes: 'happy', mouth: 'grin', accessory: 'headphones' },
  },
  {
    name: 'Alan', fullName: 'Alan Kay', role: 'Product',
    lastLine: 'Drafted the spec', time: '9:35',
    avatar: { shape: 'blob', color: '#f5a524', eyes: 'round', mouth: 'smile', accessory: 'none' },
  },
  {
    name: 'Doug', fullName: 'Douglas Engelbart', role: 'Design',
    lastLine: 'Exported 3 frames', time: '9:31',
    avatar: { shape: 'drop', color: '#3ecf8e', eyes: 'round', mouth: 'smile', accessory: 'antenna' },
  },
  {
    name: 'Lick', fullName: 'J. C. R. Licklider', role: 'Research',
    lastLine: 'Shared market notes', time: '9:24',
    avatar: { shape: 'triangle', color: '#a78bfa', eyes: 'dot', mouth: 'smile', accessory: 'hat' },
  },
  {
    name: 'Johnny', fullName: 'John von Neumann', role: 'Data',
    lastLine: 'Weekly numbers ready', time: '9:12',
    avatar: { shape: 'circle', color: '#2dd4bf', eyes: 'wink', mouth: 'grin', accessory: 'none' },
  },
  {
    name: 'Vannevar', fullName: 'Vannevar Bush', role: 'Docs',
    lastLine: 'Wiki pages updated', time: '8:56',
    avatar: { shape: 'blob', color: '#f472b6', eyes: 'sleepy', mouth: 'flat', accessory: 'bow' },
  },
] as const satisfies readonly StaffBot[]

export interface Link {
  label: string
  href: string
}
export interface SectionCopy {
  eyebrow: string
  index: number
  title: string
  body: string
}
export interface FeatureCopy extends SectionCopy {
  id: string
  cta: Link
}
export interface Question {
  question: string
  answer: string
}

export const hero = {
  eyebrow: 'Open source · MIT licensed',
  title: 'An always-on staff of AI teammates.',
  body: 'Named bots with their own computer, working in the rooms your team already lives in. Watch them work, take over when it matters, approve what counts.',
} as const
export const actions = {
  primary: { label: 'Get started', href: APP_URL },
  secondary: { label: 'Self-host in 5 minutes', href: '#self-host' },
} as const satisfies Record<string, Link>
export const worksWith = {
  title: 'Works with the tools you already use',
  tools: [
    'Slack',
    'Gmail',
    'GitHub',
    'Notion',
    'Linear',
    'Google Calendar',
    'Stripe',
    '+600 more via Composio',
  ],
} as const
export const features = [
  {
    id: 'rooms',
    index: 1,
    eyebrow: 'Rooms',
    title: 'Chat like a team, not a prompt box.',
    body: 'Humans and named bots share the same rooms. Every bot has its own turn, its own memory, and its own job. Loop in two bots on one thread and they hand work back and forth.',
    cta: {
      label: 'How rooms work',
      href: `${GITHUB_URL}/blob/main/docs/ARCHITECTURE.md`,
    },
  },
  {
    id: 'computer',
    index: 2,
    eyebrow: 'The Computer',
    title: 'Every bot gets a real computer.',
    body: 'Browser, files, terminal, and a full desktop that persists between sessions. Watch the live stream, take the wheel for a login or a captcha, then hand it back.',
    cta: {
      label: 'Computer providers',
      href: `${GITHUB_URL}/blob/main/docs/COMPUTER_PROVIDERS.md`,
    },
  },
  {
    id: 'automations',
    index: 3,
    eyebrow: 'Automations',
    title: 'Work that keeps moving after you log off.',
    body: 'Turn recurring work into routines on a schedule or a webhook. Bots run them, log every invocation, and only come back to you when something needs approval.',
    cta: {
      label: 'Read the docs',
      href: `${GITHUB_URL}/blob/main/docs/PLAN.md`,
    },
  },
] as const satisfies readonly FeatureCopy[]
export const approvals = {
  eyebrow: 'Approvals',
  index: 4,
  title: 'You stay in control.',
  body: 'Consequential actions pause for a yes. Sending mail, paying, deleting: the bot asks, you decide, the conversation continues right where it stopped.',
} as const satisfies SectionCopy
export const models = {
  ...{
    eyebrow: 'Models',
    index: 5,
    title: 'Bring your own model.',
    body: 'Grok, Claude, GPT, OpenCode, or anything behind Vercel AI Gateway. One key gets a workspace running; switch per room whenever you like.',
  },
  providers: [
    'xAI Grok',
    'Anthropic Claude',
    'OpenAI',
    'OpenCode',
    'Vercel AI Gateway',
  ],
} as const satisfies SectionCopy & { providers: readonly string[] }
export const selfHost = {
  ...{
    eyebrow: 'Open source',
    index: 6,
    title: 'Run it on your laptop, or your cloud.',
    body: 'MIT licensed. One repo, one database, one Docker Compose stack.',
  },
  commands: [
    `git clone ${GITHUB_URL}`,
    'cd open-superworkers && pnpm i && cp .env.example .env',
    'pnpm dev',
  ],
  deploys: [
    { label: 'Deploy on Railway', href: 'https://railway.com/new' },
    {
      label: 'Deploy to Render',
      href: 'https://render.com/deploy?repo=https://github.com/juancgarza/open-superworkers',
    },
    {
      label: 'Deploy to Cloudflare',
      href: 'https://deploy.workers.cloudflare.com/?url=https://github.com/juancgarza/open-superworkers/tree/main/deploy/cloudflare',
    },
  ],
} as const satisfies SectionCopy & {
  commands: readonly string[]
  deploys: readonly Link[]
}
export const faq = {
  title: 'Questions',
  questions: [
    {
      question: 'Is it really open source?',
      answer:
        'Yes. OpenStaff is MIT licensed, and you can self-host the full product anywhere. The hosted version is there for convenience.',
    },
    {
      question: 'Do I need my own API keys?',
      answer:
        'When self-hosting, yes: use one of XAI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENCODE_API_KEY, or AI_GATEWAY_API_KEY. The hosted app can manage keys for you.',
    },
    {
      question: 'Is the bot’s computer safe?',
      answer:
        'Local runs as the server user and is intended for trusted deployments. Docker, E2B, and other providers isolate commands, while approvals gate consequential tools.',
    },
    {
      question: 'Which chat apps?',
      answer:
        'The web app today. Its rooms are designed for several bots and people to work together in each thread.',
    },
  ],
} as const satisfies { title: string; questions: readonly Question[] }
export const finalCta = { title: 'Put your first bot to work today.' } as const
export const horizon = {
  eyebrow: 'Open range',
  title: ['Own your bots.', 'Own your work.'],
  body: 'Open source and self-hostable, so the staff you build, the memory it keeps, and the work it ships stay yours.',
  actions: {
    primary: actions.primary,
    secondary: { label: 'Star on GitHub', href: GITHUB_URL },
  },
} as const
