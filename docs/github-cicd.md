# GitHub Actions交付

交付分支main，环境staging和production。主机地址、SSH部署私钥和主机指纹分别保存为各环境的DEPLOY_HOST、DEPLOY_KEY、DEPLOY_KNOWN_HOSTS，不写入仓库。

## 流程

任意push和pull_request运行quality：发布脚本行为测试、需求基线、变异验证、完整独立MySQL集成与前端构建。失败阻断后续bundle和staging。

main通过后构建六后端与Nginx静态前端镜像，连同数据库镜像、Compose及初始化脚本形成一个发布包。版本为完整Git SHA、Actions run ID和attempt的组合。只允许干净已提交版本打包。staging自动下载同一run的包，校验SHA256后部署所有模块，迁移、种子、全服务健康检查均自动执行。

Production工作流手动选deploy并输入成功CI的run_id；环境要求负责人批准；按负责人明确批准，允许发起人手动审批。只接受main上的成功CI（含测试部署成功）制品，生产不重新构建。选rollback并填rollback_version可退回主机保留的版本，同样经过环境审批。应用回滚保留当前发布器，避免恢复旧版启动逻辑；只有正常部署才更新发布器。只有Schema指纹相同的版本允许自动回滚；不降级或清空业务库。

## 合并与审批

main配置quality必需状态检查、与最新分支同步、至少1次批准、CODEOWNERS评审、过期批准失效、会话解决、管理员同样遵守、禁force push和删除。全仓库由@wangguili521666-stack和@Timing04作为CODEOWNERS评审，覆盖跨模块、公共层和Schema。

作者不能批准自己的PR；自己的变更需要另一位有写权限的组员评审。生产仍须人工审批；负责人已明确选择允许自己发起后手动审批，管理员不能绕过审批。仓库仅有一名成员时无法完成独立评审，不应通过关闭门禁冒充完成。

服务端保护与环境审批必须实际配置，YAML文件本身不能开启这些规则。实际验收状态见github-cicd-validation.md。

## 操作

开发：分支 → PR → quality通过 → 负责人评审 → 合并main → 自动部署staging。

生产：Actions → Production → Run workflow → deploy与成功CI编号 → 负责人审批production。

回滚：同一入口选rollback与完整已保留版本号。跨Schema回滚拒绝，需要经评审的前向兼容修复。

运行版本：访问应用的/version.json；服务器运行`bash /opt/lab1/server-release.sh status`同时检查成功版本记录和实际容器。成功发布和回滚记录写入deployments.jsonl。current指针只在全服务健康后更新；失败可能存在部分新容器，不能将旧指针理解为已自动恢复所有旧容器。

服务器仅运行已构建镜像；MySQL不映射公网端口。运行密钥首次随机生成，后续保留共享.env，不随部署重置。旧镜像和版本保留以支持回滚，需定期安排磁盘保留策略。制品默认保留30天。当前应用回滚不等于数据库备份恢复。公开真实用户环境还应配置域名、TLS及容量监控。

## 验证

`python3 scripts/release_test.py`验证缺少版本、非法目标、Schema不兼容、健康失败不更新指针、兼容回滚更新版本与日志、回滚保留当前发布器。Docker为受控外部边界，实际发布脚本真实执行；真实容器另经CI和主机健康检查。

参考：[GitHub分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[环境审批](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。

## 逐步操作：生产发布

1. 打开仓库 **Actions → CI**，找到 main 分支的运行，确认 quality、bundle、staging 都成功。PR 上 bundle/staging 显示 skipped 是分支条件所致，PR 的运行编号不能作为生产制品来源。
2. 记录成功 CI 页面 URL 中 `/actions/runs/` 后的数字，即 `run_id`；不要填提交 SHA 或 job 编号。例如首版来源是 `41951589128`，仅作历史示例，日常应选择实际待发布的成功运行。
3. 打开 **Actions → Production → Run workflow**，分支选 `main`，`action` 选 `deploy`，填入 `run_id`，`rollback_version` 留空。
4. 进入新运行页面，等待 **Review deployments**，选中 `production`，核对版本后点击 **Approve and deploy**。这是生产部署审批，与 PR 的代码评审是两个独立步骤。
5. 等待 release 成功，打开目标站点 `/version.json`，确认 `revision` 与选择的提交一致，`run` 对应 CI 来源；依次检查 `/api/d1/health`、`/api/d2/health`、`/api/d3/health`、`/api/m1/health`、`/api/m2/health`、`/api/m3/health`，均应为 200。

制品超过保存期或已删除时不能继续按旧 run_id 下载；重新运行 main CI、完成测试部署并重新审批，不临时绕过制品校验。

## 逐步操作：回滚

先由有权限的运维人员查看 `/opt/lab1/deployments.jsonl` 和 `/opt/lab1/releases/`，选定此前成功、仍完整保留且 Schema 指纹相同的版本。完整版本号形如 `完整40位SHA-CI运行编号-尝试次数`，不是八位提交简称。

在 **Production → Run workflow** 中选 `main`、`action=rollback`，填 `rollback_version`，`run_id` 留空，再人工批准 production。成功后重新检查版本和六模块健康接口。Schema 不同会拒绝操作，应提交兼容的前向修复；不能通过修改指纹或删除迁移记录绕过。

当前生产只有首个成功版本，尚不能完成生产旧版回滚验收。PR #3 的发布器保留修复须先合并并经批准发布；具体状态见[验收记录](github-cicd-validation.md)。测试机演练通过不等于生产已应用候选修复。

## 服务器目录与排障

| 位置 | 用途 |
| --- | --- |
| `/opt/lab1/releases/<完整版本>/` | 本版镜像包、Compose、版本信息和脚本 |
| `/opt/lab1/shared/.env` | 保留的运行配置与秘密，不能提交或贴入日志 |
| `/opt/lab1/current`、`previous` | 成功版本指针；不能单独证明所有正在运行的容器版本 |
| `/opt/lab1/deployments.jsonl` | 成功部署、回滚及时间记录 |
| `/opt/lab1/server-release.sh` | 运维状态查询及发布器 |

在目标服务器上只读检查：

```bash
bash /opt/lab1/server-release.sh status
docker ps --format '{{.Names}} {{.Status}}'
docker logs --tail=100 lab1-d1-1
curl -fsS http://localhost/version.json
```

若新发布健康检查失败，先看 Actions 失败步骤及对应服务日志。current 不前移不代表容器已自动回滚；需要判断 Schema 与实际服务状态后选择批准的回滚或前向修复。切勿清空业务卷来“修复”发布。数据库迁移中断按[数据库演进规则](database-evolution.md)处理。

## 配置维护与部署隔离

仓库 Settings 中实际维护 main 分支保护、CODEOWNERS 写权限，以及 staging/production 环境的 Secrets 和生产 Required reviewers。三个环境 Secrets 分别是 DEPLOY_HOST、DEPLOY_KEY、DEPLOY_KNOWN_HOSTS；服务器重装后须核实新主机指纹并恢复对应公钥。工作流文件不会自动创建这些 GitHub 设置，也不会自动安装全新服务器的 Docker/Compose。

Actions 按环境串行部署，服务器再用 flock 防止并发发布。正式集成测试另外使用独立环境，避免其他模块部署导致误报；共享环境手工联调仍须约定暂停部署的窗口。这些机制不会让服务升级全程无中断。
