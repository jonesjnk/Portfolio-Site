<script setup lang="ts">
import { useTitle } from '@vueuse/core';
import { useRoute } from 'vue-router';

import AppFooter from '@/components/AppFooter.vue';
import NavBar from '@/components/NavBar.vue';

const route = useRoute();

useTitle(() => (route.meta.title ? `${route.meta.title} • Jones Jankovic` : 'Jones Jankovic'));
</script>

<template>
  <NavBar />
  <main>
    <RouterView />
  </main>
  <AppFooter />
</template>
