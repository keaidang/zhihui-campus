<template>
  <SunnyBackdrop :plain="route.meta.gate === true" />
  <router-view />
</template>

<script setup>
import { useRoute } from 'vue-router';
import SunnyBackdrop from './components/SunnyBackdrop.vue';

const route = useRoute();
</script>
