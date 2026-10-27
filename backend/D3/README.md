# D3 首版开发与联调

本版提供通知、个人消息、公告与操作审计的首版实现，供组内联调和评审。权威接口说明见 [docs/api/d3.md](../../docs/api/d3.md)，本文件说明如何运行和验证。

## 本机长期使用 MySQL（2026-10-28 增补）

现在提供三种独立入口，业务接口和服务逻辑相同：

| 启动方式 | 数据存储 | 用户身份 | 默认 HTTP 端口 |
|---|---|---|---|
| npm.cmd run dev:mock | 内存，重启清空 | 模拟 D1 | 3006 |
| npm.cmd run dev:local | 本机 MySQL，重启保留 | 模拟 D1 | 3106 |
| npm.cmd start | .env 指向的 MySQL | 真实 D1 | 3006 |

本地模式使用 .env.local；团队联调使用 .env。它们不会互相覆盖。本机模式仅允许连接 127.0.0.1 的 campus_d3_local 库，防止将模拟身份用于团队数据库。以后使用组长的数据库，通常只需配置连接信息、应用对应版本迁移，并接入真实 D1；通知、消息、公告和审计的业务代码无需重写。

在本目录的 PowerShell 中首次初始化：

```powershell
npm.cmd run db:setup:local
```

按提示输入本机 MySQL 管理员密码，输入不会显示，也不会保存管理员密码。脚本连接现有的本机 MySQL（默认 3306），创建 campus_d3_local 和只能访问该库的 d3_local_app，生成随机应用密码并保存到 Git 忽略的 .env.local，再执行现有版本化迁移。若使用其他本机端口，可附加 -- --port 3307。重复执行已有成功配置会校验迁移，不清空数据。同名库/账号已存在但没有配置时拒绝覆盖；初始化中断时保留现场，需要先核对状态再恢复，不能清库重试。

日常启动及验证：

```powershell
npm.cmd run dev:local
```

保持启动窗口打开，在第二个窗口执行：

```powershell
npm.cmd run smoke:local
npm.cmd run verify:local
npm.cmd run db:status:local
```

### 浏览器本地验收页面

运行 `npm.cmd run dev:local` 后打开 **http://127.0.0.1:3106/local/d3/**。已启动的旧版本需要重启一次；若改过 `.env.local` 的 PORT，使用启动日志中的地址。没有增加依赖或数据库迁移。

- **通知测试**：选择来源模块与学生 101/102，发送真实站内消息；“原样重试”复用完整事件验证去重；“使通知失效”保留历史并停止计入有效未读。
- **个人消息**：切换学生、筛选已读状态、查看详情、标记或再次标记已读。详情查询不自动已读；重复已读应保留首次时间。
- **公告管理**：运营管理员 103 创建草稿、编辑、发布、撤回；每次修改携带版本，右侧公共预览直接调用公共接口。已发布公告先撤回再编辑。
- **操作审计**：系统管理员 104 按模块、用户、操作、结果和时间筛选，支持分页与详情；“验证学生无查询权限”应返回 403 并产生拒绝审计。
- 顶部四个数字通过固定 SQL 读回本地数据库计数，操作后刷新并显示增量。底部可展开最近操作的真实响应。时间显示为北京时间；时间输入使用本机时区。

页面不会自动创建演示数据。点写操作才会落库，测试记录保留，不提供清库或删除日志按钮。通知重试上下文仅保存在当前页面内存中；刷新后消息与公告仍从数据库读取，但需要先发送新通知才能使用“原样重试”。写操作遇到超时请先刷新核对结果，不盲目再次创建。

这是本地验收工具，不是统一 Vue 应用中的正式页面。只有 `dev:local` 挂载 `/local/d3/`，正式 `start` 与 `dev:mock` 不提供它。工具检查本机地址、Host、同源来源和页面会话键，假身份与假服务凭据由后端注入；数据库密码、服务令牌不发送给浏览器。全部业务操作经 HTTP 进入现有接口及权限/事务/审计逻辑；数据库摘要只读 D3 自有表。服务重启后刷新页面取得新会话。

- 健康检查：http://127.0.0.1:3106/api/d3/health，应显示 storage 为 mysql。
- 公共公告：http://127.0.0.1:3106/api/d3/announcements。
- smoke:local 验证通知闭环；verify:local 创建通知、已读记录、完成公告创建/编辑/发布/撤回/再次发布，并追加审计，随后通过独立 SQL 连接读回这些记录。验证数据会保留。
- db:status:local 显示四张业务表的记录数及最近公告、消息，便于你直接观察数据库变化。
- 用户/服务测试令牌与 Mock 一致。手动请求只需将原来的 3006 改为 3106；尚未接入真实 D1，不代表真实用户登录已完成。

