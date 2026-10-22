# 数据库隔离方案

## 目标
六个模块（M1/M2/M3/D1/D2/D3）共用一个 MySQL 实例，但彼此的数据完全隔离、互不影响。

## 方案：单实例 + 每模块独立库 + 最小权限账号
在一个 MySQL 服务里为每个模块建一个独立 database，并各配一个专属账号，账号只被授予本库权限：

| 模块 | 数据库 | 账号 | 权限范围 |
|---|---|---|---|
| M1 | campus_m1 | m1_app | 仅 campus_m1.* |
| M2 | campus_m2 | m2_app | 仅 campus_m2.* |
| M3 | campus_m3 | m3_app | 仅 campus_m3.* |
| D1 | campus_d1 | d1_app | 仅 campus_d1.* |
| D2 | campus_d2 | d2_app | 仅 campus_d2.* |
| D3 | campus_d3 | d3_app | 仅 campus_d3.* |

效果：
- 每个服务用「自己的库名 + 自己的账号」连接，看不到也改不了别的库；
- 即便某个服务泄露了自己的账号，也无法跨库读写，从权限层面杜绝模块互相影响；
- 满足 agents.md 第 5.5 条：模块间只能走 HTTP API，不得直接读写他人表。

> 说明：隔离的是「数据与权限」，不隔离 CPU/内存/磁盘 —— 它们仍共享同一实例的硬件，属性能层面，不影响数据正确性。

## 目录
- `docker-compose.yml`：MySQL 8 服务定义
- `db/init/00-init-databases.sh`：初始化时创建 6 库 + 6 账号（幂等；只做库/账号，不建业务表）
- `.env.example`：各模块账号密码等配置模板

## 快速开始
```bash
cp .env.example .env            # 改掉里面的默认密码
docker compose up -d mysql      # 首次启动会自动执行 db/init 脚本
docker compose logs mysql       # 确认 6 个库/账号创建完成
```

验证隔离（以 M1 为例，应只能看到 campus_m1 一个业务库）：
```bash
docker compose exec mysql mysql -um1_app -p -e "SHOW DATABASES;"
# 输入 M1_DB_PASSWORD，结果里除 information_schema 等系统库外，只应有 campus_m1
```

## 各模块连接配置（通过环境变量注入，勿硬编码）
每个后端服务只注入自己的这几个变量：

```
DB_HOST=mysql          # compose 网络内用服务名 mysql；宿主机直连用 localhost
DB_PORT=3306
DB_NAME=campus_m1      # 各模块对应自己的库名
DB_USER=m1_app         # 各模块对应自己的账号
DB_PASSWORD=<M1_DB_PASSWORD>
```

通用 MySQL DSN 形如：
```
mysql://m1_app:<password>@mysql:3306/campus_m1?charset=utf8mb4
```

## 规则（务必遵守）
1. **业务表不要在 db/init 里建**。每个模块的表由该模块自己的「版本化迁移脚本」创建（见 agents.md 第 7 条）。
2. **root 不给业务用**。每个服务只用自己模块的 `*_app` 账号。
3. **密码不提交仓库**。真实密码只放 `.env`（已被 .gitignore 忽略），`.env.example` 只放占位值。
4. 收紧安全：把 `db/init` 里账号的 `'%'` 改为具体主机/网段；生产环境再把账号拆成 `*_migrate`（DDL）与 `*_app`（DML）两个。
