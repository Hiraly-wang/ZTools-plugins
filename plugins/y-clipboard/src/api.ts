import type { ClipboardRecord, FavoriteSnapshot, PageResult } from './types'

/**
 * 宿主 API 封装层。
 *
 * 宿主 getHistory / search 的返回结构文档未给出精确字段，
 * 这里做一层防御性归一化：无论返回 {list} / {rows} / {items} / {data}
 * 还是裸数组，统一收敛成 ClipboardRecord[]。
 *
 * 浏览器直接访问 localhost:5173 时无 window.ztools，
 * 自动切换到 mock 数据，保证 UI 可以独立开发调试。
 */

const isHost = () => typeof window !== 'undefined' && typeof window.ztools !== 'undefined'
export const isDevMock = () => !isHost()

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function djb2(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return 'h' + h.toString(36) + str.length.toString(36)
}

export function contentId(kind: string, content: string): string {
  return djb2(kind + '\u0000' + content)
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (!Number.isNaN(n)) return n
    const d = new Date(v).getTime()
    if (!Number.isNaN(d)) return d
  }
  return 0
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/** 图片路径 → 可显示 src（data: 原样；绝对路径转 file://） */
export function toImgSrc(p: string): string {
  if (!p) return ''
  if (/^(data:|https?:|file:)/i.test(p)) return p
  const norm = p.replace(/\\/g, '/')
  return 'file://' + (norm.startsWith('/') ? '' : '/') + encodeURI(norm)
}

/* ------------------------------------------------------------------ */
/* 分类判定                                                            */
/* ------------------------------------------------------------------ */

const CODE_HINTS = [
  'function ', 'const ', 'let ', '=>', 'import ', 'export ', 'class ',
  'return ', 'console.', '<?php', '</', 'SELECT ', 'def ', 'async ',
  '{', '}', '();'
]

export function detectKind(text: string): Exclude<ClipboardRecord['kind'], 'image' | 'file'> {
  const t = text.trim()
  if (!t) return 'text'
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return 'color'
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return 'link'
  if (t.length >= 24) {
    const hits = CODE_HINTS.reduce((n, h) => (t.includes(h) ? n + 1 : n), 0)
    if (hits >= 2) return 'code'
  }
  return 'text'
}

/* ------------------------------------------------------------------ */
/* 归一化                                                              */
/* ------------------------------------------------------------------ */

function normalizeRecord(raw: unknown): ClipboardRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const rawType = String(
    pick(o, ['type', 'kind', 'contentType']) ?? 'text'
  ).toLowerCase()

  const filesRaw = pick(o, ['files', 'paths', 'fileList', 'file'])
  let files: string[] | undefined
  if (Array.isArray(filesRaw)) {
    files = filesRaw.map(String).filter(Boolean)
  } else if (typeof filesRaw === 'string' && filesRaw) {
    files = [filesRaw]
  }

  let content = ''
  let kind: ClipboardRecord['kind']

  if (rawType.includes('image')) {
    kind = 'image'
    content = String(
      pick(o, ['thumbnail', 'image', 'dataUrl', 'dataURL', 'content', 'data', 'path', 'url', 'src']) ?? ''
    )
    if (!content) return null
  } else if (rawType.includes('file') || (files && files.length > 0)) {
    kind = 'file'
    if (!files || files.length === 0) return null
    content = files[0]
  } else {
    content = String(pick(o, ['content', 'text', 'value', 'data']) ?? '')
    if (!content) return null
    kind = detectKind(content)
  }

  const id = String(pick(o, ['id', '_id', 'recordId']) ?? djb2(kind + '\u0000' + content))

  return {
    id,
    kind,
    rawType,
    content,
    files,
    createdAt: toNum(pick(o, ['createdAt', 'createAt', 'time', 'timestamp', 'date', 'updated_at'])),
    raw
  }
}

