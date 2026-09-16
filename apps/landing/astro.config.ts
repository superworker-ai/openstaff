import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL ?? 'https://myopenstaff.com',
  integrations: [sitemap({ filter: (page) => !/^\/og\/?$/.test(new URL(page).pathname) })],
  vite: {
    plugins: [tailwindcss()],
  },
})
