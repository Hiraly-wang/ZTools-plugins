import type { ClipboardRecord, ItemKind } from '../types'

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / 昨天 / MM-DD / YYYY-MM-DD */
export function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 172_800_000) return '昨天'
  const d = new Date(ts)
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (d.getFullYear() === new Date().getFullYear()) return md
  return `${d.getFullYear()}-${md}`
}

/** 文本预览：压掉多余空白，折叠换行 */
export function previewText(text: string, max = 240): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 文件路径列表 → 文件名列表 */
export function fileNames(files: string[]): string {
  return files.map((f) => f.replace(/[\\/]+/g, '/').split('/').pop() || f).join('、')
}

/** 字节数描述（文件/图片大小如有） */
export function humanSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export const KIND_META: Record<ItemKind, { label: string; color: string; icon: string }> = {
  text: { label: '文本', color: 'var(--c-text)', icon: 'M4 7h16M4 12h16M4 17h10' },
  link: { label: '链接', color: 'var(--c-link)', icon: 'M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07L11.5 5.4M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.47' },
  code: { label: '代码', color: 'var(--c-code)', icon: 'M8 6l-5 6 5 6M16 6l5 6-5 6M13 4l-2 16' },
  color: { label: '颜色', color: 'var(--c-color)', icon: 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1m0-12.8l-2.1 2.1M7.7 16.3l-2.1 2.1' },
  image: { label: '图片', color: 'var(--c-image)', icon: 'M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 5M15.5 9.5a1 1 0 1 0 0-.01' },
  file: { label: '文件', color: 'var(--c-file)', icon: 'M6 2h8l4 4v16H6zM14 2v5h4' }
}

/** 颜色色板展示（#hex 记录） */
export function isHexColor(t: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t.trim())
}

/** 记录的次级说明文案（空串表示不显示） */
export function recordMeta(r: ClipboardRecord): string {
  if (r.kind === 'image') return ''
  if (r.kind === 'file' && r.files) return `${r.files.length} 个文件`
  if (r.kind === 'color') return '颜色值'
  if (r.kind === 'link') return hostname(r.content)
  if (r.kind === 'code') return '代码片段'
  return `${r.content.length} 字符`
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.split('/')[2] || url
  }
}