function extractList(res: unknown): unknown[] {
  if (Array.isArray(res)) return res
  if (res && typeof res === 'object') {
    const o = res as Record<string, unknown>
    for (const k of ['list', 'rows', 'items', 'data', 'records', 'result']) {
      if (Array.isArray(o[k])) return o[k]
    }
    // { success, data: { list } } 双层结构
    if (o.data && typeof o.data === 'object') return extractList(o.data)
  }
  return []
}

function toRecords(res: unknown): ClipboardRecord[] {
  return extractList(res)
    .map(normalizeRecord)
    .filter((r): r is ClipboardRecord => r !== null)
}

/* ------------------------------------------------------------------ */
/* 宿主 API                                                            */
/* ------------------------------------------------------------------ */

export const host = {
  async getHistory(page: number, pageSize: number): Promise<PageResult> {
    const res = await (window.ztools as any).clipboard.getHistory(page, pageSize)
    const items = toRecords(res)
    return { items, hasMore: items.length >= pageSize }
  },

  async search(keyword: string): Promise<ClipboardRecord[]> {
    const res = await (window.ztools as any).clipboard.search(keyword)
    return toRecords(res)
  },

  async remove(id: string): Promise<boolean> {
    const res = await (window.ztools as any).clipboard.delete(id)
    return !res || (res as any).success !== false
  },

  /** 写回剪贴板（默认同时模拟粘贴到之前焦点窗口） */
  async write(id: string, paste = true): Promise<void> {
    await (window.ztools as any).clipboard.write(id, paste)
  },

  /** 按内容写剪贴板（收藏快照等无宿主 id 的场景） */
  async writeContent(
    type: 'text' | 'image' | 'file',
    content: string | string[],
    paste = true
  ): Promise<void> {
    await (window.ztools as any).clipboard.writeContent({ type, content }, paste)
  },

  async clear(): Promise<number> {
    const res = await (window.ztools as any).clipboard.clear()
    return Number((res as any)?.count ?? 0)
  },

  onChange(cb: () => void): void {
    ;(window.ztools as any).clipboard.onChange(cb)
  },

  outPlugin(): void {
    void (window.ztools as any).outPlugin?.()
  },

  setSubInput(onChange: (text: string) => void, placeholder: string): void {
    ;(window.ztools as any).setSubInput({ text: onChange }, placeholder, true)
  },

  toast(message: string): void {
    void (window.ztools as any).showToast?.(message)
  },

  theme(): { dark: boolean; accent: string } {
    try {
      const info = (window.ztools as any).getThemeInfo?.() ?? {}
      return {
        dark: window.ztools.isDarkColors?.() ?? false,
        accent: String(info.primaryColor || '')
      }
    } catch {
      return { dark: false, accent: '' }
    }
  },

  onThemeChange(cb: () => void): void {
    ;(window.ztools as any).onThemeChange?.(cb)
  }
}

/* ------------------------------------------------------------------ */
/* 浏览器开发 mock                                                     */
/* ------------------------------------------------------------------ */

const MOCK_TEXTS: Array<[string, string]> = [
  ['text', '会议纪要：周三评审剪贴板插件交互稿，重点看键盘流是否顺'],
  ['text', '发票抬头：北京某某科技有限公司 税号 91110108MA01XXXXXX'],
  ['text', '地铁 10 号线换乘 6 号线，C 口出直走 200 米'],
  ['link', 'https://vuejs.org/guide/introduction.html'],
  ['link', 'https://github.com/vuejs/core/releases'],
  ['link', 'https://ztoolscenter.github.io/ZTools-doc/first-plugin.html'],
  ['code', "const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }"],
  ['code', 'import { createApp } from \'vue\'\nimport App from \'./App.vue\'\ncreateApp(App).mount(\'#app\')'],
  ['code', 'SELECT id, content, created_at FROM clipboard ORDER BY created_at DESC LIMIT 50;'],
  ['color', '#5B8DEF'],
  ['color', '#0F6E56'],
  ['text', 'ssh -p 2222 dev@10.0.0.12'],
  ['text', '取件码 8-2-3069，丰巢快递柜'],
]

