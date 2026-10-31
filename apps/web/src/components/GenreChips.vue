<script setup lang="ts">
import { GENRES, genreLabel, t, type Genre } from '../i18n';

const model = defineModel<Genre | null>({ required: true });
const genres = Object.keys(GENRES) as Genre[];
</script>

<template>
  <div class="chips genres" role="group" :aria-label="t('filter.genre')">
    <button class="chip" :class="{ on: model === null }" :aria-pressed="model === null" @click="model = null">
      {{ t('filter.allGenres') }}
    </button>
    <button v-for="genre in genres" :key="genre" class="chip" :class="{ on: model === genre }" :aria-pressed="model === genre"
      @click="model = model === genre ? null : genre">
      {{ genreLabel(genre) }}
    </button>
  </div>
</template>

<style scoped>
/* quieter than the main filter row so the two rows read as primary and secondary */
.genres { margin-top: -6px; }
.genres .chip { min-height: 32px; font-size: 13px; padding: 0 12px; }
.genres .chip:not(.on) { background: transparent; }
</style>
