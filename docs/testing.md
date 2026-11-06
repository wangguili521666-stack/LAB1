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

## Docker 镜像复用与清理

完整测试优先使用本机已有基础镜像，并启用 BuildKit 构建缓存；源码或依赖变化仍会重建对应层，避免使用过期代码。启动阶段使用 --no-build，避免再次构建。

每轮为七个应用镜像使用独立标签；退出时先删除该轮容器与测试卷，再删除该轮镜像标签。即使镜像构建中途失败，也会清理已经生成的标签。基础镜像（Node、MySQL）、其他项目镜像和 BuildKit 缓存保留，下一轮可继续复用缓存。共享镜像层不会按标签数量重复占用全部空间。

清理不调用全局 prune，不强制删除正在使用的镜像。清理失败会报告并令任务失败。强制终止进程（SIGKILL）、Docker 停机或执行机宕机仍可能留下资源。修改仅影响新运行，历史遗留环境不会自动删除。缓存复用限于使用同一个 Docker builder 的环境；每次全新云端执行机需另配远程缓存。

## 2026-11-04 新增质量门禁

unit/full均执行107条需求基线完整性检查、6项检查器测试及5项真实实现变异验证。使用及限制见 [质量基线](quality-baseline.md)，本轮结果见 [验收记录](quality-validation.md)。

## D3完整数据库专项

完整模式在本轮临时MySQL实例创建d3_isolated_test及最小范围账号d3_test，以D3_TEST_MYSQL配置串行运行全部D3测试；37项应全通过且零跳过。前面的快速阶段仍可看到13项条件跳过，不能只看快速阶段作最终结论。具体本轮证据见 [验收闭环记录](acceptance-closure-progress.md)。