const MOCK_FILES = [
  ['E:\\A_YSYSYSS_workspace\\y-clipboard\\src-ztools\\plugin.json'],
  ['D:\\Downloads\\设计稿-首页-v3.fig', 'D:\\Downloads\\设计稿-详情-v3.fig'],
]

function mockImage(i: number): string {
  const hue = (i * 47) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280"><rect width="480" height="280" fill="hsl(${hue},62%,72%)"/><circle cx="${60 + (i % 5) * 90}" cy="140" r="46" fill="hsl(${(hue + 40) % 360},70%,88%)"/><rect x="30" y="220" width="420" height="18" rx="9" fill="hsl(${hue},45%,90%)"/></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

function buildMockData(): any[] {
  const out: any[] = []
  const now = Date.now()
  for (let i = 0; i < 72; i++) {
    const [kind, content] = MOCK_TEXTS[i % MOCK_TEXTS.length]
    const age = (i * 23 + (i % 7) * 41) * 60 * 1000 // 分布在过去约 48h
    if (kind === 'text' || kind === 'link' || kind === 'code' || kind === 'color') {
      out.push({ id: 'mock-' + i, type: 'text', content, createdAt: now - age })
    } else if (i % 11 === 5) {
      out.push({ id: 'mock-img-' + i, type: 'image', thumbnail: mockImage(i), createdAt: now - age })
    } else if (i % 11 === 8) {
      const [f] = MOCK_FILES[i % MOCK_FILES.length]
      const files = i % 2 === 0 ? [f] : MOCK_FILES[i % MOCK_FILES.length]
      out.push({ id: 'mock-file-' + i, type: 'file', files, createdAt: now - age })
    }
  }
  return out
}

let mockDb = buildMockData()

const mock = {
  async getHistory(page: number, pageSize: number): Promise<PageResult> {
    await sleep(60)
    const start = (page - 1) * pageSize
    const items = toRecords(mockDb.slice(start, start + pageSize))
    return { items, hasMore: start + pageSize < mockDb.length }
  },

  async search(keyword: string): Promise<ClipboardRecord[]> {
    await sleep(80)
    const kw = keyword.toLowerCase()
    return toRecords(
      mockDb.filter((r: any) => String(r.content ?? '').toLowerCase().includes(kw))
    )
  },

  async remove(id: string): Promise<boolean> {
    mockDb = mockDb.filter((r: any) => r.id !== id)
    return true
  },

  async write(_id: string): Promise<void> {
    mock.toast('已复制（开发模式不执行真实粘贴）')
  },

  async writeContent(): Promise<void> {
    mock.toast('已复制（开发模式不执行真实粘贴）')
  },

  async clear(): Promise<number> {
    const n = mockDb.length
    mockDb = []
    return n
  },

  onChange(_cb: () => void): void {
    /* 开发模式不监听 */
  },

  outPlugin(): void {
    mock.toast('开发模式：此处会退出插件')
  },

  setSubInput(_onChange: (t: string) => void, _ph: string): void {
    /* 开发模式用页面内搜索框 */
  },

  toast(message: string): void {
    console.info('[toast]', message)
  },

  theme(): { dark: boolean; accent: string } {
    return { dark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false, accent: '#5B8DEF' }
  },

  onThemeChange(_cb: () => void): void {
    /* noop */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 统一出口：真实宿主或 mock */
export const api = isHost() ? host : mock

/* ------------------------------------------------------------------ */
/* 收藏持久化（宿主 dbStorage / mock localStorage）                     */
/* ------------------------------------------------------------------ */

const FAV_KEY = 'y-clipboard:favorites'
const FAV_LIMIT = 200

function rawStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  if (isHost()) return window.ztools.dbStorage as any
  return localStorage
}

export const favoritesStore = {
  load(): FavoriteSnapshot[] {
    try {
      const raw = rawStorage().getItem(FAV_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  },

  save(list: FavoriteSnapshot[]): void {
    try {
      rawStorage().setItem(FAV_KEY, JSON.stringify(list.slice(0, FAV_LIMIT)))
    } catch { /* 存储失败静默 */ }
  }
}
