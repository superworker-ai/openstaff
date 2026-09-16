# Provider logo sources

All five SVGs in this directory are the monochrome icon variants from the maintained [Lobe Icons](https://github.com/lobehub/lobe-icons) collection. The upstream files are self contained path data, with no scripts, images, fonts, or external references.

| File | Exact upstream asset | Brand reference | License |
| --- | --- | --- | --- |
| `grok.svg` | [`packages/static-svg/icons/grok.svg`](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/grok.svg) | [xAI brand guidelines](https://x.ai/legal/brand-guidelines) | Lobe Icons MIT license; Grok and xAI marks remain trademarks of their owners |
| `claude.svg` | [`packages/static-svg/icons/claude.svg`](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/claude.svg) | No standalone public Claude brand-guideline URL located | Lobe Icons MIT license; Claude and Anthropic marks remain trademarks of their owners |
| `openai.svg` | [`packages/static-svg/icons/openai.svg`](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/openai.svg) | [OpenAI design guidelines](https://openai.com/brand/) | Lobe Icons MIT license; OpenAI marks remain trademarks of their owners |
| `opencode.svg` | [`packages/static-svg/icons/opencode.svg`](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/opencode.svg) | [OpenCode brand guidelines](https://opencode.ai/brand) | Lobe Icons MIT license; OpenCode marks remain trademarks of their owners |
| `vercel.svg` | [`packages/static-svg/icons/vercel.svg`](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/vercel.svg) | [Vercel AI Gateway](https://vercel.com/ai-gateway) | Lobe Icons MIT license; Vercel marks remain trademarks of their owners |

The upstream collection is distributed under the [MIT license](https://github.com/lobehub/lobe-icons/blob/master/LICENSE) © 2023 LobeHub. The files here were sanitized only to remove presentation sizing and `currentColor`: each has `fill="#000000"`, a `24 24` viewBox, a title, and inline path data. Claude also has an upstream color variant, but this landing set uses black for consistent provider treatment; CSS can invert the icons for a dark theme.
