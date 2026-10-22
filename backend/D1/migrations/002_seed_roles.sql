-- 默认角色（幂等：role_code 唯一，重复执行不会产生重复数据）。
-- 角色清单与 docs/requirements/demands.md 对齐（一级审批角色为「自习室管理员」）。
INSERT IGNORE INTO roles (role_code, role_name, description) VALUES
  ('STUDENT', '学生', '默认用户角色'),
  ('TEACHER', '老师', '可申请整教室'),
  ('SYSTEM_ADMIN', '系统管理员', '系统最高管理权限'),
  ('CLASSROOM_ADMIN', '自习室管理员', '管理自习室与座位，教室申请一级审批'),
  ('TEACHER_ADMIN', '教师管理员', '教师管理'),
  ('OPERATION_ADMIN', '运营管理员', '查看统计数据与预约情况'),
  ('PROPERTY_ADMIN', '物业管理员', '报修工单派单与管理'),
  ('REPAIR_WORKER', '维修工', '处理维修工单');
