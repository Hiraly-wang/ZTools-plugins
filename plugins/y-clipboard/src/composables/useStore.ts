import { computed, reactive, ref, watch } from 'vue'
import { api, favoritesStore, isDevMock, contentId, toImgSrc } from '../api'
import type { Category, ClipboardRecord, FavoriteSnapshot, ItemKind } from '../types'

const PAGE_SIZE = 60
const SEARCH_DEBOUNCE = 100

/* ------------------------------------------------------------------ */
/* 单例状态                                                            */
/* ------------------------------------------------------------------ */

const records = ref<ClipboardRecord[]>([])
const favorites = ref<FavoriteSnapshot[]>([])
const activeCat = ref<Category>('all')
const query = ref('')
const selectedIndex = ref(0)
const page = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const remoteSearching = ref(false)

const favIds = computed(() => new Set(favorites.value.map((f) => f.id)))

/* ------------------------------------------------------------------ */
/* 过滤                                                                */
/* ------------------------------------------------------------------ */

function matchCat(r: ClipboardRecord): boolean {
  if (activeCat.value === 'all') return true
  if (activeCat.value === 'star') return favIds.value.has(favKey(r))
  return r.kind === activeCat.value
}

function matchQuery(r: ClipboardRecord): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  if (r.kind === 'file' && r.files) {
    return r.files.some((f) => f.toLowerCase().includes(q))
  }
  return r.content.toLowerCase().includes(q)
}

/** 收藏在记录列表中的 key（同内容同分类视为同一条） */
function favKey(r: ClipboardRecord): string {
  return contentId(r.kind, r.files ? r.files.join('|') : r.content)
}

/** star 分类下的"记录"：直接由收藏快照构造，删除原记录也不丢 */
const favoriteRecords = computed<ClipboardRecord[]>(() =>
  favorites.value.map((f) => ({
    id: f.id,
    kind: f.kind,
    rawType: f.kind,
    content: f.content,
    files: f.files,
    createdAt: f.createdAt,
    raw: null
  }))
)

const filtered = computed<ClipboardRecord[]>(() => {
  if (activeCat.value === 'star') {
    const q = query.value.trim().toLowerCase()
    if (!q) return favoriteRecords.value
    return favoriteRecords.value.filter(matchQuery)
  }
  return records.value.filter((r) => matchCat(r) && matchQuery(r))
})

const counts = reactive<Record<Category, number>>({
  all: 0, text: 0, link: 0, code: 0, color: 0, image: 0, file: 0, star: 0
})

function recount(): void {
  const c: Record<string, number> = { all: records.value.length, star: favorites.value.length }
  for (const r of records.value) c[r.kind] = (c[r.kind] ?? 0) + 1
  for (const k of Object.keys(counts) as Category[]) {
    counts[k] = c[k] ?? 0
  }
}

/* ------------------------------------------------------------------ */
/* 加载                                                                */
/* ------------------------------------------------------------------ */

let loadSeq = 0

async function loadFirst(): Promise<void> {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await api.getHistory(1, PAGE_SIZE)
    if (seq !== loadSeq) return
    records.value = res.items
    page.value = 1
    hasMore.value = res.hasMore
    selectedIndex.value = 0
    recount()
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loading.value || !hasMore.value || query.value.trim()) return
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await api.getHistory(page.value + 1, PAGE_SIZE)
    if (seq !== loadSeq) return
    const seen = new Set(records.value.map((r) => r.id))
    records.value = records.value.concat(res.items.filter((r) => !seen.has(r.id)))
    page.value += 1
    hasMore.value = res.hasMore
    recount()
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/* ------------------------------------------------------------------ */
/* 搜索：本地即时过滤 + 远端防抖补充                                   */
/* ------------------------------------------------------------------ */

let searchTimer: ReturnType<typeof setTimeout> | null = null

