<template>
  <!-- 中文 locale：EP 按需引入后不再 `app.use(ElementPlus, { locale })`，
       改由 el-config-provider 提供（该组件不产生额外 DOM 包裹，不影响任何布局） -->
  <el-config-provider :locale="zhCn">
    <SunnyBackdrop v-if="route.meta.gate === true" :plain="true" />
    <router-view />
  </el-config-provider>
</template>

<script setup>
import { useRoute } from 'vue-router';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import SunnyBackdrop from './components/SunnyBackdrop.vue';

const route = useRoute();
</script>
