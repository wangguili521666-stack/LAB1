# 校园资源服务平台

六个模块协作的校园资源服务平台。本仓库面向「人 + AI 编程助手」并行开发：**所有开发规则统一写在 [`agents.md`](./agents.md)**，本文是项目架构与开发入口，帮团队成员快速上手，并能正确地用 Agent 开发。

## 一、模块划分

| 模块 | 职责 | 自有数据表 | 前端 | 后端 |
|---|---|---|---|---|
| M1 | 自习座位查询、预约、签到、提醒、违约、历史、统计 | seat_bookings、seat_checkins、booking_violations、booking_settings | ✅ | ✅ |
| M2 | 整教室申请、权限门槛、两级审批、超时撤销 | classroom_applications、application_approvals | ✅ | ✅ |
| M3 | 故障报修、派单、进度、超时升级、验收、评价 | repair_types、repair_tickets、repair_progress、repair_reviews | ✅ | ✅ |
| D1 | 用户、学院、登录、RBAC、资料、个人业务记录聚合 | users、roles、user_roles、permissions、role_permissions、colleges | ❌ | ✅ |
| D2 | 教室/座位主数据、可用性、冲突检测、资源预占/确认/释放 | classrooms、seats、resource_reservations | ❌ | ✅ |
| D3 | 公告发布、查询、操作审计 | announcements、operation_logs | ❌ | ✅ |

约定：**M 开头 = 前端 + 后端；D 开头 = 纯后端服务（无前端页面）**。

## 二、架构

- **单一 Vue 前端**（`frontend/`）：六个模块共用同一个 Vue Router，只挂 `/m1`、`/m2`、`/m3` 三个页面（D 模块无页面）。
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
然后构建并启动 **MySQL → D1 用户后端 → 前端**。
数据库健康后，D1 自动执行现有版本化迁移；已执行的迁移会跳过。
脚本保留已有 `.env`、数据库账号密码和数据卷，不清库或重置密码。
本机无需安装 Node.js、npm；首次生成配置需要 openssl（macOS 已提供）。

启动成功后访问 http://localhost:5173/login，端口如有覆盖，以脚本输出为准。
配置已经生成后，也可以直接使用：

```bash
docker compose up -d --build --wait
```

**当前仓库仅 D1 有后端实现。** 一键启动覆盖现有可运行服务，
支持注册、登录、个人资料；M1/M2/M3/D2/D3 尚无后端，相关业务暂不可用。
没有为这些模块创建占位服务或修改业务页面。

### 登录与首次注册

1. 在项目根目录双击 `start.command`（macOS），或执行 `./start.sh`。
   等待出现“启动成功”，确保 MySQL、D1 和前端都已就绪。
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
docker compose logs --tail=80 d1 mysql frontend
```

三个服务应处于 `healthy` 状态；仅打开前端预览或单独运行前端，不能代替启动 D1 和 MySQL。

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
- D1 不发布宿主机端口，浏览器统一通过前端访问接口。
- 其他 `/api` 不再默认转发到宿主机 8080，以免误连其他项目。
  后续网关就绪后，在 `.env` 配置 `API_TARGET=http://实际网关地址:端口`。
- MySQL 端口仍由 `.env` 的 `MYSQL_PORT` 控制；数据保存在原 `mysql_data` 卷中。
- 已有数据卷不会重新执行首次初始化脚本。若账号密码不一致，应检查原配置和数据库授权，
  不要通过删除数据卷解决；修改 `.env` 并不会自动修改库内已有密码。
- `D1_JWT_SECRET` 必须有值，启动脚本会为缺失项生成随机值；不要将 `.env` 提交到仓库。
