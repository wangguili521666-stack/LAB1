# D2 教室、座位及资源占用服务

实现 `docs/api/d2.md` 4.3 的全部接口，细则见 4.7、4.8：教室/座位管理、时间段可用性、原子预占、确认、释放、过期回收、维修工单阻塞和审计 outbox。
后端采用 Node.js 22、Express 4、mysql2；只有一个 D2 应用，不创建额外前端。

占用与维修变更先锁定所属教室，再检查当前状态并与审计一同提交。座位之间可并行占用，整教室与内部座位互斥；时间使用左闭右开区间。查询只反映快照，创建和确认会在事务内重新检查。

## 接口

| 方法 | 路径 | 认证与返回 |
|---|---|---|
| GET | `/api/d2/health` | 无需认证，检查数据库和迁移 |
| GET | `/api/d2/classrooms` | 已登录用户，分页 Classroom |
| GET | `/api/d2/classrooms/{id}` | 已登录用户，Classroom |
| POST | `/api/d2/classrooms` | 管理员，201 Classroom |
| PATCH | `/api/d2/classrooms/{id}` | 有学院权限的管理员，Classroom |
| GET | `/api/d2/classrooms/{id}/seats` | 已登录用户，Seat[] |
| GET | `/api/d2/seats/{id}` | 已登录用户，Seat |
| POST | `/api/d2/seats` | 有教室权限的管理员，201 Seat |
| PATCH | `/api/d2/seats/{id}` | 有教室权限的管理员，Seat |
| POST | `/api/d2/availability/search` | ACTIVE 用户或 M1/M2，AvailabilityItem[] |
| POST | `/api/d2/availability/check` | ACTIVE 用户或 M1/M2，AvailabilityItem |
| POST | `/api/d2/reservations` | M1 座位 / M2 整教室，首次 201，幂等重试 200 |
| POST | `/api/d2/reservations/{id}/confirm` | 来源服务自身占用，Reservation |
| POST | `/api/d2/reservations/{id}/release` | 来源服务自身占用，Reservation |
| GET | `/api/d2/reservations` | 来源服务或有学院权限的管理员，分页 Reservation |
| GET | `/api/d2/reservations/{id}` | 来源服务或有学院权限的管理员，Reservation |
| POST | `/api/d2/internal/maintenance/sync` | 仅 M3，{classroom_id, maintenance_blocked} |

字段、分页、错误码以 `../../docs/api/d2.md` 和 `common.md` 为准。ID 为正的有符号 BIGINT 十进制字符串；不接受 JSON 数值 ID。
主数据 POST 未约定幂等键或编号唯一性，重复提交生成不同记录；PATCH 可重复调用。预占使用 `(source_module, source_id)` 唯一键，匹配参数的重试返回当前状态，不延长截止、不复活已释放记录；参数不符返回 409。

## 本机开发：Windows PowerShell

先保持现有 Compose 的 MySQL、D1、前端运行。根目录 Compose 没有 D2 服务，本次没有修改任何公共部署配置。

```powershell
cd "E:\ZJS\作业\工程伦理\lab1-dev\backend\D2"
npm.cmd ci --no-audit --no-fund
Copy-Item .env.example .env
```

若已经存在 D2 `.env`，保留它，不重复复制。用编辑器填写：

- `DB_PASSWORD`：根目录 `.env` 的 `D2_DB_PASSWORD`，不是网站登录密码。
- `DB_PORT`：根目录 `MYSQL_PORT` 对应的宿主机端口，默认 3306。
- `D1_BASE_URL`：当前 D1 未发布宿主机端口，本机通过前端代理访问，默认为 `http://127.0.0.1:5173`；如前端端口改变，此处同步改变。
- `D3_BASE_URL` / `D3_SERVICE_TOKEN`：D3 未实现时留空，日志保存在 outbox。接通后填写真实地址和由 D3 认可的可信服务凭证，重启 D2 后自动发送。不能使用浏览器用户 Token 代替服务身份。
- `D2_M1_SERVICE_TOKEN` / `D2_M2_SERVICE_TOKEN` / `D2_M3_SERVICE_TOKEN`：各自独立、不少于 32 个无空白字符的随机密钥；对应调用方使用同一密钥作为 Bearer Token。留空表示该服务身份未启用。不要提供给浏览器或提交到 Git。
- `HOLD_TTL_SECONDS=300`：未显式指定截止时间时的预占租约；`EXPIRY_POLL_MS=5000`：后台过期回收间隔。
- `BUSINESS_UTC_OFFSET=+08:00`：每日开放时间的固定时区偏移。开闭相同表示全天，开放晚于关闭表示跨午夜。

