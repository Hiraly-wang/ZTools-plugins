<script setup lang="ts">
import { useStore } from '../composables/useStore'
import { isDevMock } from '../api'

const store = useStore()

function onSearch(e: Event): void {
  store.setQuery((e.target as HTMLInputElement).value)
}

function onClear(): void {
  if (window.confirm('确定清空全部剪贴板历史？收藏的内容会保留。')) {
    void store.clearAll()
  }
}
</script>

<template>
  <header class="toolbar">
    <div v-if="isDevMock()" class="search">
      <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" stroke="currentColor" />
        <path d="M20 20l-3.5-3.5" stroke="currentColor" />
      </svg>
      <input
        class="search-input"
        :value="store.query.value"
        placeholder="搜索剪贴板历史（浏览器开发模式）"
        @input="onSearch"
      />
    </div>

    <div v-else class="hint">在上方搜索框输入关键词过滤</div>

    <div class="spacer" />

    <span v-if="store.remoteSearching.value" class="status">搜索中…</span>
    <span v-else-if="store.loading.value" class="status">加载中…</span>

    <span class="count">{{ store.filtered.value.length }} 条</span>

    <button class="btn-danger" title="清空历史（收藏保留）" @click="onClear">
      <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" stroke="currentColor" />
      </svg>
    </button>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  flex: none;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, 40vw);
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-3);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--text);
}

.search-input::placeholder { color: var(--text-3); }

.hint { color: var(--text-3); font-size: 12px; }

.spacer { flex: 1; }

.status { color: var(--text-3); font-size: 12px; }

.count {
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.btn-danger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--text-3);
  transition: background 0.12s, color 0.12s;
}

.btn-danger:hover {
  background: var(--danger-weak);
  color: var(--danger);
}
</style>
