<script setup>
defineProps({ name: String })
const paths = {
  campus: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M9 9h.01M15 9h.01',
  seat: 'M5 11V4h14v7M4 11h16v6H4zM6 17v4M18 17v4M8 7h8',
  room: 'M4 21V3h16v18M2 21h20M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-6h4v6',
  repair: 'm14 7 3 3 4-4a7 7 0 0 1-9 9l-6 6-3-3 6-6a7 7 0 0 1 9-9z',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M17 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
}
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.campus" />
  </svg>
</template>
