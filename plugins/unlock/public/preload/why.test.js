const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  formatAncestryText,
  formatSourceLine,
  normalizeChain,
  normalizeSource,
  parseWitrResult,
  parseWitrJsonStream,
  parseWitrMultipleTargets,
  parseNativeWhy,
  splitJsonObjects,
  buildNativeWhyScript
} = require('./why')

// Trimmed fixture matching real `witr --pid N --json` shape (Go capitalized keys)
const WITR_PID_JSON = {
  Target: { Type: 'pid', Value: '3068' },
  ResolvedTarget: 'powershell.exe',
  Process: {
    PID: 3068,
    PPID: 39288,
    Command: 'powershell.exe',
    Cmdline: 'powershell.exe -NoProfile -Command ...',
    Exe: 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    StartedAt: '2026-09-23T17:38:45.0559122+08:00',
    User: 'TAITRES\\9206',
    WorkingDir: 'C:\\home\\unlock-file\\',
    GitRepo: 'unlock-file',
    GitBranch: 'master',
    Container: '',
    Service: '',
    Sockets: [
      { Inode: '', Port: 38765, Address: '127.0.0.1', State: 'LISTEN', Protocol: 'TCP' }
    ],
    Health: 'healthy',
    ExeDeleted: false
  },
  RestartCount: 0,
  Ancestry: [
    { PID: 13568, PPID: 0, Command: '', Cmdline: '', Exe: '' },
    { PID: 13760, PPID: 13568, Command: 'Explorer.EXE', Cmdline: 'C:\\WINDOWS\\Explorer.EXE', Exe: 'C:\\WINDOWS\\Explorer.EXE' },
    { PID: 17864, PPID: 13760, Command: 'Xiaomi MiMo.exe', Cmdline: '...', Exe: '...' },
    { PID: 3068, PPID: 39288, Command: 'powershell.exe', Cmdline: '...', Exe: '...' }
  ],
  Source: {
    Type: 'shell',
    Name: 'pwsh.exe',
    Description: '',
    UnitFile: '',
    Details: null
  },
  Warnings: null,
  SocketInfo: null,
  ResourceContext: null,
  FileContext: null
}

const WITR_FILE_JSON = Object.assign({}, WITR_PID_JSON, {
  Target: { Type: 'file', Value: 'C:\\Users\\9206\\AppData\\Local\\Temp\\witr-lock-test.txt' }
})

const WITR_WARNINGS_JSON = {
  PID: 28696,
  Process: 'pwsh.exe',
  Command: 'pwsh.exe -NoLogo ...',
  Warnings: ['Process is running as root']
}

describe('formatAncestryText', () => {
  it('matches witr human short form: Name (pid N)', () => {
    const text = formatAncestryText([
      { pid: 13568, name: '(unknown)' },
      { pid: 13760, name: 'Explorer.EXE' },
      { pid: 3068, name: 'powershell.exe' }
    ])
    assert.equal(text, '(unknown) (pid 13568) → Explorer.EXE (pid 13760) → powershell.exe (pid 3068)')
  })

  it('returns empty for empty chain', () => {
    assert.equal(formatAncestryText([]), '')
    assert.equal(formatAncestryText(null), '')
  })
})

describe('formatSourceLine', () => {
  it('renders Name (type) like witr', () => {
    assert.equal(formatSourceLine({ type: 'shell', name: 'pwsh.exe' }), 'pwsh.exe (shell)')
    assert.equal(formatSourceLine({ type: 'windows_service', name: 'Spooler' }), 'Spooler (windows_service)')
    assert.equal(formatSourceLine({ type: 'unknown', name: '' }), 'unknown')
  })
})

describe('normalizeChain', () => {
  it('accepts Go-style PID/Command and maps empty Command to (unknown)', () => {
    const chain = normalizeChain([
      { PID: 13568, PPID: 0, Command: '' },
      { PID: 13760, PPID: 13568, Command: 'Explorer.EXE', Exe: 'C:\\WINDOWS\\Explorer.EXE' }
    ])
    assert.equal(chain[0].name, '(unknown)')
    assert.equal(chain[1].name, 'Explorer.EXE')
    assert.equal(chain[1].exe, 'C:\\WINDOWS\\Explorer.EXE')
  })
})

describe('normalizeSource', () => {
  it('keeps Type/Name/Description/UnitFile from witr Source', () => {
    const src = normalizeSource({
      Type: 'shell',
      Name: 'Explorer.EXE',
      Description: '',
      UnitFile: '',
      Details: null
    })
    assert.equal(src.type, 'shell')
    assert.equal(src.name, 'Explorer.EXE')
    assert.equal(src.unitFile, '')
  })

  it('handles missing source', () => {
    assert.equal(normalizeSource(null).type, 'unknown')
  })
})

