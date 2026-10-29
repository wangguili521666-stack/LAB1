export const DEFAULT_MAX_HOURS = 4;
export const socketLabels = {
  NONE: "无插座",
  FIXED: "固定插座",
  RAIL: "导轨插座",
};
export const statusLabels = {
  BOOKED: "已预约",
  CHECKED_IN: "已签到",
  CANCELLED: "已取消",
  NO_SHOW: "未签到违约",
  COMPLETED: "已完成",
};
export function parseCampusTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) throw new Error("请选择完整的开始和结束时间");
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    throw new Error("日期或时间无效，请重新选择");
  if (minute !== 0)
    throw new Error("预约时间须按整点选择，例如 09:00 至 11:00");
  return { iso: `${value}:00+08:00`, timestamp: date.getTime() - 8 * 3600000 };
}
export function defaultFilters(now = new Date()) {
  const next = (Math.floor(now.getTime() / 3600000) + 1) * 3600000;
  const wall = (timestamp) =>
    new Date(timestamp + 8 * 3600000).toISOString().slice(0, 16);
  return {
    start: wall(next),
    end: wall(next + 3600000),
    building: "",
    classroom_id: "",
    college_id: "",
    socket_type: "",
  };
}
export function filterKey(filters) {
  return JSON.stringify(
    [
      "start",
      "end",
      "building",
      "classroom_id",
      "college_id",
      "socket_type",
    ].map((key) => String(filters[key] ?? "").trim()),
  );
}
export function buildSearch(filters, maxHours = DEFAULT_MAX_HOURS) {
  const start = parseCampusTime(filters.start),
    end = parseCampusTime(filters.end);
  if (!Number.isFinite(maxHours) || maxHours <= 0)
    throw new Error("预约时长配置无效，请联系管理员");
  if (end.timestamp <= start.timestamp)
    throw new Error("结束时间必须晚于开始时间");
  if (end.timestamp - start.timestamp > maxHours * 3600000)
    throw new Error(`单次预约不能超过 ${maxHours} 小时`);
  const params = { start_time: start.iso, end_time: end.iso };
  for (const key of ["building", "classroom_id", "college_id", "socket_type"]) {
    const value = String(filters[key] ?? "").trim();
    if (!value) continue;
    if (["classroom_id", "college_id"].includes(key) && !/^\d+$/.test(value))
      throw new Error("教室和学院编号须为数字");
    if (key === "socket_type" && !Object.hasOwn(socketLabels, value))
      throw new Error("请选择有效的插座类型");
    params[key] = value;
  }
  return { params, key: filterKey(filters) };
}
export function formatCampusTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
// Historical records must include the year to distinguish different academic years.
export function formatRecordTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
