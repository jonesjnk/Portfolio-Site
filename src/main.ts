import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { routes } from 'vue-router/auto-routes';

import App from './App.vue';

import './styles/global.css';

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
});

const app = createApp(App).use(router);
await router.isReady();
app.mount('#app');
