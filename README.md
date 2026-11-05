# 校园资源服务平台

六个模块协作的校园资源服务平台。本仓库面向「人 + AI 编程助手」并行开发：**所有开发规则统一写在 [`agents.md`](./agents.md)**，本文是项目架构与开发入口，帮团队成员快速上手，并能正确地用 Agent 开发。

## 先从这里开始

- **使用系统**：本地执行 `bash start.sh`，打开脚本输出的 `/login` 地址，自行注册账号；详细步骤见[运行与使用手册](docs/operation-guide.md)。
- **了解本次交付**：见下方功能表，以及[运行与使用手册](docs/operation-guide.md)中的实现文件对应关系。
- **开发和测试**：Node.js 22+，`npm test` 做快速检查，`npm run test:all` 做隔离的真实数据库和跨模块验收；见[测试说明](docs/testing.md)。
- **合并和发布**：PR 测试通过并获批准 → 合并 main → 自动部署测试环境；生产另需手动发起并审批。见[GitHub CI/CD 手册](docs/github-cicd.md)。
- **查验完成情况**：见[交付验收记录](docs/github-cicd-validation.md)和[逐条需求追踪](docs/requirements/traceability.md)，不能把整轮 CI 通过等同于所有业务需求已验收。

### 已交付的工程能力

| 能力 | 如何实现 | 如何使用或验证 |
| --- | --- | --- |
| Schema 版本演进 | 各模块 migrations、历史 SQL 校验清单、数据库迁移记录，成功版本跳过 | `npm run db:replay`；完整 CI 从空库启动并重放两轮 |
| 幂等初始化数据 | seeds 与业务数据分开，迁移后自动执行，保留已有自定义配置 | [数据库演进手册](docs/database-evolution.md) |
| 需求可追踪 | 稳定编号、验收条件、实现/验证路径、状态及缺口 | `npm run requirements:check` |
| 测试有效性 | 临时副本故意破坏真实逻辑，要求原测试失败 | `npm run test:mutation`；[质量基线](docs/quality-baseline.md) |
| 基础设施脚本化 | Docker Compose、随机本地配置、一键启动与健康检查 | `bash start.sh`；`npm run infra:status` |
| 避免部署干扰验收 | 每轮完整 CI 使用独立目录、端口、数据库卷；部署按环境串行 | `npm run test:all`，不用正在部署的共享环境判定 CI |
| 自动构建与测试部署 | GitHub push/PR 触发 quality，main 成功后统一打包七个应用并部署 | GitHub Actions → CI |
| 合并与生产门禁 | main 必需检查和代码评审，production 人工审批，同一制品晋级 | [审批及发布步骤](docs/github-cicd.md) |
| 版本追踪及兼容回滚 | `/version.json`、发布日志、保留制品、Schema 指纹校验 | 生产工作流 rollback；实际验收限制见[记录](docs/github-cicd-validation.md) |

生产首版已发布，测试环境已做双向回滚演练。回滚保留新版发布器的修复在 PR #3，尚待合并；生产首版没有旧成功版本，生产实际回滚仍待验收。这是交付记录，不是自动更新的在线状态面板。

## 一、模块划分

下表说明模块职责分工；实际实现与启动方式见后文。

| 模块 | 职责 | 自有数据表 | 前端职责 | 后端职责 |
|---|---|---|---|---|
| M1 | 自习座位查询、预约、签到、提醒、违约、历史、统计 | seat_bookings、seat_checkins、booking_violations、booking_settings | ✅ | ✅ |
| M2 | 整教室申请、权限门槛、两级审批、超时撤销 | classroom_applications、application_approvals | ✅ | ✅ |
| M3 | 故障报修、派单、进度、超时升级、验收、评价 | repair_types、repair_tickets、repair_progress、repair_reviews | ✅ | ✅ |
| D1 | 用户、学院、登录、RBAC、资料、个人业务记录聚合 | users、roles、user_roles、permissions、role_permissions、colleges | ❌ | ✅ |
| D2 | 教室/座位主数据、可用性、冲突检测、资源预占/确认/释放 | classrooms、seats、resource_reservations | ❌ | ✅ |
| D3 | 通知接收、个人消息与已读、公告管理、操作审计 | d3_notifications、d3_notification_recipients、announcements、operation_logs | ❌ | ✅ |

约定：**M 开头负责前端与后端；D 开头提供后端服务**。D3 另附仅供本机开发使用的验收页面，不属于正式 Vue 业务页面。

## 二、架构

