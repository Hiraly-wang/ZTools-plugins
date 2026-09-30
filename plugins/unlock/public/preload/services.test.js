const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

// services.js 是 ZTools 预加载脚本：它要求在 window 上挂载 API，并尝试加载 electron。
// 这里用最小桩验证"暴露给前端的接口"没有丢，避免前端调用 undefined。
describe('preload services surface', () => {
  it('exposes every API the UI calls', () => {
    global.window = {}
    require('./services')

    const s = global.window.services
    assert.ok(s && typeof s === 'object', 'window.services 应存在')

    const expected = [
      'findLockingProcesses',
      'killProcess',
      'killLockingProcess',
      'killAllLockingProcesses',
      'verifyRelease',
      'killPortProcess',
      'killAllPortProcesses',
      'shredPath',
      'findPortProcess',
      'explainPid',
      'getWhyEngine',
      'getDebugLog',
      'getPathForFile'
    ]
    for (const name of expected) {
      assert.equal(typeof s[name], 'function', name + ' 应该是函数')
    }

    // 回退链：没有 electron 时不应抛错，只是拿不到路径
    assert.equal(s.getPathForFile(null), '')
    assert.equal(s.getWhyEngine(), 'witr')
    assert.ok(Array.isArray(s.getDebugLog()))
  })
})
