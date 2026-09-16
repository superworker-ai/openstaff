import type { APIRoute } from 'astro'
import {
  hero,
  actions,
  worksWith,
  features,
  bots,
  approvals,
  models,
  selfHost,
  faq,
  finalCta,
  horizon,
} from '../content/landing'
import { GITHUB_URL } from '../config'

export const prerender = true

export const GET: APIRoute = () => {
  const link = (item: { label: string; href: string }) =>
    `[${item.label}](${item.href})`
  const text =
    [
      `# OpenStaff: ${horizon.title.join(' ')}`,
      horizon.body,
      `${link(horizon.actions.primary)} · ${link(horizon.actions.secondary)}`,
      `## ${hero.title}`,
      hero.eyebrow,
      hero.body,
      `${link(actions.primary)} · ${link(actions.secondary)}`,
      `## ${worksWith.title}`,
      worksWith.tools.join(' · '),
      ...features.flatMap((feature) => [
        `## ${feature.eyebrow}: ${feature.title}`,
        feature.body,
        ...(feature.id === 'rooms' ? [`Meet the staff: ${bots.map((bot) => bot.name).join(' · ')}`] : []),
        link(feature.cta),
      ]),
      `## ${approvals.eyebrow}: ${approvals.title}`,
      approvals.body,
      `## ${models.eyebrow}: ${models.title}`,
      models.body,
      models.providers.join(' · '),
      `## ${selfHost.eyebrow}: ${selfHost.title}`,
      selfHost.body,
      ['```sh', ...selfHost.commands, '```'].join('\n'),
      selfHost.deploys.map(link).join(' · '),
      `## ${faq.title}`,
      ...faq.questions.flatMap((item) => [`### ${item.question}`, item.answer]),
      `## ${finalCta.title}`,
      `${link(actions.primary)} · ${link(actions.secondary)}`,
      `[GitHub](${GITHUB_URL})`,
    ].join('\n\n') + '\n'
  return new Response(text, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
