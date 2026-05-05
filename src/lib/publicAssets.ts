/** Files from `public/` end up beside `index.html`. Use this so paths work with `base: './'` and Electron `file://` (root-absolute `/…` URLs break offline). */
export function publicAsset(name: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const file = name.replace(/^\//, '')
  return `${base.endsWith('/') ? base : `${base}/`}${file}`
}

/** Bundled `public/logo.svg` — works offline in the desktop build. */
export const LOGO_SRC = publicAsset('logo.svg')
