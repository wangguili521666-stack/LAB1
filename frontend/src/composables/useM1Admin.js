import { reactive, computed, watch, onScopeDispose } from "vue";
import {
  defaultAdminFilters,
  buildAdminQuery,
  readStatistics,
} from "../utils/m1Admin.js";
export function useM1Admin(api, session) {
  const access = reactive({
    loading: false,
    loaded: false,
    roles: [],
    error: "",
    denied: false,
  });
  const filters = reactive(defaultAdminFilters()),
    statFilters = reactive(defaultAdminFilters());
  const records = reactive({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
    loading: false,
    loaded: false,
    error: "",
    query: null,
  });
  const stats = reactive({
    data: null,
    query: null,
    loading: false,
    error: "",
  });
  const settings = reactive({
    items: [],
    loaded: false,
    loading: false,
    error: "",
    success: "",
    edit: null,
    saving: false,
  });
  const canRead = computed(
    () =>
      access.loaded &&
      !access.denied &&
      (access.permissions?.some(p=>["booking:read","booking:read_all"].includes(p)) || access.roles.some((role) =>
        ["SYSTEM_ADMIN", "CLASSROOM_ADMIN", "OPERATION_ADMIN"].includes(role),
      )),
  );
  const canWrite = computed(
    () => canRead.value && (access.roles.includes("SYSTEM_ADMIN")||access.permissions?.includes("booking:configure")),
  );
  let epoch = 0,
    accessVersion = 0,
    recordVersion = 0,
    statVersion = 0,
    settingVersion = 0,
    disposed = false;
  watch(
    () => JSON.stringify(filters),
    () => {
      recordVersion++;
      Object.assign(records, {
        items: [],
        total: 0,
        page: 1,
        loading: false,
        loaded: false,
        error: "",
        query: null,
      });
    },
    { flush: "sync" },
  );
  watch(
    () => JSON.stringify(statFilters),
    () => {
      statVersion++;
      Object.assign(stats, {
        data: null,
        query: null,
        loading: false,
        error: "",
      });
    },
    { flush: "sync" },
  );
  function resetData() {
    recordVersion++;
    statVersion++;
    settingVersion++;
    Object.assign(records, {
      items: [],
      total: 0,
      page: 1,
      loading: false,
      loaded: false,
      error: "",
      query: null,
    });
    Object.assign(stats, {
      data: null,
      query: null,
      loading: false,
      error: "",
    });
    Object.assign(settings, {
      items: [],
      loaded: false,
      loading: false,
      error: "",
      success: "",
      edit: null,
      saving: false,
    });
  }
  function revoke(message) {
    epoch++;
    resetData();
    access.roles = [];
    access.permissions = [];
    access.denied = true;
    access.error = message || "无权访问管理数据，请重新确认权限。";
  }
  async function loadAccess() {
    const version = ++accessVersion,
      identity = ++epoch;
    resetData();
    Object.assign(access, {
      loading: true,
      loaded: false,
      roles: [],
      error: "",
      denied: false,
    });
    try {
      const user = await api.profile();
      if (disposed || version !== accessVersion || identity !== epoch)
        return false;
      if (
        !Array.isArray(user?.roles) ||
        user.roles.some((role) => typeof role !== "string")
      )
        throw new Error("权限信息格式异常");
      access.roles = [...user.roles];
      access.permissions = user.permissions || [];
      access.loaded = true;
      return true;
    } catch (error) {
      if (!disposed && version === accessVersion && identity === epoch)
        access.error = error.message;
      return false;
    } finally {
      if (!disposed && version === accessVersion) access.loading = false;
    }
  }
  if (session)
    watch(
      session,
      () => {
        epoch++;
        accessVersion++;
        resetData();
        Object.assign(access, {
          loading: false,
          loaded: false,
          roles: [],
          error: "",
          denied: false,
        });
        if (session()) loadAccess();
      },
      { flush: "sync" },
    );
  onScopeDispose(() => {
    disposed = true;
    epoch++;
    accessVersion++;
    resetData();
  });
  async function loadRecords(page = 1) {
    if (!canRead.value || !Number.isInteger(page) || page < 1) return false;
    const version = ++recordVersion,
      identity = epoch;
    records.error = "";
    records.items = [];
    records.loaded = false;
    records.query = null;
    let query;
    try {
      query = buildAdminQuery(filters);
    } catch (error) {
      records.error = error.message;
      records.loading = false;
      return false;
    }
    records.loading = true;
    try {
      const data = await api.adminBookings({
        ...query,
        page,
        page_size: records.page_size,
      });
      if (disposed || version !== recordVersion || identity !== epoch)
        return false;
      if (
        !Array.isArray(data?.items) ||
        !Number.isSafeInteger(data.total) ||
        data.total < 0 ||
        !Number.isInteger(data.page) ||
        data.page < 1 ||
        !Number.isInteger(data.page_size) ||
        data.page_size < 1
      )
        throw new Error("管理预约数据格式异常");
      const last = Math.max(1, Math.ceil(data.total / data.page_size));
      if (page > last) return loadRecords(last);
      Object.assign(records, {
        items: data.items,
        total: data.total,
        page: data.page,
        page_size: data.page_size,
        query,
        loaded: true,
      });
      return true;
    } catch (error) {
      if (!disposed && version === recordVersion && identity === epoch) {
        if (error.status === 403)
          revoke("管理接口拒绝访问，请重新确认账号权限。");
        else records.error = error.message;
      }
      return false;
    } finally {
      if (!disposed && version === recordVersion && identity === epoch)
        records.loading = false;
    }
  }
  async function loadStatistics() {
    if (!canRead.value) return false;
    const version = ++statVersion,
      identity = epoch;
    stats.error = "";
    stats.data = null;
    stats.query = null;
    let query;
    try {
      query = buildAdminQuery(statFilters, true);
    } catch (error) {
      stats.error = error.message;
      stats.loading = false;
      return false;
    }
    stats.loading = true;
    try {
      const data = readStatistics(await api.statistics(query));
      if (disposed || version !== statVersion || identity !== epoch)
        return false;
      stats.data = data;
      stats.query = query;
      return true;
    } catch (error) {
      if (!disposed && version === statVersion && identity === epoch) {
        if (error.status === 403)
          revoke("统计接口拒绝访问，请重新确认账号权限。");
        else stats.error = error.message;
      }
      return false;
    } finally {
      if (!disposed && version === statVersion && identity === epoch)
        stats.loading = false;
    }
  }
  async function loadSettings() {
    if (!canWrite.value) return false;
    const version = ++settingVersion,
      identity = epoch;
    settings.error = "";
    settings.loading = true;
    try {
      const data = await api.settings();
      if (disposed || version !== settingVersion || identity !== epoch)
        return false;
      if (
        !Array.isArray(data) ||
        data.some(
          (item) =>
            !item ||
            typeof item.setting_key !== "string" ||
            !item.setting_key ||
            typeof item.setting_value !== "string",
        ) ||
        new Set(data.map((item) => item.setting_key)).size !== data.length
      )
        throw new Error("配置数据格式异常，暂时无法编辑");
      settings.items = data;
      settings.loaded = true;
      return true;
    } catch (error) {
      if (!disposed && version === settingVersion && identity === epoch) {
        if (error.status === 403)
          revoke("配置接口拒绝访问，请重新确认账号权限。");
        else settings.error = error.message;
      }
      return false;
    } finally {
      if (!disposed && version === settingVersion && identity === epoch)
        settings.loading = false;
    }
  }
  function editSetting(key) {
    if (
      !canWrite.value ||
      settings.saving ||
      settings.loading ||
      settings.error
    )
      return;
    const item = settings.items.find((item) => item.setting_key === key);
    if (!item) return;
    settings.success = "";
    settings.edit = {
      key,
      original: item.setting_value,
      value: item.setting_value,
      error: "",
    };
  }
  function closeEdit() {
    if (settings.saving) return false;
    settings.edit = null;
    return true;
  }
  async function saveSetting() {
    if (!canWrite.value || settings.saving || !settings.edit) return false;
    const edit = settings.edit,
      identity = epoch;
    if (!settings.items.some((item) => item.setting_key === edit.key)) {
      edit.error = "此配置项已不存在，请刷新列表";
      return false;
    }
    if (edit.value === edit.original) {
      edit.error = "配置值未改变";
      return false;
    }
    if (typeof edit.value !== "string") {
      edit.error = "请输入文本形式的配置值";
      return false;
    }
    settings.saving = true;
    edit.error = "";
    settings.success = "";
    try {
      await api.updateSetting(edit.key, edit.value);
      if (disposed || identity !== epoch) return true;
      settings.success = "配置已保存。";
      settings.edit = null;
      const refreshed = await loadSettings();
      if (!disposed && identity === epoch && !refreshed)
        settings.error =
          "配置已保存，但重新读取失败。请刷新配置，不要重复保存。";
      return true;
    } catch (error) {
      if (!disposed && identity === epoch) {
        if (error.status === 403)
          revoke("配置写入被拒绝，请重新确认账号权限。");
        else
          edit.error = error.status
            ? error.message
            : `未能确认保存结果：${error.message}。请先刷新配置确认结果。`;
      }
      return false;
    } finally {
      if (!disposed && identity === epoch) settings.saving = false;
    }
  }
  return {
    access,
    canRead,
    canWrite,
    filters,
    statFilters,
    records,
    stats,
    settings,
    loadAccess,
    loadRecords,
    loadStatistics,
    loadSettings,
    editSetting,
    closeEdit,
    saveSetting,
  };
}
