export {};

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
