import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { routes } from 'vue-router/auto-routes';

import App from './App.vue';

import './styles/global.css';

declare global {
  interface ImportMetaEnv {
    readonly VITE_BUILD_HASH: string;
    readonly VITE_BUILD_DATE: string;
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
});

const app = createApp(App).use(router);
await router.isReady();
app.mount('#app');
