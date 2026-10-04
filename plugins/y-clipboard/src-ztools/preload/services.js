/**
 * Y剪贴板 preload
 *
 * 本插件的核心能力（剪贴板历史、搜索、写入）均由宿主提供的
 * window.ztools.clipboard / window.ztools.dbStorage 完成，无需额外
 * Node.js 能力。此文件保留最小实现，仅做一次宿主环境探测，
 * 方便在控制台快速确认 preload 是否生效。
 */

window.services = {
  ready() {
    return typeof window.ztools !== 'undefined'
  }
}
