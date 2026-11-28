<script setup lang="ts">
import ArrowIcon from '@/components/ArrowIcon.vue';

definePage({ meta: { title: 'Page Not Found' } });
</script>

<template>
  <div class="content-wrap animate">
    <h1 class="not-found-title">404</h1>

    <p class="not-found-subtitle">This is not the page you're looking for</p>

    <RouterLink class="back-link" to="/">
      <ArrowIcon class="back-link-arrow" />
      <span class="back-link-text">Take Me Home</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.not-found-title {
  font-size: 120px;
  line-height: 1;
}

.not-found-subtitle {
  margin-top: -4px;
  margin-bottom: 10px;
  color: #94a3b8;
}

.back-link {
  margin-top: 20px;
  font-size: 16px;
}
</style>