function setQuery(q: string): void {
  query.value = q
  selectedIndex.value = 0
  if (searchTimer) clearTimeout(searchTimer)
  const kw = q.trim()
  if (!kw) {
    remoteSearching.value = false
    if (records.value.length === 0) void loadFirst()
    return
  }
  searchTimer = setTimeout(async () => {
    remoteSearching.value = true
    try {
      const remote = await api.search(kw)
      if (query.value.trim() !== kw) return
      const seen = new Set(records.value.map((r) => r.id))
      const fresh = remote.filter((r) => !seen.has(r.id))
      if (fresh.length) {
        records.value = fresh.concat(records.value)
        recount()
      }
    } finally {
      remoteSearching.value = false
    }
  }, SEARCH_DEBOUNCE)
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

async function copyRecord(r: ClipboardRecord, exit = true): Promise<void> {
  try {
    const isSnapshot = activeCat.value === 'star' || !r.raw
    if (isSnapshot) {
      if (r.kind === 'file' && r.files) await api.writeContent('file', r.files)
      else if (r.kind === 'image') await api.writeContent('image', r.content)
      else await api.writeContent('text', r.content)
    } else {
      await api.write(r.id)
    }
    if (exit) api.outPlugin()
  } catch (e) {
    api.toast('复制失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function deleteRecord(r: ClipboardRecord): Promise<void> {
  const idx = filtered.value.findIndex((x) => x.id === r.id)
  const ok = await api.remove(r.id)
  if (!ok) {
    api.toast('删除失败')
    return
  }
  if (activeCat.value === 'star') {
    favorites.value = favorites.value.filter((f) => f.id !== r.id)
    favoritesStore.save(favorites.value)
    recount()
  } else {
    records.value = records.value.filter((x) => x.id !== r.id)
    recount()
  }
  if (idx >= 0 && idx < filtered.value.length) {
    selectedIndex.value = Math.min(idx, filtered.value.length - 1)
  } else if (filtered.value.length > 0) {
    selectedIndex.value = filtered.value.length - 1
  } else {
    selectedIndex.value = 0
  }
}

function toggleStar(r: ClipboardRecord): void {
  const key = favKey(r)
  if (favIds.value.has(key)) {
    favorites.value = favorites.value.filter((f) => f.id !== key)
  } else {
    const snap: FavoriteSnapshot = {
      id: key,
      kind: r.kind,
      content: r.content,
      files: r.files,
      createdAt: r.createdAt || Date.now()
    }
    favorites.value = [snap, ...favorites.value].slice(0, 200)
  }
  favoritesStore.save(favorites.value)
  recount()
}

async function clearAll(): Promise<void> {
  const n = await api.clear()
  if (n > 0 || isDevMock()) {
    records.value = []
    hasMore.value = false
    recount()
    api.toast(`已清空 ${n} 条记录`)
  }
}

function setCat(cat: Category): void {
  activeCat.value = cat
  selectedIndex.value = 0
}

function moveSelection(delta: number): void {
  const len = filtered.value.length
  if (len === 0) return
  selectedIndex.value = Math.min(len - 1, Math.max(0, selectedIndex.value + delta))
}

/* 过滤结果变化时收拢选中下标，避免越界空选 */
watch(filtered, (list) => {
  if (selectedIndex.value >= list.length) selectedIndex.value = Math.max(0, list.length - 1)
})

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

let inited = false

function init(): void {
  if (inited) return
  inited = true

  favorites.value = favoritesStore.load()

  api.setSubInput((payload: unknown) => {
    const text = typeof payload === 'string' ? payload : String((payload as any)?.text ?? '')
    setQuery(text)
  }, '搜索剪贴板历史')

  api.onChange(async (payload?: unknown) => {
    // 变化项结构未知：能归一化就 prepend，否则保守重载第一页
    const maybe = Array.isArray(payload) ? payload[0] : payload
    if (maybe && typeof maybe === 'object') {
      try {
        const res = await api.getHistory(1, 5)
        const seen = new Set(records.value.map((r) => r.id))
        const fresh = res.items.filter((r) => !seen.has(r.id))
        if (fresh.length) {
          records.value = fresh.concat(records.value)
          recount()
          return
        }
        if (res.items.length) {
          records.value = res.items
          recount()
          return
        }
      } catch { /* fallthrough */ }
    }
    void loadFirst()
  })

  void loadFirst()
}

export function useStore() {
  return {
    records, favorites, activeCat, query, selectedIndex,
    loading, remoteSearching, hasMore, counts, filtered,
    init, loadFirst, loadMore, setQuery, setCat,
    copyRecord, deleteRecord, toggleStar, clearAll, moveSelection,
    favKey
  }
}

export type Store = ReturnType<typeof useStore>

/** 供 ClipboardItem 使用的图片 src 转换（避免组件直接依赖 api 内部） */
export { toImgSrc }
export type { Category, ItemKind }