验证“重启仍保留”：第一次 verify:local 后，在启动窗口按 Ctrl+C，再运行 dev:local，最后在第二个窗口执行：

```powershell
npm.cmd run verify:local -- --recheck
```

这次会按 .local/last-verification.json 保存的 ID 检查旧记录与首次已读时间，不创建新业务数据。停止 D3 或 MySQL 服务不会自动删除本地库。之前内存 Mock 中的数据不会自动迁移到这个库。

若用数据库客户端查看，连接 127.0.0.1:3306、数据库 campus_d3_local、账号 d3_local_app；密码在你本机 .env.local 中。不要把该文件提交或发给组员。可以查看 announcements、d3_notifications、d3_notification_recipients、operation_logs 及迁移记录 d3_schema_migrations。

切换到团队环境时配置 .env 中的 DB_HOST、DB_PORT、DB_NAME、DB_USER、DB_PASSWORD、D1_BASE_URL 和各模块独立的 D3_SERVICE_TOKENS，再使用 npm.cmd start。如果团队已建同名表但与本项目迁移不一致，应先比较表结构并新增增量迁移；不能仅替换地址就假定兼容，也不能将本地假用户数据直接导入团队库。

## 已完成与职责边界

| 能力 | 当前状态 |
|---|---|
| 其他模块提交通知 | 服务身份校验、幂等接收、内容冲突检查、站内消息存储 |
| 个人消息 | 本人列表/详情/有效未读数、首次已读时间、越权保护 |
| 失效与过期 | 来源模块可失效，保留历史；失效/过期不计有效未读 |
| 公告 | 草稿、编辑、发布、撤回、有效期、版本并发保护、管理查询 |
| 审计 | 可信服务追加、可选事件去重、管理员过滤查询、禁止编辑删除 |
| 持久化 | MySQL 四张业务表、D3 自有库、版本化初始迁移、本地事务与审计一起提交 |
| 联调 | 同一套 HTTP 与业务逻辑，替换为内存存储和假 D1 身份；附 HTTP 示例和自动化测试 |

M1 仍决定预约提醒时机及违约/取消/释放；M2/M3 仍决定审批/维修事件和收件人。D3 不替它们改业务状态，不读其他模块数据库。调用方需要保留事件、重试并保存通知 ID；D3 的去重不能代替调用方的可靠事件发送。

## 立即在本机使用 Mock

要求 Node.js 22+。在本目录打开终端：

```powershell
npm ci
npm run dev:mock
```

访问 http://127.0.0.1:3006/api/d3/health。另一个终端运行：

```powershell
npm run smoke
```

smoke 会用假 M1 创建通知，验证重试去重、个人消息、已读和失效闭环。启动时没有预置业务数据，重启 Mock 会清空记录。Mock 只监听本机，不连接数据库、真实 D1 或邮件/微信；NODE_ENV=production 时拒绝启动。

| 假身份 | 请求头 |
|---|---|
| 学生 101 | Authorization: Bearer mock-student-101 |
| 学生 102 | Authorization: Bearer mock-student-102 |
| 运营管理员 103 | Authorization: Bearer mock-operator-103 |
| 系统管理员 104 | Authorization: Bearer mock-admin-104 |
| M1 后端 | X-D3-Service-Token: mock-m1-local-only |
| M2/M3/D1/D2 后端 | 对应 mock-m2-local-only / mock-m3-local-only / mock-d1-local-only / mock-d2-local-only |

这些都是公开的测试占位身份，不能用于真实部署。直接请求示例在 [examples/requests.http](examples/requests.http)。Mock 可通过 D3_MOCK_PORT 改端口；独立前端需要跨域时，设置 D3_MOCK_CORS_ORIGIN 为精确来源（如 http://localhost:5173）。服务凭据只能由后端使用。

其他模块最先对接的接口：

1. POST /api/d3/internal/notifications：业务事件 → 通知 ID。
2. POST /api/d3/internal/notifications/{id}/invalidate：来源模块取消已接收的提醒。
3. POST /api/d3/internal/logs：重要操作审计。
4. GET /api/d3/messages/me 与 POST /api/d3/messages/me/{id}/read：用户页面使用 D1 登录令牌读取本人消息。

## 使用 MySQL 和真实 D1

