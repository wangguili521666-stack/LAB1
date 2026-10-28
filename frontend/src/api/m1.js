import { request } from "../utils/request.js";
export const m1Api = {
  search: (params) =>
    request(`/api/m1/seats/available?${new URLSearchParams(params)}`),
  book: (body) => request("/api/m1/bookings", { method: "POST", body }),
  bookings: (params = { page: 1, page_size: 20 }) =>
    request(`/api/m1/bookings/me?${new URLSearchParams(params)}`),
  booking: (id) => request(`/api/m1/bookings/${encodeURIComponent(id)}`),
  checkin: (id, code) =>
    request(`/api/m1/bookings/${encodeURIComponent(id)}/checkin`, {
      method: "POST",
      body: { checkin_method: "CODE", code },
    }),
  rebook: (body) =>
    request("/api/m1/bookings/rebook", { method: "POST", body }),
  violations: (params) =>
    request(`/api/m1/violations/me?${new URLSearchParams(params)}`),
  cancel: (id) =>
    request(`/api/m1/bookings/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
};
