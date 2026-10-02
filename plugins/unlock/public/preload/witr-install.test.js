const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const install = require('./witr-install')

describe('witr-install asar safety', () => {
  it('isAsarPath detects plugin package paths', () => {
    assert.equal(install.isAsarPath('C:\\Users\\x\\.ztools\\plugins\\unlock-1.0.0.asar\\preload\\tools\\witr.exe'), true)
    assert.equal(install.isAsarPath('C:\\Users\\x\\.ztools\\plugins\\unlock-1.0.0-b33a16f8.asar\\preload\\tools\\witr.exe'), true)
    assert.equal(install.isAsarPath('C:\\home\\unlock-file\\public\\preload\\tools\\witr.exe'), false)
    assert.equal(install.isAsarPath('C:\\Users\\x\\AppData\\Local\\unlock-file\\tools\\witr.exe'), false)
  })

  it('runtimeToolsDir is outside asar and writable base', () => {
    const dir = install.runtimeToolsDir()
    assert.equal(install.isAsarPath(dir), false)
    assert.ok(dir.endsWith(path.join('unlock-file', 'tools')))
  })

  it('findWitrBinSync never returns an asar path', () => {
    const found = install.findWitrBinSync()
    if (found) {
      assert.equal(install.isAsarPath(found), false, 'spawnable witr must not be inside asar')
      assert.ok(fs.existsSync(found))
    } else {
      assert.equal(found, null)
    }
  })
})

describe('witr-install ensure', () => {
  it('ensureWitr resolves a spawnable path or null (never throws)', async () => {
    const bin = await install.ensureWitr()
    assert.ok(bin === null || typeof bin === 'string')
    if (bin) {
      assert.equal(install.isAsarPath(bin), false)
      assert.ok(fs.existsSync(bin))
    }
  })
})

describe('witr-install paths', () => {
  it('toolsWitrPath points at runtime tools dir', () => {
    const p = install.toolsWitrPath()
    assert.ok(p.endsWith('witr.exe'))
    assert.equal(install.isAsarPath(p), false)
    assert.ok(p.indexOf('unlock-file') >= 0)
  })

  it('releaseZipName is windows zip for this host', () => {
    const z = install.releaseZipName()
    assert.match(z, /^witr-windows-(amd64|arm64)\.zip$/)
  })
})
