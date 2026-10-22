
<script setup>
import { ref } from 'vue'

// 查询条件
const startTime = ref('2026-10-23T09:00')
const endTime = ref('2026-10-23T11:00')

// 页面数据
const seats = ref([])
const bookings = ref([])
const message = ref('')
const loading = ref(false)

// 将 datetime-local 转成带时区的 ISO 时间
function toISO(localTime) {
  return new Date(localTime).toISOString()
}

// 查询可用座位
async function searchSeats() {
  loading.value = true
  message.value = ''

  try {
    const params = new URLSearchParams({
      start_time: toISO(startTime.value),
      end_time: toISO(endTime.value)
    })

    const response = await fetch(
      `/api/m1/seats/available?${params}`
    )

    if (!response.ok) {
      throw new Error('查询失败')
    }

    const result = await response.json()
    seats.value = result.data
  } catch (error) {
    message.value = error.message
  } finally {
    loading.value = false
  }
}

// 预约指定座位
async function bookSeat(seatId) {
  message.value = ''

  try {
    const response = await fetch('/api/m1/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        seat_id: seatId,
        start_time: toISO(startTime.value),
        end_time: toISO(endTime.value)
      })
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.message || '预约失败')
    }

    message.value = '预约成功！'
    await searchSeats()
    await loadBookings()
  } catch (error) {
    message.value = error.message
  }
}

// 查看我的预约
async function loadBookings() {
  try {
    const response = await fetch('/api/m1/bookings/me', {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`
      }
    })

    if (!response.ok) {
      throw new Error('加载预约记录失败')
    }

    const result = await response.json()
    bookings.value = result.data.items
  } catch (error) {
    message.value = error.message
  }
}

// 取消预约
async function cancelBooking(bookingId) {
  try {
    const response = await fetch(
      `/api/m1/bookings/${bookingId}/cancel`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      }
    )

    if (!response.ok) {
      throw new Error('取消失败')
    }

    message.value = '预约已取消'
    await loadBookings()
    await searchSeats()
  } catch (error) {
    message.value = error.message
  }
}
</script>

<template>
  <div class="m1-page">
    <h1>自习座位预约</h1>

    <!-- 查询条件 -->
    <section>
      <h2>查询空闲座位</h2>

      <label>
        开始时间：
        <input type="datetime-local" v-model="startTime" />
      </label>

      <label>
        结束时间：
        <input type="datetime-local" v-model="endTime" />
      </label>

      <button @click="searchSeats" :disabled="loading">
        {{ loading ? '查询中...' : '查询座位' }}
      </button>
    </section>

    <!-- 可预约座位 -->
    <section>
      <h2>可预约座位</h2>

      <p v-if="seats.length === 0">暂无查询结果</p>

      <div
        v-for="seat in seats"
        :key="seat.seat_id"
        class="seat-card"
      >
        <span>
          {{ seat.building }} ·
          {{ seat.room_number }} ·
          {{ seat.seat_number }} ·
          {{ seat.socket_type }}
        </span>

        <button
          @click="bookSeat(seat.seat_id)"
          :disabled="!seat.available"
        >
          {{ seat.available ? '预约' : '不可预约' }}
        </button>
      </div>
    </section>

    <!-- 我的预约 -->
    <section>
      <h2>我的预约</h2>

      <button @click="loadBookings">
        刷新预约记录
      </button>

      <div
        v-for="booking in bookings"
        :key="booking.id"
        class="seat-card"
      >
        <span>
          座位 {{ booking.seat_id }} |
          {{ booking.start_time }} |
          {{ booking.status }}
        </span>

        <button
          v-if="booking.status === 'BOOKED'"
          @click="cancelBooking(booking.id)"
        >
          取消
        </button>
      </div>
    </section>

    <p class="message">{{ message }}</p>
  </div>
</template>

<style scoped>
.m1-page {
  max-width: 1000px;
  margin: 30px auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

section {
  margin-bottom: 30px;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
}

label {
  display: inline-block;
  margin: 10px;
}

button {
  margin: 5px;
  padding: 8px 15px;
  cursor: pointer;
}

.seat-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  margin-top: 10px;
  border: 1px solid #eee;
  border-radius: 6px;
}

.message {
  color: #2563eb;
}
</style>
