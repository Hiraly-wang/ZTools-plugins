<script setup lang="ts">
import type { Category } from '../types'
import { useStore } from '../composables/useStore'
import { KIND_META } from '../utils/format'
import type { ItemKind } from '../types'

const store = useStore()

interface CatDef {
  key: Category
  label: string
  color?: string
  icon: string
}

const CATS: CatDef[] = [
  { key: 'all', label: '全部', icon: 'M4 6h16M4 12h16M4 18h16' },
  { key: 'text', label: '文本', color: 'var(--c-text)', icon: KIND_META.text.icon },
  { key: 'link', label: '链接', color: 'var(--c-link)', icon: KIND_META.link.icon },
  { key: 'code', label: '代码', color: 'var(--c-code)', icon: KIND_META.code.icon },
  { key: 'color', label: '颜色', color: 'var(--c-color)', icon: KIND_META.color.icon },
  { key: 'image', label: '图片', color: 'var(--c-image)', icon: KIND_META.image.icon },
  { key: 'file', label: '文件', color: 'var(--c-file)', icon: KIND_META.file.icon },
  { key: 'star', label: '收藏', color: 'var(--star)', icon: 'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z' }
]

function iconColor(def: CatDef): string {
  return def.key === 'all' ? 'var(--text-3)' : def.color || 'var(--text-2)'
}
</script>

<template>
  <nav class="sidebar">
    <button
      v-for="cat in CATS"
      :key="cat.key"
      class="cat"
      :class="{ on: store.activeCat.value === cat.key }"
      @click="store.setCat(cat.key)"
    >
      <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">
        <path :d="cat.icon" :stroke="iconColor(cat)" />
      </svg>
      <span class="cat-label">{{ cat.label }}</span>
      <span class="cat-count">{{ store.counts[cat.key] || '' }}</span>
    </button>

    <div class="sidebar-foot">
      <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 8v.01M12 11v5" stroke="currentColor" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" />
      </svg>
      <span>Enter 复制 · Esc 退出</span>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 132px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-right: 1px solid var(--border);
  background: var(--bg);
}

.cat {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius);
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

.cat:hover { background: var(--hover); }

.cat.on {
  background: var(--accent-weak);
  color: var(--accent);
}

.cat-label { flex: 1; text-align: left; font-size: 12.5px; }

.cat-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.sidebar-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 2px;
  color: var(--text-3);
  font-size: 11px;
  white-space: nowrap;
}
</style>
