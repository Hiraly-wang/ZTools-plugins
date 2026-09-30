import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, statSync } from 'node:fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const install = require(path.join(__dirname, '..', 'public', 'preload', 'witr-install.js'))

// Prefer extracting the bundled copy (works offline); else download to real runtime dir.
const force = process.argv.includes('--force')
const runtimeDest = install.runtimeWitrPath()

if (existsSync(runtimeDest) && !force) {
  console.log('[install-witr] already present:', runtimeDest)
  process.exit(0)
}

if (!force) {
  const extracted = install.extractBundledWitr()
  if (extracted) {
    console.log('[install-witr] extracted bundled →', extracted, statSync(extracted).size, 'bytes')
    process.exit(0)
  }
}

const zipName = install.releaseZipName()
console.log('[install-witr] downloading', zipName, '→', runtimeDest)

install.downloadWitr()
  .then((bin) => {
    console.log('[install-witr] ok', bin, statSync(bin).size, 'bytes')
    process.exit(0)
  })
  .catch((err) => {
    console.warn('[install-witr] zip failed:', err.message)
    return install.ensureWitr().then((bin) => {
      if (bin) {
        console.log('[install-witr] ok via fallback', bin)
        process.exit(0)
      }
      console.warn('[install-witr] failed (optional). Manual: winget install PranshuParmar.witr')
      process.exit(0)
    })
  })