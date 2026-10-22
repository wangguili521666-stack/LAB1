# D1 服务（用户 / 登录 / RBAC / 个人资料）

D1 模块后端服务：用户注册、登录登出、个人资料查询与修改；角色/权限（RBAC）表结构已建好，角色分配等接口后续补充。

## 技术栈
Node.js + Express + MySQL（mysql2）+ JWT（jsonwebtoken）+ bcryptjs。

## 目录
- `src/index.js` —— 统一入口：加载配置、连接数据库、挂载路由、启动服务
- `src/routes/auth.js` —— 注册 / 登录 / 登出
- `src/routes/users.js` —— 本人资料查询与修改
- `src/middleware/auth.js` —— JWT 校验中间件
- `src/db.js`、`src/config.js` —— 连接池与配置
- `src/utils/response.js`、`src/utils/format.js` —— 统一响应包装、时间格式化
- `migrations/` —— 版本化迁移（表结构 + 默认角色）
- `scripts/migrate.js` —— 迁移 runner

## 快速开始
```bash
# 1) 先启动共享 MySQL（在仓库根目录执行一次）
cp .env.example .env && docker compose up -d mysql

# 2) 在本目录配置并安装
cp .env.example .env      # 把 DB_PASSWORD 设成根目录 .env 里的 D1_DB_PASSWORD
npm install

# 3) 建表 + 种子角色，然后启动
npm run migrate
npm run dev               # 默认端口 3004
```

## 接口（统一前缀 /api/d1）
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | /health | 健康检查 | 否 |
| POST | /auth/register | 注册（分配默认 STUDENT 角色） | 否 |
| POST | /auth/login | 登录，返回 JWT | 否 |
| POST | /auth/logout | 登出 | 是 |
| GET | /users/me | 本人资料（含角色） | 是 |
| PATCH | /users/me | 修改昵称/邮箱/手机号 | 是 |

响应统一为 `{ code, message, data, request_id }`（见 `docs/api/common.md`）。

## 端口约定（团队提议）
`m1=3001 m2=3002 m3=3003 d1=3004 d2=3005 d3=3006`。前端开发时经 Vite 代理 `/api/d1` → `http://localhost:3004`。

## 待办
- 角色分配 / 权限管理接口（`PUT /users/{id}/roles` 等）
- 个人业务记录聚合（调 M1/M2/M3 的 `/me` 接口）
- 修改密码（`PUT /users/me/password`，需校验原密码）
- 注册时学院校验（已做存在性校验）、colleges 种子数据
