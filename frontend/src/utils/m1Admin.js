import { parseCampusTime, statusLabels } from "./m1.js";
export const statisticLabels = {
  total_bookings: "预约总数",
  completed_bookings: "已完成",
  no_show_bookings: "未签到违约",
  cancelled_bookings: "已取消",
};
export function defaultAdminFilters(now = new Date()) {
  const wall = new Date(now.getTime() + 8 * 3600000);
  const start = wall.toISOString().slice(0, 10);
  const end = new Date(Date.parse(start + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  return { start, end, classroom_id: "", status: "" };
}
export function buildAdminQuery(filters, required = false) {
  const params = {};
  if (required || filters.start || filters.end) {
    if (!filters.start || !filters.end)
      throw new Error("请选择完整的开始和结束日期");
    const start = parseCampusTime(filters.start + "T00:00"),
      end = parseCampusTime(filters.end + "T00:00");
    if (end.timestamp <= start.timestamp)
      throw new Error("结束日期必须晚于开始日期，结束日期当天不计入区间");
    params.start_time = start.iso;
    params.end_time = end.iso;
  }
  const id = String(filters.classroom_id ?? "").trim();
  if (id && !/^\d+$/.test(id)) throw new Error("教室编号须为数字");
  if (id) params.classroom_id = id;
  if (!required && filters.status) {
    if (!Object.hasOwn(statusLabels, filters.status))
      throw new Error("预约状态无效");
    params.status = filters.status;
  }
  return params;
}
export function readStatistics(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("统计数据格式异常，请重试");
  return Object.fromEntries(
    Object.keys(statisticLabels).map((key) => {
      if (data[key] == null) return [key, null];
      if (!Number.isSafeInteger(data[key]) || data[key] < 0)
        throw new Error("统计数据格式异常，请重试");
      return [key, data[key]];
    }),
  );
}
