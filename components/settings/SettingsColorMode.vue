<script setup lang="ts">
import type { ColorMode } from '~/types'

const colorMode = useColorMode()

function setColorMode(mode: ColorMode) {
  colorMode.preference = mode
}
</script>

<template>
  <div flex="~ gap4" w-full>
    <button
      btn-text flex-1 flex="~ gap-1 center" p4 border="~ base rounded" bg-base
      :tabindex="colorMode.value === 'dark' ? 0 : -1"
      :class="colorMode.value === 'dark' ? 'pointer-events-none' : 'filter-saturate-0'"
      @click="setColorMode('dark')"
    >
      <div i-ri:moon-line />
      {{ $t('settings.interface.dark_mode') }}
    </button>
    <button
      btn-text flex-1 flex="~ gap-1 center" p4 border="~ base rounded" bg-base
      :tabindex="colorMode.value === 'light' ? 0 : -1"
      :class="colorMode.value === 'light' ? 'pointer-events-none' : 'filter-saturate-0'"
      @click="setColorMode('light')"
    >
      <div i-ri:sun-line />
      {{ $t('settings.interface.light_mode') }}
    </button>
  </div>
</template>