describe('parseWitrResult (real Result shape)', () => {
  it('parses full Result with Ancestry + Source + Process context', () => {
    const why = parseWitrResult(JSON.stringify(WITR_PID_JSON))
    assert.equal(why.engine, 'witr')
    assert.equal(why.target.type, 'pid')
    assert.equal(why.process.pid, 3068)
    assert.equal(why.process.command, 'powershell.exe')
    assert.equal(why.process.user, 'TAITRES\\9206')
    assert.equal(why.process.gitRepo, 'unlock-file')
    assert.equal(why.process.gitBranch, 'master')
    assert.equal(why.workingDir, 'C:\\home\\unlock-file\\')
    assert.equal(why.source.type, 'shell')
    assert.equal(why.source.name, 'pwsh.exe')
    assert.equal(why.sourceLine, 'pwsh.exe (shell)')
    assert.equal(why.ancestryText, '(unknown) (pid 13568) → Explorer.EXE (pid 13760) → Xiaomi MiMo.exe (pid 17864) → powershell.exe (pid 3068)')
    assert.equal(why.sockets.length, 1)
    assert.equal(why.sockets[0].port, 38765)
    assert.deepEqual(why.warnings, [])
  })

  it('parses file-target Result', () => {
    const why = parseWitrResult(WITR_FILE_JSON)
    assert.equal(why.target.type, 'file')
    assert.ok(why.target.value.indexOf('witr-lock-test.txt') >= 0)
    assert.equal(why.process.pid, 3068)
  })

  it('parses short ancestry-only array', () => {
    const why = parseWitrResult([
      { PID: 4, Command: 'System' },
      { PID: 20, Command: 'python' }
    ])
    assert.equal(why.engine, 'witr')
    assert.equal(why.ancestryText, 'System (pid 4) → python (pid 20)')
  })

  it('parses warnings-only JSON', () => {
    const why = parseWitrResult(WITR_WARNINGS_JSON)
    assert.equal(why.process.pid, 28696)
    assert.deepEqual(why.warnings, ['Process is running as root'])
  })

  it('returns null on garbage', () => {
    assert.equal(parseWitrResult('not json'), null)
    assert.equal(parseWitrResult(''), null)
  })
})

describe('parseWitrJsonStream', () => {
  it('parses a single Result document', () => {
    const results = parseWitrJsonStream(JSON.stringify(WITR_PID_JSON))
    assert.equal(results.length, 1)
    assert.equal(results[0].process.pid, 3068)
  })

  it('parses concatenated multi-target documents', () => {
    const stream = JSON.stringify(WITR_PID_JSON) + '\n' + JSON.stringify(WITR_FILE_JSON)
    const results = parseWitrJsonStream(stream)
    assert.equal(results.length, 2)
  })
})

describe('parseWitrMultipleTargets', () => {
  // 真实样本：witr --file 遇到多个占用者时退出码 4，输出的是人类可读列表而非 JSON
  const MULTI = [
    'Multiple matching processes found:',
    '',
    '[1] powershell.exe (pid 43396)',
    '    powershell.exe -NoProfile -NonInteractive -Command "$fs=[System.IO.File]::Open(\'C:\\tmp\\a.txt\',\\"Open\\")"',
    '[2] powershell.exe (pid 38476)',
    '    powershell.exe -NoProfile -Command "..."',
    '',
    'Re-run with:',
    '  witr --pid <pid>',
    ''
  ].join('\n')

  it('extracts every pid from the prose list', () => {
    const targets = parseWitrMultipleTargets(MULTI)
    assert.equal(targets.length, 2)
    assert.deepEqual(targets.map(t => t.pid), [43396, 38476])
    assert.equal(targets[0].name, 'powershell.exe')
  })

  it('ignores the re-run hint and duplicated pids', () => {
    const withDup = MULTI + '\n[3] powershell.exe (pid 43396)\n'
    const targets = parseWitrMultipleTargets(withDup)
    assert.deepEqual(targets.map(t => t.pid), [43396, 38476])
  })

  it('returns nothing for ordinary JSON / empty output', () => {
    assert.deepEqual(parseWitrMultipleTargets(JSON.stringify(WITR_PID_JSON)), [])
    assert.deepEqual(parseWitrMultipleTargets(''), [])
  })
})

describe('parseNativeWhy', () => {
  it('parses PowerShell why JSON', () => {
    const raw = JSON.stringify({
      ancestry: [
        { pid: 4, name: 'System', cmd: '', ppid: 0, exe: '' },
        { pid: 50, name: 'pwsh.exe', cmd: 'pwsh', ppid: 4, exe: '' },
        { pid: 80, name: 'node.exe', cmd: 'node app.js', ppid: 50, exe: 'C:\\node\\node.exe' }
      ],
      source: { type: 'shell', name: 'pwsh.exe', description: 'Interactive shell session' },
      warnings: [],
      workingDir: ''
    })
    const why = parseNativeWhy(raw)
    assert.equal(why.engine, 'native')
    assert.equal(why.ancestryText, 'System (pid 4) → pwsh.exe (pid 50) → node.exe (pid 80)')
    assert.equal(why.sourceLine, 'pwsh.exe (shell)')
  })
})

describe('splitJsonObjects', () => {
  it('splits concatenated JSON objects', () => {
    const objs = splitJsonObjects('{"a":1}\n{"b":{"c":2}}')
    assert.equal(objs.length, 2)
    assert.equal(objs[0].a, 1)
    assert.equal(objs[1].b.c, 2)
  })
})

describe('buildNativeWhyScript', () => {
  it('embeds pid and produces PowerShell', () => {
    const script = buildNativeWhyScript(1234)
    assert.match(script, /\$targetPid = 1234/)
    assert.match(script, /ConvertTo-Json/)
    assert.match(script, /Win32_Process/)
  })
})