可分别执行三次以下命令在本机生成服务密钥，再手动填入 D2 和对应调用方的私有环境配置：

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

以上本机地址只在配置示例中出现，服务调用代码从环境变量读取。模块 `.env` 已受根目录忽略规则保护。

初始化业务表与启动：

```powershell
npm.cmd run migrate
npm.cmd run dev
```

默认仅监听本机 3005；`npm.cmd start` 可不启用文件监听。运行中的修改可通过 dev 模式重启。
访问 `http://127.0.0.1:3005/api/d2/health` 应返回统一包装，`data.status` 为 `UP`。
用户接口通过接口客户端直接请求 3005，传 `Authorization: Bearer <D1登录返回的access_token>`；服务写接口使用上述对应服务密钥。
本次没有改前端代理，现有页面的业务请求不会自动转发到 D2。

可选的独立镜像构建（不会自动启动或修改 Compose）：

```powershell
docker build -t campus-d2:dev .
```

在容器中运行时设置 `HOST=0.0.0.0`、`DB_HOST=mysql`、`D1_BASE_URL=http://d1:3004`，并加入实际项目网络；密码和 D3 凭证通过运行环境注入。Dockerfile 已设置监听地址并在启动前执行迁移。

## 权限及当前上游限制

- 用户身份通过 D1 的 `GET /api/d1/users/me` 取得可信用户 ID、ACTIVE 状态、角色和学院。只转发原用户 Token，不接受 `user_id`、角色头或客户端声明的权限。
- M1/M2 可读取主数据及可用性，仅操作和查询自身来源的占用；M3 只能同步维修。服务身份不依赖 D1 在线，但不能替代用户授权；M1/M2 负责调用 D1 验证预约/审批业务权限。
- 普通用户不可读取占用明细；SYSTEM_ADMIN 全量只读，CLASSROOM_ADMIN 限本学院。管理员也不能直接确认或释放源模块占用。
- `SYSTEM_ADMIN` 可管理全部；`CLASSROOM_ADMIN` 只管理自己的非空学院。座位继承教室权限；教室更新和座位维护锁定同一教室记录，按事务内当前学院检查权限。
- 其他角色可查询。D1 禁用用户返回 403，凭证无效返回 401，D1 超时或错误响应返回 503。
- 非空学院必须通过契约已有的 `GET /api/d1/colleges` 校验。**当前 D1 尚未实现此接口，因此创建带学院的教室或修改为非空学院将返回 503**；D2 不绕过校验，也不查 D1 表。
- 当前 D1 尚未实现角色分配接口，新注册账号只有 STUDENT 角色。实际管理员管理操作需 D1 负责人完成角色管理并通过公开接口授予权限；本模块没有后门或默认管理员。
- 停用教室不改写内部座位状态或历史占用；创建和确认时同时检查教室、座位、维修来源、开放窗口及重叠占用。
- M1/M2/M3 尚未接入这些服务密钥；M3 原文档示例缺少必填 `revision`，负责人须按 D2 4.8 升级。未修改这些模块的业务代码。

## 迁移及已确认的 Schema 差异

迁移沿用项目三位序号 SQL 文件和 `schema_migrations(filename, applied_at)` 约定。D2 自己的 runner 使用 MySQL 命名锁防止多个实例并发迁移，不改全局迁移规则。

| 文件 | 内容 |
|---|---|
| `001_resources.sql` | classrooms、seats，D2 内部外键、查询索引、合法值 CHECK |
| `002_audit_outbox.sql` | 用户批准的 operation_log_outbox 技术表 |
| `003_reservations.sql` | resource_reservations、来源唯一键、冲突与过期索引及状态约束 |
| `004_maintenance.sql` | maintenance_blocks、工单来源与版本、教室外键及阻塞索引 |

2026-10-28 用户确认：`classrooms.college_id` 是 D1 的逻辑引用，不建立跨库物理外键，与原数据库文档中的 FK 标记存在明确差异；具体决定同步记录在 D2 API 文档。未修改其他模块 Schema 或历史迁移。
D2 的 DATETIME 使用 UTC，占用时间保留毫秒；每日 TIME 由 BUSINESS_UTC_OFFSET 解释。
新增资源默认 AVAILABLE；现有契约未规定编号唯一性，因此没有自行创建楼栋/房号或座位编号唯一约束。
占用及维修设计已获用户确认，变更记录在契约 4.8 和 D2 Schema 文档；未改动历史 001/002 迁移。