- **单一 Vue 前端**（`frontend/`）：六个模块共用同一个 Vue Router，包含业务大厅、登录、个人中心、消息、角色权限和签到屏幕。
- **六个后端服务**（`backend/{M1,M2,M3,D1,D2,D3}`）：每个模块一个服务。
- **单个 MySQL 实例 + 六独立库**：每模块一个 database（`campus_m1`…`campus_d3`）和一个「仅本库权限」的专属账号（`m1_app`…`d3_app`），互不影响。详见 [`db/README.md`](./db/README.md)。
- **模块间只走 HTTP API**（`/api/{module}/...`），不得直连他人数据库表。

### 三条核心跨模块链路

| 链路 | 关键约束 |
|---|---|
| M1 → D2 座位预约 | 可用座位由 D2 统一判定；预约经 D2 原子预占/确认；取消或违约须释放 |
| M2 → D1、D2 教室申请审批 | D1 校验角色/学院权限，D2 预占/确认；驳回/撤销/超时须释放 |
| M3 → D2 维修下架 | 进入维修时阻止关联教室新预约，验收后恢复 |

## 三、目录结构

```
.
├── agents.md                     # ★ 全体 AI 助手的开发规则（权威，务必先读）
├── README.md                     # 本文：架构与开发入口
├── docker-compose.yml            # MySQL 8 服务（六模块共用）
├── .env.example                  # 数据库账号密码模板（复制为 .env）
├── db/
│   ├── README.md                 # 数据库隔离方案与使用
│   └── init/00-init-databases.sh # 建 6 库 + 6 最小权限账号（幂等）
├── docs/
│   ├── requirements/
│   │   ├── demands.md            # ★ 业务需求、状态流转、验收标准
│   │   └── databaseDescription.md  # ★ 数据库表结构/字段
│   └── api/
│       ├── common.md             # ★ 通用请求/响应/错误码/跨模块契约
│       └── {m1,m2,m3,d1,d2,d3}.md # 各模块 API 契约
├── frontend/                     # 单一 Vue 应用
│   └── src/{App.vue,main.js,router/index.js,views/*.vue}
└── backend/                      # 六个后端服务（每模块一个目录）
    └── {M1,M2,M3,D1,D2,D3}/
```

## 四、权威来源（冲突时按此判定）

| 内容 | 权威文件 |
|---|---|
| 开发规则 | `agents.md` |
| 业务需求 / 状态流转 / 验收 | `docs/requirements/demands.md` |
| API 路径、方法、请求/响应、错误码 | `docs/api/*.md`（通用规范见 `common.md`） |
| 数据库表结构 / 字段 | `docs/requirements/databaseDescription.md` |
| 数据库隔离与部署 | `db/README.md`、`docker-compose.yml` |

> 需求、Schema、OpenAPI 之间出现矛盾时：**先指出冲突并请求负责人确认，不得自行选定一版悄悄改**。

## 五、开发规则速览（完整版见 agents.md）

1. 动手前先读：`agents.md` → 目标模块的 `demands` 段落 → `docs/api/{module}.md` → `databaseDescription.md`。
2. 只改本次任务相关文件；不顺手重构、不批量格式化、不改他人模块。
3. 模块间只走 HTTP API；不得直连他人表，即便共享同一 MySQL 实例。
4. 表结构只能通过**版本化迁移脚本**演进；禁止手改库、改历史迁移。
5. 不根据猜测新增 API / 表 / 字段 / 状态枚举 / 角色权限，并当作已批准设计。
6. 秘密不入库：密码只存哈希，token/密钥不进 Git 或日志。
7. 完成代码任务后，按 `agents.md` 第 11 条格式汇报。

**共享资产**（改动需评审）：`frontend/src/router/`、公共组件、网关、Compose、CI、OpenAPI、全局依赖、数据库迁移规则。

## 六、用 AI 助手开发一个模块（快速开始）

以「开发 M1 的 XX 功能」为例，可复用下面的提示词模板：

```
你是本项目的一名后端开发。开始前先阅读：
  - agents.md（开发规则）
  - docs/requirements/demands.md（M1 段落）
  - docs/api/m1.md（M1 接口契约）
  - docs/requirements/databaseDescription.md（表结构）

请开发 M1 的 <功能>，要求：
  1. 先给出简短计划（修改范围 / 依赖模块 / 预期行为 / 验收方式 / 风险），再动手；
  2. 只修改 M1 相关文件，不要动其他模块与共享资产（前端路由、Compose、迁移规则等）；
  3. 严格按 docs/api 契约实现；缺字段/枚举/接口或与需求冲突时，停下来指出并询问，不要自行编造；
  4. 表结构用版本化迁移脚本，不要手改数据库；
  5. 完成后按 agents.md 第 11 条汇报：完成内容 / 修改文件 / 契约·Schema 影响 / 测试结果 / 风险与待确认。
```

