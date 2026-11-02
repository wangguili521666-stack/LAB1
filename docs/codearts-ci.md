# CodeArts 自动构建与测试

## 仓库脚本

在项目根目录执行（必须使用 Bash，不能使用 sh）：

```bash
bash scripts/ci.sh full
```

如果 CodeArts 拉取的是外层目录，则执行：

```bash
bash lab1-integration/scripts/ci.sh full
```

完整模式依次执行七个包的 `npm ci`、JavaScript 语法检查、前端和 D1/D2/D3/M1/M3 自动化测试、Vite 生产构建、Compose 配置验证和镜像构建、临时 MySQL 和六服务启动、M2 数据库测试、D2 隔离数据库集成测试、已有跨服务 integration.mjs 测试。任一步失败即返回非零状态。

`bash scripts/ci.sh unit` 只执行无需 Docker 的检查；不包含 M2 数据库测试和全系统集成，不能替代完整门禁。D3 的独立持久化测试在没有 D3_TEST_MYSQL 时按原有设计跳过；全系统测试不代表该专项已通过。新增 D1 测试验证响应包装，M3 测试验证输入及角色检查，不代表完整业务覆盖。当前没有自动浏览器端到端测试和机器可执行的 OpenAPI 契约校验。

脚本在临时副本中生成随机测试凭据，排除原目录 `.env` 和依赖目录；不使用开发数据库。Compose 使用唯一项目名、临时数据卷和动态端口；退出时删除本次容器和数据卷。强制杀进程或执行机宕机可能无法执行清理，建议采用一次性构建执行机。不要设置指向生产数据库的环境变量。失败容器日志可能包含测试数据，应限制构建日志访问权限。

## CodeArts Build 设置

1. 将这些文件和七个包的 package-lock.json 一起提交到 CodeArts Repo。本目录已是 Git 仓库，请将本次修改提交到团队分支。
2. 新建或编辑编译构建任务，关联仓库和分支，确保构建使用流水线触发的提交版本。
3. 选择 Linux 执行环境：Bash、Node.js 22、npm、tar、Docker Engine、支持 `up --wait` 的 Compose v2 或更新版本。执行机需能访问 npm registry 和 Docker 镜像仓库，并允许本地监听端口。先用 `node -v`、`docker info`、`docker compose version` 检查。
4. 添加 Shell 构建步骤，粘贴上面的 `bash ... full` 命令。步骤错误必须使构建失败，不能配置忽略错误。建议任务超时设为 20 分钟，按实际网络和执行机性能调整。
5. 默认资源池是否支持 Docker daemon 以实际资源池为准；不支持时选择配置了上述环境的自定义构建执行机。仅安装 Docker 客户端不够。
6. 本脚本验证构建后会清理临时副本，不上传 dist 或发布镜像，也不部署应用。需要交付产物时另行增加受控归档步骤。

## Pipeline 自动触发

在流水线中添加 Build 构建任务并选择上述构建任务；打开“触发设置”，启用“代码提交时触发”，选择团队目标分支。可增加合并请求触发。先手动执行一次确认通过，再推送小改动验证触发和失败阻断。共享 CI 文件按项目 agents.md 交给相关负责人评审。

官方说明：
- [流水线触发设置](https://support.huaweicloud.com/usermanual-pipeline/pipeline_01_0017.html)
- [流水线官方插件（Build 构建）](https://support.huaweicloud.com/usermanual-pipeline/pipeline_01_0030.html)

尚未登录或修改云端项目：以上控制台配置需要在有权限的 CodeArts 项目内完成。

## node: command not found

此错误发生在安装依赖前，表示当前步骤的 PATH 中找不到 Node.js。普通 Shell 构建环境不保证包含 Node.js；之前直接使用 Shell 步骤的说明以执行机已安装 Node.js 为前提。

在 CodeArts Build 编辑构建步骤，使用「Npm 构建」，工具版本选择 Node.js 22 或更高版本。在该步骤内执行（不要切回另一个普通 Shell 步骤）：

```bash
set -e
node --version
npm --version
bash scripts/ci.sh unit
```

这用于先验证无需 Docker 的部分。完整门禁仍须使用 `full`：执行环境必须同时具备 Node.js >=22、npm、Docker Engine 和 Compose。若当前区域的 Npm 版本列表没有 >=22 的版本，或构建环境不能连接 Docker daemon，请使用安装了这些工具的自定义执行机。不要为了通过检查降到 Node.js 18/20，本项目部分服务要求 >=22。

云端构建环境无法通过修改仓库脚本自动切换；需要保存构建任务配置后重新运行。

参考：[Npm 构建](https://support.huaweicloud.com/usermanual-codeci/codeci_ug_0007.html)、[构建工具版本](https://support.huaweicloud.com/productdesc-codeci/cloudbuild_07_0004.html)。

## 生成部署源码包

在同一个 Npm 构建步骤中使用 `set -e`，先运行 `npm test`（完整门禁使用 `npm run test:all`），成功后运行 `npm run package`。脚本将当前工作目录中的前后端源码、Dockerfile、Compose、数据库初始化及迁移文件打成 `artifacts/lab1-*.tar.gz`，同时生成 `.sha256` 校验文件。排除 .env 及其本地变体、node_modules、日志、Git 元数据和测试产物；保留 .env.example。release.json 记录提交号及打包时间，包内容来自工作目录，不保证等同于已提交版本。

增加“上传软件包到软件发布库”构建步骤，配置路径 `artifacts/*`。部署任务选择本次构建产物下载，校验后解压，单独配置主机 .env，再执行 Compose 构建。它是需要在服务器构建镜像的源码包，不是 Docker 镜像包或已适配公网的生产发行包。现有前端仍为 Vite 开发服务器，正式上线需调整 Nginx 与访问入口。
