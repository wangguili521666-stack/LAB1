# 自动测试入口

环境：Bash、Node.js >=22、npm、tar。入口会在临时副本中用 npm ci 安装各模块依赖，无需先在根目录 npm install；运行时需能访问依赖源。

```bash
# 在仓库根目录执行：无需 Docker 的自动测试、源码语法检查和前端构建
npm test

# 完整检查：额外启动临时 MySQL、六个后端与前端，运行数据库及跨模块测试
npm run test:all
```

也可直接执行 `bash scripts/test.sh unit` 或 `bash scripts/test.sh full`，支持从任意工作目录用脚本绝对路径调用。

## 覆盖范围

| 范围 | 快速检查 unit | 完整检查 full |
| --- | --- | --- |
| 七个包锁文件安装、JS 语法检查、Vue 构建 | 是 | 是 |
| 前端已有测试、D1 响应包装、M3 输入与角色校验 | 是 | 是 |
| D2 单元测试、M1 签到码、D3 默认测试 | 是 | 是 |
| Compose 镜像构建、空库迁移、服务健康检查 | 否 | 是 |
| M2 独立数据库测试、D2 数据库集成测试 | 否 | 是 |
| scripts/integration.mjs 跨模块业务测试 | 否 | 是 |

默认 D3 测试中部分用例有条件跳过，详见输出；成功不代表所有业务均已覆盖。没有自动浏览器端到端测试。完整模式需要同一执行环境可访问 Docker Engine、Compose，以及映射到本机的临时服务端口；远程 Docker daemon 不适用当前 localhost 访问方式。

## 结果与失败阻断

每次运行写入 `test-results/run-<模式>.<随机编号>/output.log` 和 `status.txt`，并实时显示日志。任一安装、检查、构建或测试命令失败，入口返回非零退出码。报告目录已加入 .gitignore；CodeArts 可按 `test-results/**` 归档日志。这些是纯文本日志，不是 JUnit XML。

## CodeArts 命令

选择 Node.js 22 的 Npm 构建步骤，删除旧模板里的 disturl 等不兼容 npm config 命令，替换为：

```bash
set -e
npm config set registry https://repo.huaweicloud.com/repository/npm/
npm test
```

支持 Docker 的执行机应将最后一行替换为 `npm run test:all` 作为完整门禁。关闭失败后继续；还需要在仓库设置必需构建检查，才能禁止失败时合并。脚本本身不配置仓库的合并权限。
