import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseCspOrigins, buildBackgroundStyle, injectTitle, injectApiBase, stripCspMeta } from './src/utils/csp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:8080'
const devAdminPath = `/${String(process.env.ADMIN_PATH || loadEnvFile().ADMIN_PATH || '').replace(/^\//, '')}`

const createWorkerProxy = () => ({
  target: devProxyTarget,
  changeOrigin: true,
  secure: false,
  ws: true
})

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '.env')
  const env = {}
  if (!fs.existsSync(envPath)) return env
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function envPlugin() {
  const env = loadEnvFile()
  const apiBaseRaw = env.API_BASE || ''
  const cspApiRaw = env.CSP_API || ''
  const backgroundImage = env.BACKGROUND_IMAGE || ''
  const mobileBackgroundImage = env.BACKGROUND_IMAGE_MOBILE || ''
  const title = env.TITLE || ''

  // API_BASE 与 CSP_API 合并，写入运行时 apiBase meta。
  const rawApiDomains = [
    ...parseCspOrigins(apiBaseRaw),
    ...parseCspOrigins(cspApiRaw)
  ]

  return {
    name: 'env-inject',
    transformIndexHtml(html, context) {
      html = stripCspMeta(html)
      html = injectTitle(html, title)
      html = injectApiBase(html, rawApiDomains)
      const requestPath = (context.originalUrl || context.path).split('?')[0]
      if (context.server && /^[A-Za-z0-9_-]{8,128}$/.test(devAdminPath.slice(1)) && [devAdminPath, `${devAdminPath}/`].includes(requestPath)) {
        html = html.replace('</head>', `<meta name="adminEntry" content="${devAdminPath}"></head>`)
      }
      if (backgroundImage || mobileBackgroundImage) {
        const bgStyle = buildBackgroundStyle(backgroundImage, mobileBackgroundImage)
        html = html.replace('</head>', `${bgStyle}\n</head>`)
      }
      return html
    }
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), envPlugin()],
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/frontend')
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'static',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'static/[name]-[hash].js',
        chunkFileNames: 'static/[name]-[hash].js',
        assetFileNames: 'static/[name]-[hash].[ext]'
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': createWorkerProxy(),
      ...(devAdminPath !== '/' ? { [`${devAdminPath}/api`]: createWorkerProxy(), [`${devAdminPath}/backup`]: createWorkerProxy() } : {}),
      '/theme': createWorkerProxy(),
      '/update': createWorkerProxy(),
      '/agent': createWorkerProxy(),
      '/updateDatabase': createWorkerProxy(),
      '/clearHistory': createWorkerProxy(),
      '/healthz': createWorkerProxy()
    }
  }
})
