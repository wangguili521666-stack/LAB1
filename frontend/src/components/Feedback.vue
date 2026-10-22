<script setup>
defineProps({ error: String, success: String })
</script>
<template>
  <p v-if="error" class="feedback error" role="alert">{{ error }}</p>
  <p v-else-if="success" class="feedback success" role="status">
    {{ success }}
  </p>
</template>