1. 由数据库负责人提供 D3 自有逻辑库/账号；当前仓库约定 campus_d3 / d3_app。若小组最终采用同一逻辑库内的表级授权，需先调整授权及迁移安排。D3 不需要其他模块表的权限。
2. 将 .env.example 复制为 .env，填写 D3 数据库密码、D1_BASE_URL 和 D3_SERVICE_TOKENS。环境文件已经被忽略，不要提交。
3. D3_SERVICE_TOKENS 为模块到独立随机值的 JSON 对象，每个值至少 32 字符且不能重复，例如结构 {"M1":"<随机值>","M2":"<另一随机值>"}。只为实际调用的模块配置，示例占位符不能直接使用。
4. 对新建的 D3 空业务库执行 npm run migrate，然后 npm start。默认端口 3006、监听 127.0.0.1；容器部署需显式设置 HOST=0.0.0.0 与内部服务地址。

```powershell
Copy-Item .env.example .env
# 填写 .env 后，仅对已确认属于 D3 的数据库执行：
npm run migrate
npm start
```

正式模式始终使用 MySQL 和现有 D1 的 GET /api/d1/users/me，不会自动降级到 Mock。不需要把 D1 的 JWT 密钥交给 D3；D1 验证用户令牌并返回角色，D3据此授权。健康检查只检查 D3 存储，不代替 D1 可用性检测。

迁移建立 d3_notifications、d3_notification_recipients、announcements、operation_logs 和 d3_schema_migrations。只在 D3 内部建立通知—收件人外键，用户采用逻辑引用。数据库时间统一 UTC，JSON 输出带 Z 的时间；ID 统一字符串。

初始迁移检测到同名业务表且没有匹配迁移记录时会拒绝运行；不会删除、覆盖或自动接管已有表。共享数据库已有结构尚未核验。MySQL DDL 会隐式提交，若迁移中途失败，保留现场核对已创建的表，再制定修复迁移，禁止简单清库重跑。已执行迁移有 checksum 校验，后续变化必须新增迁移。

迁移校验统一按 LF 换行计算，并兼容旧版按完整 CRLF 内容保存的校验值；仅换行不同不会重跑迁移或重写历史记录。SQL 内容、空格或注释变化仍会被拒绝。D3 的 `.gitattributes` 将 `migrations/*.sql` 固定为 LF，不修改历史 SQL 文件。隔离 MySQL 测试验证旧校验值兼容、历史记录保留和真实内容变化的拒绝行为。

D3 尚未接入根目录 Compose、网关和正式前端；启动根目录脚本不会自动启动 D3。接入共享部署需要组内评审端口、服务凭据和权限。

## 测试

```powershell
npm test
```

默认执行内存 HTTP 合同测试和 D1 HTTP 适配测试；没有指定隔离 MySQL 时会明确跳过数据库用例，不把它们计为通过。测试业务逻辑本身不会被 Mock。

已安装 MySQL 8.0.16+ 时，可运行完整的独立数据库验证：

```powershell
npm run test:mysql:local -- "H:\mysql\mysql-8.0.40-winx64\bin\mysqld.exe"
```

将路径替换为自己的 mysqld。脚本初始化一个全新测试数据目录，随机本机端口、随机密码、仅有测试库权限的账号；不读取 .env 的数据库地址，不使用系统已有实例。测试后关闭该实例，并输出保留的数据目录。Windows 中文项目路径下使用系统临时目录，避免 MySQL 启动参数的路径兼容问题。

测试包括并发事件去重、同键内容冲突、越权、BIGINT 精度、已读幂等、通知失效/过期、公告版本和状态、审计追加与时间筛选、事务失败回滚、D1 超时/失效身份、数据库故障，以及迁移重放和重建连接后的数据保留。MySQL 并发去重使用原子 upsert，关闭 FOUND_ROWS 以正确区分首次插入与重试，见 [MySQL 官方说明](https://dev.mysql.com/doc/refman/8.0/en/insert-on-duplicate.html)。

## 后续增量

1. 外部投递任务表与 worker：邮件优先，包含超时、退避重试、失败查询、发送中租约；provider 接受、送达和用户已读分别记录。
2. 与 D1 约定可信联系方式查询；与 M1/M2/M3 确认事件类型、模板、接收人及 Outbox 重试。
3. 完成取消/签到事件的业务键失效屏障及乱序处理，再接真实微信渠道和回执。
4. 在现有 Vue 应用中接入消息与公告页面，评审后整合部署、日志收集与告警。

当前仅提供 IN_APP。EMAIL/WECHAT 会明确返回 CHANNEL_NOT_AVAILABLE，不能据此宣称真实发送已完成。公告管理默认 OPERATION_ADMIN/SYSTEM_ADMIN，日志查询默认 SYSTEM_ADMIN；这些首版权限及 expected_version 要求已写入契约，供团队评审。
