/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_APP_URL?: string
  readonly PUBLIC_GITHUB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