要点：让 Agent **先读权威文档、先出计划、限定范围、按契约开发、缺东西就问而不是编**。

> 提示：`agents.md` 在 macOS（大小写不敏感）下会被当作 `AGENTS.md` 自动加载；若在 Linux/CI（大小写敏感）上想让 AI 助手自动读取，请把它重命名为 `AGENTS.md`。

## 七、本地启动

```bash
# 1. 数据库（首次启动自动建 6 库 + 6 账号）
cp .env.example .env           # 改掉默认密码
docker compose up -d mysql
docker compose logs mysql      # 看到 6 个 "OK campus_xx <- xx_app" 即成功

# 2. 前端
cd frontend
npm install
npm run dev
```

各后端服务通过环境变量连接自己的库：`DB_HOST=mysql`、`DB_PORT=3306`、`DB_NAME=campus_<模块>`、`DB_USER=<模块>_app`、`DB_PASSWORD=<对应密码>`（勿硬编码、勿用 root）。


## 八、一键启动（推荐，本地开发）

安装 Docker Desktop 后，在项目目录双击 **start.command**（macOS），
或在终端执行：

```bash
./start.sh
```

启动脚本会尝试打开 Docker Desktop，首次运行生成缺失的本地配置和随机密钥，
然后构建并启动 **MySQL → D1/D2/D3/M1/M2/M3 六个后端 → 前端**。
数据库健康后，六个后端分别执行本模块版本化迁移和种子脚本；已成功执行的迁移会跳过。
脚本保留已有 `.env`、数据库账号密码和数据卷，不清库或重置密码。
本机无需安装 Node.js、npm；首次生成配置需要 openssl（macOS 已提供）。

启动成功后访问 http://localhost:5173/login，端口如有覆盖，以脚本输出为准。
配置已经生成后，也可以直接使用：

```bash
docker compose up -d --build --wait
```

**统一启动现已覆盖 D1/D2/D3/M1/M2/M3 和前端。** 服务认证、状态补偿、首次角色授权、验收范围见 [集成架构](docs/architecture/service-auth.md)。

### 登录与首次注册

1. 在项目根目录双击 `start.command`（macOS），或执行 `./start.sh`。
   等待出现“启动成功”，确保 MySQL、六个后端服务和前端都已就绪。
