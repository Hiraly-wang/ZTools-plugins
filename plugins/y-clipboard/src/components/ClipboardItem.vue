<script setup lang="ts">
import { computed } from 'vue'
import type { ClipboardRecord } from '../types'
import { toImgSrc } from '../api'
import { KIND_META, previewText, relTime, recordMeta, fileNames, isHexColor } from '../utils/format'

const props = defineProps<{
  record: ClipboardRecord
  selected: boolean
  starred: boolean
}>()

const emit = defineEmits<{
  copy: []
  star: []
  remove: []
}>()

const meta = computed(() => KIND_META[props.record.kind])
const time = computed(() => relTime(props.record.createdAt))
const sub = computed(() => recordMeta(props.record))

const preview = computed(() => {
  const r = props.record
  if (r.kind === 'file' && r.files) return fileNames(r.files)
  if (r.kind === 'color') return r.content.trim()
  return previewText(r.content)
})

const imgSrc = computed(() =>
  props.record.kind === 'image' ? toImgSrc(props.record.content) : ''
)

const colorSwatch = computed(() => (isHexColor(props.record.content) ? props.record.content.trim() : ''))
</script>

<template>
  <div
    class="item"
    :class="{ sel: selected }"
    @click="emit('copy')"
    @dblclick.prevent
  >
    <!-- 左：类型标识 -->
    <div class="lead" :style="{ color: meta.color }">
      <span
        v-if="colorSwatch"
        class="swatch"
        :style="{ background: colorSwatch }"
      />
      <svg v-else class="icon-svg type-icon" viewBox="0 0 24 24" fill="none"
        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path :d="meta.icon" stroke="currentColor" />
      </svg>
    </div>

    <!-- 中：内容 -->
    <div class="body">
      <div class="title" :title="preview">{{ preview }}</div>
      <div class="sub">
        <span class="kind-tag" :style="{ color: meta.color }">{{ meta.label }}</span>
        <template v-if="sub">
          <span class="dot">·</span>
          <span>{{ sub }}</span>
        </template>
      </div>
    </div>

    <!-- 图片缩略 -->
    <img v-if="imgSrc" class="thumb" :src="imgSrc" loading="lazy" alt="" draggable="false" />

    <!-- 右：时间 + 操作 -->
    <div class="tail">
      <span class="time">{{ time }}</span>
      <span class="ops">
        <button
          class="op"
          :class="{ starred }"
          title="收藏"
          @click.stop="emit('star')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" :fill="starred ? 'currentColor' : 'none'"
            stroke-width="1.6" stroke-linejoin="round">
            <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z" stroke="currentColor" />
          </svg>
        </button>
        <button class="op op-del" title="删除" @click.stop="emit('remove')">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" />
          </svg>
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
  padding: 0 14px 0 12px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.1s;
  outline: none;
}

.item:hover { background: var(--hover); }
.item.sel { background: var(--accent-weak); }

.lead {
  width: 30px;
  height: 30px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: var(--bg);
}

.swatch {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
}

.body { flex: 1; min-width: 0; }

.title {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
}

.kind-tag { font-weight: 500; }
.dot { opacity: 0.5; }

.thumb {
  width: 52px;
  height: 40px;
  flex: none;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.tail {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.time {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.ops {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}

.item:hover .ops,
.item.sel .ops { opacity: 1; }

.op {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--text-3);
  transition: background 0.1s, color 0.1s;
}

.op:hover { background: var(--active); color: var(--text); }
.op.starred { color: var(--star); }
.op.op-del:hover { background: var(--danger-weak); color: var(--danger); }
</style>
