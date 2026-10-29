import { config } from '../config.js'
import { serviceRequest } from './http.js'
import { HttpError } from '../utils/httpError.js'

function query(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export async function listClassrooms(filters) {
  const items = []
  let page = 1
  for (;;) {
    const data = await serviceRequest(
      config.d2BaseUrl,
      `/api/d2/classrooms${query({ ...filters, status: 'AVAILABLE', is_bookable_whole: true, page, page_size: 100 })}`,
    )
    const batch = Array.isArray(data?.items) ? data.items : []
    items.push(...batch)
    const total = Number(data?.total ?? items.length)
    if (batch.length < 100 || items.length >= total || page >= 20) break
    page += 1
  }
  return items
}

export function searchAvailability({ startTime, endTime, filters }) {
  return serviceRequest(config.d2BaseUrl, '/api/d2/availability/search', {
    method: 'POST',
    body: {
      resource_type: 'CLASSROOM',
      start_time: startTime,
      end_time: endTime,
      filters,
    },
  })
}

export async function getClassroom(id) {
  try {
    return await serviceRequest(config.d2BaseUrl, `/api/d2/classrooms/${id}`)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError(404, 'NOT_FOUND', '教室不存在')
    }
    throw err
  }
}

export function createReservation(body) {
  return serviceRequest(config.d2BaseUrl, '/api/d2/reservations', { method: 'POST', body })
}

export function confirmReservation(id) {
  return serviceRequest(config.d2BaseUrl, `/api/d2/reservations/${id}/confirm`, { method: 'POST' })
}

export function releaseReservation(id, reason) {
  return serviceRequest(config.d2BaseUrl, `/api/d2/reservations/${id}/release`, {
    method: 'POST',
    body: { reason },
  })
}

export function getReservation(id) {
  return serviceRequest(config.d2BaseUrl, `/api/d2/reservations/${id}`)
}

export function listReservations(params) {
  return serviceRequest(config.d2BaseUrl, `/api/d2/reservations${query(params)}`)
}
