<script setup lang="ts">
const { strokeWidth = 1.8 } = defineProps<{ strokeWidth?: number }>();
</script>

<template>
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4 10h11m0 0-4-4m4 4-4 4"
      stroke="currentColor"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
