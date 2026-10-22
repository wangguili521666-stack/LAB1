import { ref } from 'vue'

// Each independently usable action owns its pending and feedback state.
export function useTask() {
  const pending = ref(false),
    error = ref(''),
    success = ref('')
  async function run(action, message = '') {
    if (pending.value) return false
    pending.value = true
    error.value = success.value = ''
    try {
      await action()
      success.value = message
      return true
    } catch (cause) {
      error.value = cause.message || '操作失败，请重试'
      return false
    } finally {
      pending.value = false
    }
  }
  return { pending, error, success, run }
}