2. 浏览器打开 [登录页面](http://localhost:5173/login)。如果修改了 `FRONTEND_PORT`，
   请使用启动脚本输出的地址。
3. **首次使用**：点击“创建账号”，填写自己设置的用户名和密码，再点击“创建账号并登录”。
   昵称、邮箱、手机号和学院 ID 均为选填；不清楚学院 ID 时请留空，填写时必须是数据库中已有的学院。
   注册成功后会自动登录，新用户默认分配学生角色。
4. **已有账号**：输入注册时设置的用户名和密码，点击“登录”。普通登录后进入个人中心；
   如果是访问受保护页面后跳转到登录页，登录成功会返回原页面。
5. **退出登录**：进入“个人中心”，点击“退出登录”。

项目初始化不会创建默认网站账号，数据库的 `root` / `d1_app` 账号和 `.env` 中的数据库密码
不能用于网页登录。请自行注册，不要把个人登录密码写进 README 或提交到仓库。

若提示“用户名已存在”，请使用原账号登录或更换用户名；注册成功但自动登录失败时，
直接使用刚注册的账号重试登录，无需再次注册。
若页面可以打开但提示服务不可用，在项目根目录检查：

```bash
docker compose ps
docker compose logs --tail=80 d1 m2 mysql frontend
```

MySQL、六个后端和前端均应处于 `healthy` 状态；仅打开前端预览或单独运行前端，不能代替启动 D1 和 MySQL。

### 日常使用

```bash
# 查看运行状态和日志
docker compose ps
docker compose logs -f d1 frontend
# 停止本项目，保留数据
docker compose stop
# 在容器内验证前端
docker compose run --rm --no-deps frontend npm run build
docker compose run --rm --no-deps frontend node --test tests/auth.test.mjs
```

前端 `src`、`index.html`、`vite.config.js` 支持修改后热更新。
依赖、Dockerfile、D1 后端代码改变后，重新运行 `./start.sh` 即可重建。
依赖安装在镜像内，不使用本机 `node_modules`，也不需要手动运行 `npm run dev`。
这是本地开发环境，不应直接作为公网生产部署。

### 端口、后端与已有数据库

- 前端默认仅监听本机 5173；端口冲突时在 `.env` 设置 `FRONTEND_PORT=5174`。
- `/api/d1` 通过 Compose 网络连接 `d1:3004`，D1 只使用 `d1_app` 账号连接 `campus_d1`。
- `/api/m2` 连接 `m2:3002`，M2 只使用 `m2_app` 账号连接 `campus_m2`，并用 `D1_JWT_SECRET` 校验登录态。
- 六个后端均通过 Compose 内网访问，浏览器统一通过前端的 `/api/d1`、`/api/d2`、`/api/d3`、`/api/m1`、`/api/m2`、`/api/m3` 代理调用；本地开发不要把这些路径改指向生产。
- 未匹配上述模块的 `/api` 才使用 `API_TARGET` 回退配置。
- MySQL 端口仍由 `.env` 的 `MYSQL_PORT` 控制；数据保存在原 `mysql_data` 卷中。
- 已有数据卷不会重新执行首次初始化脚本。若账号密码不一致，应检查原配置和数据库授权，
  不要通过删除数据卷解决；修改 `.env` 并不会自动修改库内已有密码。
- `D1_JWT_SECRET` 必须有值，启动脚本会为缺失项生成随机值；不要将 `.env` 提交到仓库。

## 九、D3 首版接口与本地验收

D3 已提供站内通知接收与重试去重、个人消息与已读、通知失效、公告草稿/编辑/发布/撤回、审计追加与筛选查询。接口见 [`docs/api/d3.md`](./docs/api/d3.md)，完整启动、权限、迁移与测试说明见 [`backend/D3/README.md`](./backend/D3/README.md)。通知格式、角色权限及公告 `expected_version` 是首版联调契约，接入共享环境前需组内评审。

### 先用 Mock 对接接口

要求本机 Node.js 22+。从项目根目录执行：

```bash
cd backend/D3
npm ci
npm run dev:mock
```

默认地址为 http://127.0.0.1:3006/api/d3/health。Mock 使用内存和模拟身份，不需要数据库；重启清空数据。在第二个终端进入 `backend/D3` 后运行 `npm run smoke`，或使用 [`examples/requests.http`](./backend/D3/examples/requests.http) 手动调用接口。

Windows PowerShell 若拦截 `npm.ps1`，将命令中的 `npm` 换成 `npm.cmd`，无需修改系统执行策略。

### 用本地 MySQL 和浏览器验收

本机已运行 MySQL 时，在 `backend/D3` 目录执行：

```bash
npm run db:setup:local
npm run dev:local
```

首次初始化按提示输入本机数据库管理员密码，脚本创建专用的 `campus_d3_local` 库和 `d3_local_app` 账号；已有成功配置会直接检查迁移。应用密码保存在 Git 忽略的 `.env.local`，管理员密码不保存。

打开 **http://127.0.0.1:3106/local/d3/**，即可点击测试通知、学生消息已读、公告管理和审计查询。数据真实写入本地 MySQL，重启保留；身份仍是模拟账号。页面顶部用 SQL 读回记录数，底部可查看接口响应。运行 `npm run db:status:local` 也可检查数据库。

### 接入范围与提交内容

- 正式入口为 `npm start`，从 `.env` 读取团队数据库、可达的 `D1_BASE_URL` 和各模块独立服务凭据，并使用真实 D1 认证。实际团队库表结构和完整服务联调仍需验证。
- D3 已接入根目录 Compose、一键启动与统一前端代理；服务间使用 Compose 服务名通信。
- M1/M2/M3 仍负责业务事件、提醒时机和接收人；D3 不改变它们的业务状态。当前只实现站内消息，邮件和微信渠道尚未接入。
- 可共享 D3 业务代码、迁移脚本、测试、Mock、验收页面、初始化工具、配置模板与锁文件。真实 `.env`/`.env.local`、`node_modules/`、`.local/`、`.mysql-test/` 和数据库运行数据不提交。
- `npm test` 运行无需 MySQL 的测试；完整隔离 MySQL 测试按 D3 README 执行。不要把跳过的数据库用例计为通过。

## 本机备用启动（已有初始化 MySQL）

当 Docker 无法创建新容器时，可复用已初始化的 MySQL，使用 Node.js 22+ 本机运行六模块。先在每个 backend 模块与 frontend 执行 npm ci，再在根目录执行 `node scripts/run-local.mjs`。脚本读取根 .env，使用六个模块各自账号执行迁移；仅补充缺失的服务密钥，不更改原密码、不清库。默认访问 http://127.0.0.1:15173/login；本机后端端口 18001–18006，可通过 LOCAL_PORT_BASE 和 LOCAL_FRONTEND_PORT 调整。日志在 Git 忽略的 .local-logs/。Ctrl+C 停止本次启动的服务。

该模式要求 MySQL 已由 db/init 初始化六库和账号；全新环境仍优先 ./start.sh。

本轮实际通过与未验证范围详见 [集成验证记录](docs/architecture/integration-validation.md)。站内提醒可在导航栏“我的消息”查看并标为已读。

## 角色权限、个人记录与教室签到屏幕

- 系统管理员进入“角色权限”：创建角色、勾选权限、搜索用户并分配/撤销角色。权限变更对下一次请求生效，最后管理员受保护。首个管理员仍由部署操作员通过 grant-role.js 显式授予，不开放自助提权。
- “个人中心 → 我的业务记录”：按座位预约、教室申请、物业报修分类分页查询本人记录。
- “教室签到屏幕”：SYSTEM_ADMIN 或有 checkin:display 权限的本学院管理人员输入教室 ID 后点击展示，可切换全屏投放在教室屏幕；六位编码每日北京时间零点自动更新。失联或权限失效时隐藏旧码。这里采用数字编码方案，不需要二维码。

本轮新增迁移 backend/D1/migrations/003_rbac.sql；启动脚本会执行迁移并补充 D1→D3 独立密钥。请勿手工修改既有迁移或清空数据库。

## 合并后回归验证

使用 Node.js 22+，先安装各模块依赖。无需数据库的回归：

```bash
node --test backend/D2/tests/unit/*.test.js backend/D3/test/*.test.js backend/M1/test/*.test.js frontend/tests/*.test.mjs
(cd frontend && npm run build)
```

真实六服务联调（需要已运行的 MySQL，根 `.env` 中的管理员配置仅用于创建独立测试库）：

```bash
docker compose up -d mysql
TEST_DB_ENV_FILE=.env node scripts/local-integration.mjs
```

联调创建 `lab1_it_*` 独立库，不清理业务库；测试库保留以便排查。固定测试端口 19001–19006、15174 须空闲。
M2 独立测试会删除其测试库内申请记录，现要求显式设置 `M2_TEST_DB_NAME=lab1_it_<标识>_m2`、`M2_TEST_DB_USER`、`M2_TEST_DB_PASSWORD`；可选 `M2_TEST_DB_HOST`、`M2_TEST_DB_PORT`。先创建独立测试库并授权，再执行 `(cd backend/M2 && npm test)`，禁止使用业务库。

## 自动构建与测试（CodeArts）

执行 `bash scripts/ci.sh full` 运行完整 CI；快速检查为 `bash scripts/ci.sh unit`。见 [CodeArts CI 说明](docs/codearts-ci.md)。

## 统一自动测试入口

根目录执行 `npm test`；完整数据库与跨模块检查执行 `npm run test:all`。测试日志保存在 `test-results/`。详见 [测试说明](docs/testing.md)。

## 根目录一键构建

安装 Node.js 22+（含 npm）后，在项目根目录执行：

```bash
npm run build
```

缺少 Vite 时自动执行前端 `npm ci`，首次安装需要联网。已有依赖发生变化时，先执行 `npm --prefix frontend ci`。构建产物输出到 `frontend/dist/`。后端是直接运行的 JavaScript，无需编译；该命令不启动服务或数据库，完整平台仍通过 `./start.sh` 启动。

## 数据库版本演进与部署隔离

迁移、种子数据及集成测试使用约定见 [docs/database-evolution.md](docs/database-evolution.md)。已有环境重放执行 `npm run db:replay`，正式集成验收执行 `npm run test:all`。

## 需求追踪与行为验证

见 [质量基线说明](docs/quality-baseline.md)。`npm run requirements:check` 检查需求完整性；`npm run test:mutation` 验证故意破坏逻辑后测试会失败；两项已接入 CI。基础设施统一使用 `npm run infra:up`、`npm run infra:status`、`npm run infra:stop`。

## GitHub CI/CD

当前交付使用GitHub Actions，使用及审批/回滚说明见 [GitHub交付说明](docs/github-cicd.md)。历史CodeArts文档保留供追溯。