## 占用与维修状态

- HELD 在截止前阻塞资源；CONFIRMED 不受原租约到期影响；RELEASED 不阻塞。确认/释放重复调用幂等；过期确认先持久化释放再返回 409。释放后需要新的来源业务 ID 才能重新预占。
- 过期 HELD 即使未物理回收，也在可用性、查询和筛选中视为 RELEASED。worker 按数据库时间分批回收，停止时等待当前批次，重启继续。数据库保存初始截止用于幂等比对，非 HELD 响应截止为 null。
- M3 同步必须传 `ticket_id`、`classroom_id`、`active`、`revision`。版本为单工单递增正整数；旧消息忽略，同版本相同内容幂等，同版本不同内容或工单改教室返回 409。
- 维修来源并集阻塞新预占和确认；一张工单验收不会解除其他工单或手动维护状态。维修不覆盖教室主数据状态、不撤销已有占用，返工使用更高版本重新阻塞。
- `maintenance_blocked` 表示手动 MAINTENANCE 或存在 active 工单，不能据此忽略 DISABLED。已有 CONFIRMED 的重复确认返回原记录。

## 审计 outbox

用户已明确批准新增 `operation_log_outbox`：`id, payload, status, attempts, next_attempt_at, last_error_code, created_at, sent_at`。
payload 严格遵循 D3 OperationLogCreate，仅保存可信操作者、D2 操作、资源、HTTP 方法/路径、结果和来源 IP，不保存 Token、请求正文、用户私有资料或查询字符串。

- 资源写入与 SUCCESS 审计在同一个 D2 本地事务提交；outbox 写入失败时资源事务回滚。
- 写接口的认证、权限、参数和业务失败写 FAILURE 审计；无法确认身份或服务调用时 user_id 为 null。服务来源通过目标占用/工单追溯，幂等尝试也留日志。
- 后台过期审计使用 RESERVATION_EXPIRE / SYSTEM，用户和来源 IP 为空。真实 D3 对该系统操作的接入尚需联调。
- D3 不可用不撤销已提交资源变更，日志保留 PENDING。发送失败采用最长 300 秒的指数退避；重新启动后继续发送。
- 多个发送实例使用 `FOR UPDATE SKIP LOCKED` 避免同时发送同一行。D3 网络调用有超时，但与本地提交不构成跨服务原子事务。
- D3 尚无幂等去重契约，网络超时或发送后本地提交失败会导致重复投递。采用至少一次交付，不能宣称恰好一次；需要 D3 后续确认去重方案。
- D3 未配置时 worker 不启动，启动日志会明确提示；配置后重启即可处理已有队列。
- 不自动删除已发送审计。D3 长期不可用时需关注 outbox 增长。
- 数据库不可用时无法持久化失败审计，只输出无秘密的错误标识，不声称已经保存。数据库恢复后的历史失败审计无法凭空补回。

## 测试及验收范围

```powershell
npm.cmd test
npm.cmd run test:integration
```

第一条运行校验、依赖客户端和配置单元测试。第二条要求 Docker 引擎可访问且本机已有 `mysql:8.0` 镜像，自动创建独立临时 MySQL 容器、随机凭证和单库应用账号，仅开放随机本机端口；不会读取根目录 `.env`，也不连接或清理开发数据库和项目数据卷。执行完成后只清理本脚本创建的临时容器。

集成测试在两个独立数据库中依次运行主数据与占用套件，使用真实 MySQL、Express HTTP、SQL 事务、外键、行锁和 outbox；仅 D1/D3 的 HTTP 边界使用本地测试服务。覆盖 D2-01..20：空库迁移及重复/并发迁移、并发占用与跨类型冲突、相邻和不同座位、幂等与状态竞态、实际截止与后台回收、多工单/乱序/返工、开放窗口、服务及学院权限、非法输入/缺字段/不存在资源、BIGINT、依赖故障和审计回滚/重试。
测试不等于全系统联调；真实 M1/M2/M3、D1 学院与角色管理、D3 服务接通后仍需做完整业务链路验证。
