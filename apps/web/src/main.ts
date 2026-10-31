import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import DealsPage from './pages/DealsPage.vue';
import FavoritesPage from './pages/FavoritesPage.vue';
import ListingPage from './pages/ListingPage.vue';
import SearchPage from './pages/SearchPage.vue';
import './style.css';

// Hash history keeps every route a static file, so the API needs no SPA fallback.
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: DealsPage },
    { path: '/search', component: SearchPage },
    { path: '/favorites', component: FavoritesPage },
    { path: '/listing/:id', component: ListingPage, props: true }
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 }
});

createApp(App).use(router).mount('#app');
