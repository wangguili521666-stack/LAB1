import { request } from "../utils/request.js";
export const m1Api = {
  search: (params) =>
    request(`/api/m1/seats/available?${new URLSearchParams(params)}`),
  book: (body) => request("/api/m1/bookings", { method: "POST", body }),
  bookings: () => request("/api/m1/bookings/me?page=1&page_size=20"),
  cancel: (id) =>
    request(`/api/m1/bookings/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
};
