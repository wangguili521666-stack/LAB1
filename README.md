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


## 八、通过 Docker 启动前端（本地开发）

只需安装并启动 Docker Desktop；前端不再要求本机安装 Node.js / npm。
在项目根目录执行（首次使用请按第七节准备 `.env`）：

```bash
docker compose up -d --build frontend
```

打开 http://localhost:5173。Docker 会自动获取 Node.js 镜像，并根据
`frontend/package-lock.json` 执行 `npm ci`。依赖安装在镜像内部，
不会使用或在宿主机生成 `frontend/node_modules`。首次构建需要联网下载镜像和依赖。
已有的本机依赖目录会被构建忽略，无需删除。

- `frontend/src`、`index.html`、`vite.config.js` 挂载到容器，页面修改支持热更新。
- 修改 `package.json`、`package-lock.json` 或添加其他顶层资源目录后，重新执行上述启动命令。
- `docker compose up -d --build` 会一起启动前端与现有 MySQL；不会自动启动后端服务。
- 这是开发环境，不应直接作为公网生产部署。

常用操作（均在项目根目录执行）：

```bash
# 查看前端日志
docker compose logs -f frontend
# 在容器中检查构建与认证逻辑
docker compose run --rm --no-deps frontend npm run build
docker compose run --rm --no-deps frontend node --test tests/auth.test.mjs
# 仅停止前端，保留数据库与数据
docker compose stop frontend
```

### 端口与后端连接

默认前端端口为 5173。如果本机已有开发服务占用该端口，可以在根目录 `.env`
设置 `FRONTEND_PORT=5174`，再重新启动前端，访问 http://localhost:5174。

前端容器默认通过 `host.docker.internal` 访问本机正在运行的后端：
`/api/d1` 转发至 3004，其他 `/api` 请求转发至原有 8080 网关。
**仅启动前端不会使登录或业务接口自动可用**；D1 与其他后端仍需按各自说明启动。
Linux 下宿主机后端需监听容器可以访问的地址，不能只监听宿主机回环地址。

如果后端之后也接入同一 Compose 网络，可在根目录 `.env` 配置实际服务地址：

```dotenv
# 以下为可选覆盖项；服务名必须与实际 Compose 服务一致。
# D1_API_TARGET=http://d1:3004
# API_TARGET=http://gateway:8080
```

本机直接运行 `npm run dev` 时仍默认使用原来的 localhost 后端地址。
Docker 开发模式启用轮询监听，以兼容容器挂载文件的热更新。
