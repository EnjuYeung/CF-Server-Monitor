import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stylesDir = join(root, 'src/frontend/styles')
const distStatic = join(root, 'dist/static')
const remoteImport = /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i

test('frontend styles never block first paint on a remote stylesheet', async () => {
  for (const name of (await readdir(stylesDir)).filter(file => file.endsWith('.css'))) {
    const css = await readFile(join(stylesDir, name), 'utf8')
    assert.doesNotMatch(css, remoteImport, `${name} must not @import a remote stylesheet`)
    assert.doesNotMatch(css, /fonts\.googleapis\.com/, `${name} must not depend on Google Fonts`)
  }
})

test('JetBrains Mono is self-hosted and every referenced font file exists', async () => {
  const css = await readFile(join(stylesDir, 'main.css'), 'utf8')
  const urls = [...css.matchAll(/url\(['"]?(\.\.\/assets\/fonts\/[^'")]+)['"]?\)/g)].map(match => match[1])
  assert.equal(urls.length, 6, 'expected one @font-face per JetBrains Mono subset')
  assert.ok(urls.includes('../assets/fonts/jetbrains-mono-latin.woff2'))
  for (const url of urls) {
    const file = resolve(stylesDir, url)
    assert.ok((await stat(file)).size > 1000, `${url} should be a real woff2 file`)
    const magic = (await readFile(file)).subarray(0, 4).toString('latin1')
    assert.equal(magic, 'wOF2', `${url} should be woff2`)
  }
  assert.ok(existsSync(join(root, 'src/frontend/assets/fonts/OFL.txt')), 'font license must ship with the font')
})

test('built bundle serves fonts from /static/ without Google Fonts', { skip: !existsSync(distStatic) && 'dist not built' }, async () => {
  const files = await readdir(distStatic)
  let faces = 0
  for (const name of files.filter(file => file.endsWith('.css'))) {
    const css = await readFile(join(distStatic, name), 'utf8')
    assert.doesNotMatch(css, /fonts\.googleapis\.com/, `${name} must not reference Google Fonts`)
    assert.doesNotMatch(css, remoteImport, `${name} must not @import a remote stylesheet`)
    for (const [face] of css.matchAll(/@font-face\s*\{[^}]*JetBrains Mono[^}]*\}/g)) {
      faces++
      // CSP font-src has no data:, so even tiny subsets must not be inlined by Vite.
      assert.doesNotMatch(face, /url\(["']?data:/, `${name} inlines a font that CSP would block`)
      const ref = face.match(/url\(["']?\/static\/(jetbrains-mono-[^"')]+\.woff2)["']?\)/)?.[1]
      assert.ok(ref && files.includes(ref), `${name} references missing ${ref}`)
    }
  }
  assert.equal(faces, 6, 'built CSS should keep all six JetBrains Mono subsets')
})
