# 运行与使用手册

本手册从仓库根目录执行命令。当前交付平台为 GitHub Actions，CodeArts 文档仅保留历史参考。业务职责见根 README，逐条是否验收以 requirements/traceability.json 为准。

## 1. 普通用户：打开系统、注册和使用

已部署环境无需在个人电脑安装 Docker，请使用负责人提供的测试或生产网址，打开 `/login`。测试环境供联调验收，生产环境供正式使用；两个环境的账号和业务数据相互独立。

首次点击“创建账号”，填写用户名和密码，注册后默认学生角色；没有预置网站管理员账号。数据库账号、服务器登录账号均不能用于网页登录。登录后可进入座位预约、教室申请、物业报修、个人中心和我的消息；审批、派单、角色权限等功能由账号权限决定。完整业务规则见 [需求说明](requirements/demands.md)。

首个管理员由授权部署人员明确授予；本地环境在用户先注册后执行（将 USERNAME 替换为实际用户名）：

```bash
docker compose exec d1 node scripts/grant-role.js USERNAME SYSTEM_ADMIN
```

该命令改变权限，仅用于指定的管理员，不应给每个测试用户执行。角色和服务认证细节见 [集成架构](architecture/service-auth.md)。

## 2. 本地运行整个项目

需要 Git、已启动的 Docker Desktop（或 Docker Engine + Compose 插件）、Bash、openssl 和联网下载镜像/依赖的能力。只启动容器应用不要求本机 Node.js；运行 npm 测试命令要求 Node.js 22+、npm，发布脚本测试还需要 Python 3。

```bash
git clone git@github.com:wangguili521666-stack/LAB1.git
cd LAB1
bash start.sh
```

已有 lab1 文件夹时直接进入该目录执行最后一条命令，不必重复克隆。macOS 也可双击 `start.command`。Linux 请先启动 Docker 服务；脚本在 Docker 不可用时尝试的是 Docker Desktop。Windows 可在 WSL2 中执行 Bash 命令。

首次自动生成 `.env` 和随机密钥，创建 MySQL 六个独立库及账号，启动六后端与前端；后端先迁移和同步种子，再提供服务。访问脚本输出的网址，默认 `http://localhost:5173/login`。八个容器应全部 healthy；已有配置和数据卷保留。升级代码后再次执行 `bash start.sh`。

```bash
# 检查与排错
docker compose ps
docker compose logs --tail=100 mysql d1 d2 d3 m1 m2 m3 frontend
# 停止，保留业务数据
docker compose stop
```

不要用 `docker compose down -v` 作为升级或密码问题的解决方法。已有数据库修改 `.env` 不会自动修改库中密码。端口冲突可在 `.env` 修改 `FRONTEND_PORT` 后重启。本地前端是开发服务器，生产由发布镜像中的 Nginx 提供页面。

## 3. 开发者：改代码、迁移与验证

```bash
npm test                       # 快速检查，不证明真实数据库集成通过
npm run test:all               # Docker 中全系统、空库迁移、两轮重放、跨模块测试
npm run requirements:check     # 验收标准、编号、实现/验证路径完整性
npm run test:mutation          # 需相关包依赖；完整测试会自动准备依赖
python3 scripts/release_test.py # 发布器行为测试；Docker 边界受控，不是真实部署
npm run build                 # 仅前端构建，不启动平台
```

完整测试创建并清理本轮独立环境，不使用业务库；结果见 `test-results/`。条件跳过的用例不计为已验证。[详细覆盖与限制](testing.md)。

结构变更只新增 `backend/模块/migrations` 中的递增 SQL，执行该模块 `migration:register` 并提交校验清单；默认字典和配置写入 `seeds`，不放真实用户、预约或工单。已有环境可执行 `npm run db:replay`，这会重复检查迁移并同步种子，不会重新构建镜像。完整规则见 [数据库演进](database-evolution.md)。

新增需求先写清前置条件、输入、结果和拒绝边界，再同步 demands、traceability.json 与 baseline-ids.json。未完成保留状态和 gap；不能删除条目来让清单变绿。实现、断言、验收证据必须一起更新。

## 4. 发布负责人：从代码到上线

1. 功能分支提交并发起 PR；push 和 PR 都自动触发 quality。
2. quality 通过后由有权限且非作者的 CODEOWNER 检查，选择 **Approve** 提交评审。仅 Comment 或分配 Copilot 不满足批准条件。
3. 合并 main 后等待 CI 的 quality → bundle → staging 全部成功，自动部署全部模块。
4. 测试环境验收通过后，按 [生产发布手册](github-cicd.md)选择该成功 CI 的 run_id，手动审批 production。
5. 检查 `/version.json`、六模块健康接口和关键业务。上线失败不等于自动恢复旧版，应先检查容器和迁移状态。

## 5. 实现位置与证据

| 内容 | 主要文件 |
| --- | --- |
| 容器启动及本地配置 | `start.sh`、`docker-compose.yml`、`scripts/infra.sh` |
| 独立完整测试与重放 | `scripts/ci.sh`、`scripts/db-replay.sh`、各模块 migrations/seeds |
| 需求追踪与变异 | `scripts/requirements-check.mjs`、`scripts/mutation.mjs` |
| 自动构建和生产审批入口 | `.github/workflows/ci.yml`、`.github/workflows/production.yml` |
| 统一制品和前端网关 | `scripts/release-build.mjs`、`deploy/Dockerfile.frontend`、`deploy/nginx.conf` |
| 传输、部署、版本与回滚 | `scripts/remote-release.sh`、`scripts/server-release.sh` |
| 发布回归测试 | `scripts/release_test.py` |

实际运行证据和待完成事项见 [GitHub 交付验收记录](github-cicd-validation.md)。生产自动备份恢复、TLS、容量与磁盘保留策略仍需后续运维配置；首次服务器安装 Docker 和 SSH 权限仍需准备，不把应用自动发布描述为服务器从零自动安装。
