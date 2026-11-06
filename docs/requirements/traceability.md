# 需求追踪清单

验收标准、逐条缺口及操作方法以 [traceability.json](traceability.json) 为准。partial表示已审查但未完整验收，不能按完成统计。

|编号|需求|状态|实现|验证|
|---|---|---|---|---|
|M1-01|用户查看指定教室的座位|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-02|用户查询指定时间段的空闲座位|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-03|用户预约空闲座位|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-04|用户预约已被占用的座位|verified|backend/M1/src/index.js|scripts/integration.mjs|
|M1-05|用户取消自己的预约|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-06|用户取消他人的预约|verified|backend/M1/src/index.js|scripts/integration.mjs|
|M1-07|用户查看个人预约记录|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-08|两名用户同时预约同一座位|verified|backend/M1/src/index.js|scripts/integration.mjs|
|M2-01|无申请权限的普通用户申请整教室|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-02|有权限用户申请空闲教室|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-03|用户申请与已有预约冲突的教室|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-04|一级审批人通过申请|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-05|二级审批人通过申请|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-06|任意一级审批人驳回申请|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-07|非对应级别审批人尝试审批|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-08|一级或二级审批超过规定时限|partial|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs, scripts/integration.mjs|
|M2-09|用户主动撤销待审批申请|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-10|用户查询本人教室申请|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M2-11|多个审批操作同时处理同一申请|verified|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs|
|M3-01|用户提交完整报修信息|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-02|用户提交缺少故障位置的报修|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-03|物业管理员向维修人员派单|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-04|普通用户尝试派单|verified|backend/M3/src/index.js|scripts/integration.mjs|
|M3-05|维修人员开始处理自己的工单|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-06|维修人员更新进度并提交完工|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-07|工单超过规定维修时限|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-08|报修用户验收通过|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-09|报修用户验收不通过|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-10|用户对已完成工单评价|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-11|用户重复评价同一工单|verified|backend/M3/src/index.js|scripts/integration.mjs|
|M3-12|用户查询个人报修记录|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|D1-01|使用合法用户名、密码注册|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-02|使用重复用户名注册|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-03|使用正确凭证登录|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-04|使用错误密码登录|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-05|未登录访问受保护接口|verified|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-06|普通用户尝试修改自己的角色|verified|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-07|管理员修改用户角色|verified|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-08|用户查询本人公开和私有资料|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-09|用户查询他人私有资料|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-10|用户修改昵称或联系方式|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-11|用户修改密码|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-12|用户查询个人预约与申请记录|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-13|禁用用户尝试登录|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D2-01|管理员新增教室|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/resources.test.js|
|D2-02|管理员为教室新增座位|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/resources.test.js|
|D2-03|查询空闲时间段的资源|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-04|查询已占用时间段的资源|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-05|同一座位发生时间重叠预约|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-06|整教室预约与教室内座位预约重叠|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-07|不同座位在同一时间预约|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-08|M1/M2 创建合法资源预占|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-09|M2 审批通过后确认预占|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-10|M2 驳回或撤销后释放预占|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-11|多个请求并发预约同一资源|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-12|管理员停用教室或座位|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-13|非授权用户调用资源维护接口|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/resources.test.js|
|D2-14|预占到期且未确认|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-15|同教室多个维修工单同时生效，逐一验收|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-16|维修消息重复、乱序、返工或同版本冲突|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-17|确认、释放与过期任务并发处理同一 HELD|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-18|同 source_module/source_id 并发重试预占|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-19|查询或预占跨午夜、闭馆及相邻时段|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D2-20|用户或错误模块尝试读写其他模块占用/同步维修|verified|backend/D2/src/occupancy.js, backend/D2/src/maintenance.js, backend/D2/src/app.js|backend/D2/tests/integration/occupancy.test.js|
|D3-01|管理员创建公告草稿|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-02|管理员发布公告|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-03|普通用户查询公告|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-04|管理员修改公告|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-05|管理员撤回公告|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-06|普通用户尝试发布公告|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-07|公告超过有效期|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-08|用户登录、预约、审批等关键操作|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-09|管理员按照用户、模块、时间查询日志|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-10|普通用户访问全站操作日志|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-11|普通用户尝试修改审计日志|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-12|检查日志中的敏感信息|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-13|可信模块提交通知|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-14|同一事件重复/并发提交|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-15|用户读取和标记本人消息|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-16|通知失效或到期|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-17|用户令牌冒充服务或模块互相冒充|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-18|邮件/微信发送尚未接入|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-19|业务写入时审计失败|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js|
|D3-20|D1 或数据库不可用|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-21|重建 D3 数据库连接|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-22|本机持久化开发模式|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-23|本机模拟身份与团队环境隔离|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-24|本地浏览器手动验收|partial|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|D3-25|本地验收工具访问边界|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/acceptance.test.js|
|D3-26|迁移跨平台换行兼容|verified|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/migration.test.js|
|D1-RBAC|动态角色权限|verified|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|D1-RECORDS|个人记录聚合|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|M1-DISPLAY|每日教室签到码|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-LIMIT|预约整点和可配置时长|verified|backend/M1/src/index.js|scripts/integration.mjs|
|M1-REMIND|提醒与未签到违约|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-STATS|运营统计|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M1-SOCKET|插座筛选|partial|backend/M1/src/index.js|scripts/integration.mjs, frontend/tests/m1.test.mjs|
|M3-PRIORITY|维修优先级|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|M3-PUBLIC-REVIEW|公开维修评价|partial|backend/M3/src/index.js|scripts/integration.mjs, backend/M3/test/validation.test.js|
|D1-LOGOUT|退出登录|partial|backend/D1/src/routes/auth.js, backend/D1/src/routes/users.js, backend/D1/src/routes/rbac.js, backend/D1/src/routes/integration.js|scripts/integration.mjs|
|M2-AUDIT-RETRY|审计持久化重试|deferred|backend/M2/src/services/applications.js, backend/M2/src/routes/m2.js|backend/M2/tests/m2.test.mjs, scripts/integration.mjs|
|CHANNEL-EXTERNAL|邮件与微信实际发送|deferred|backend/D3/src/service.js, backend/D3/src/stores/mysql.js|backend/D3/test/api.test.js, backend/D3/test/persistence.test.js, backend/D3/test/acceptance.test.js, backend/D3/test/migration.test.js|
|QUALITY-TRACE|需求基线追踪|verified|scripts/requirements-check.mjs|scripts/requirements-check.test.mjs|
|QUALITY-TEST|测试行为有效性|verified|scripts/mutation.mjs|scripts/mutation.mjs|
|INFRA-SCRIPT|基础设施脚本化|verified|start.sh, docker-compose.yml, db/init/00-init-databases.sh, scripts/infra.sh|scripts/ci.sh|
|INFRA-PRODUCTION|生产发布与回滚|partial|.github/workflows/ci.yml, .github/workflows/production.yml, scripts/server-release.sh|scripts/release_test.py, docs/github-cicd-validation.md|
|DB-EVOLUTION|数据库迁移与种子|verified|scripts/db-replay.sh, backend/D1/seed.mjs|scripts/ci.sh|
