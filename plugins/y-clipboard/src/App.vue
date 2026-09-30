<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { api } from './api'
import { useStore } from './composables/useStore'
import Sidebar from './components/Sidebar.vue'
import Toolbar from './components/Toolbar.vue'
import VirtualList from './components/VirtualList.vue'

const store = useStore()
const ROW_H = 72

const selectedRecord = computed(() =>
  store.filtered.value[store.selectedIndex.value] ?? null
)

const starredIds = computed(() => {
  const set = new Set<string>()
  for (const r of store.records.value) {
    const k = store.favKey(r)
    if (store.favorites.value.some((f) => f.id === k)) set.add(k)
  }
  return set
})

/* ---------- 主题 ---------- */

function applyTheme(): void {
  const t = api.theme()
  document.documentElement.classList.toggle('dark', t.dark)
  if (t.accent) document.documentElement.style.setProperty('--accent', t.accent)
}

/* ---------- 键盘流 ---------- */

function onKeyDown(e: KeyboardEvent): void {
  const inInput = e.target instanceof HTMLInputElement

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      store.moveSelection(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      store.moveSelection(-1)
      break
    case 'Home':
      if (inInput) return
      e.preventDefault()
      store.setCat('all')
      break
    case 'Enter': {
      e.preventDefault()
      const rec = selectedRecord.value
      if (rec) void store.copyRecord(rec)
      break
    }
    case 'Delete':
      if (inInput) return
      e.preventDefault()
      if (selectedRecord.value) void store.deleteRecord(selectedRecord.value)
      break
    case 'Escape':
      e.preventDefault()
      api.outPlugin()
      break
  }
}

/* ---------- 生命周期 ---------- */

onMounted(() => {
  applyTheme()
  api.onThemeChange(applyTheme)
  window.addEventListener('keydown', onKeyDown)
  store.init()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="app">
    <Toolbar />
    <div class="app-body">
      <Sidebar />
      <main class="main">
        <VirtualList
          v-if="store.filtered.value.length > 0"
          :items="store.filtered.value"
          :row-height="ROW_H"
          :selected-id="selectedRecord?.id ?? null"
          :starred-ids="starredIds"
          @copy="(r) => store.copyRecord(r)"
          @star="(r) => store.toggleStar(r)"
          @remove="(r) => store.deleteRecord(r)"
          @load-more="store.loadMore()"
        />

        <div v-else class="empty">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke-width="1.2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3h9a2 2 0 0 1 2 2v11M5 7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM11 12h4M11 16h4" stroke="currentColor" />
          </svg>
          <p class="empty-title">
            {{ store.query.value ? '没有匹配的记录' : '暂无剪贴板历史' }}
          </p>
          <p class="empty-sub">
            {{ store.query.value
              ? '换个关键词，或等待远端搜索结果'
              : '复制任何内容后，会自动出现在这里' }}
          </p>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
}

.empty-icon { width: 44px; height: 44px; opacity: 0.5; }
.empty-title { font-size: 13.5px; color: var(--text-2); }
.empty-sub { font-size: 12px; }
</style>
