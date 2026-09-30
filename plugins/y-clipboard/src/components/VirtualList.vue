<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ClipboardRecord } from '../types'
import ClipboardItem from './ClipboardItem.vue'

const props = defineProps<{
  items: ClipboardRecord[]
  rowHeight: number
  selectedId: string | null
  starredIds: Set<string>
}>()

const emit = defineEmits<{
  copy: [record: ClipboardRecord]
  star: [record: ClipboardRecord]
  remove: [record: ClipboardRecord]
  'load-more': []
}>()

const BUFFER = 6
const viewport = ref<HTMLDivElement | null>(null)
const scrollTop = ref(0)
const clientH = ref(400)

const total = computed(() => props.items.length * props.rowHeight)

const range = computed(() => {
  const first = Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - BUFFER)
  const visible = Math.ceil(clientH.value / props.rowHeight) + BUFFER * 2
  const last = Math.min(props.items.length, first + visible)
  return { first, last }
})

const windowItems = computed(() => props.items.slice(range.value.first, range.value.last))
const offsetY = computed(() => range.value.first * props.rowHeight)

function onScroll(): void {
  const el = viewport.value
  if (!el) return
  scrollTop.value = el.scrollTop
  if (scrollTop.value + el.clientHeight > total.value - 400) {
    emit('load-more')
  }
}

/** 选中项变化时保证可见 */
watch(
  () => props.selectedId,
  (id) => {
    const el = viewport.value
    if (!el || !id) return
    const idx = props.items.findIndex((r) => r.id === id)
    if (idx < 0) return
    const top = idx * props.rowHeight
    const bottom = top + props.rowHeight
    if (top < el.scrollTop) {
      el.scrollTo({ top: Math.max(0, top - props.rowHeight * 2) })
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: bottom - el.clientHeight + props.rowHeight * 2 })
    }
  }
)

let ro: ResizeObserver | null = null

onMounted(() => {
  const el = viewport.value
  if (!el) return
  clientH.value = el.clientHeight
  ro = new ResizeObserver(() => {
    clientH.value = el.clientHeight
  })
  ro.observe(el)
})

onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div ref="viewport" class="vlist" @scroll.passive="onScroll">
    <div class="spacer" :style="{ height: total + 'px' }">
      <div class="window" :style="{ transform: `translateY(${offsetY}px)` }">
        <div
          v-for="rec in windowItems"
          :key="rec.id"
          class="row"
          :style="{ height: rowHeight + 'px' }"
        >
          <ClipboardItem
            :record="rec"
            :selected="rec.id === selectedId"
            :starred="starredIds.has(rec.id)"
            @copy="emit('copy', rec)"
            @star="emit('star', rec)"
            @remove="emit('remove', rec)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 8px;
  scrollbar-gutter: stable;
}

.spacer { position: relative; }

.window { position: absolute; left: 0; right: 0; top: 0; }

.row { animation: fade-in 0.18s ease-out; }
</style>
