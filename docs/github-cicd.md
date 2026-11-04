# GitHub Actions交付

交付分支main，环境staging和production。主机地址、SSH部署私钥和主机指纹分别保存为各环境的DEPLOY_HOST、DEPLOY_KEY、DEPLOY_KNOWN_HOSTS，不写入仓库。

## 流程

任意push和pull_request运行quality：发布脚本行为测试、需求基线、变异验证、完整独立MySQL集成与前端构建。失败阻断后续bundle和staging。

main通过后构建六后端与Nginx静态前端镜像，连同数据库镜像、Compose及初始化脚本形成一个发布包。版本为完整Git SHA、Actions run ID和attempt的组合。只允许干净已提交版本打包。staging自动下载同一run的包，校验SHA256后部署所有模块，迁移、种子、全服务健康检查均自动执行。

Production工作流手动选deploy并输入成功CI的run_id；环境要求负责人批准且禁止自审。只接受main上的成功CI（含测试部署成功）制品，生产不重新构建。选rollback并填rollback_version可退回主机保留的版本，同样经过环境审批。只有Schema指纹相同的版本允许自动回滚；不降级或清空业务库。

## 合并与审批

main配置quality必需状态检查、与最新分支同步、至少1次批准、CODEOWNERS评审、过期批准失效、会话解决、管理员同样遵守、禁force push和删除。全仓库由@wangguili521666-stack评审，覆盖跨模块、公共层和Schema。

作者不能批准自己的PR；自己的变更需要另一位有写权限的组员评审。生产发起人不能自审；负责人若负责批准，应由另一位组员发起。仓库仅有一名成员时无法完成独立评审，不应通过关闭门禁冒充完成。

服务端保护与环境审批必须实际配置，YAML文件本身不能开启这些规则。实际验收状态见github-cicd-validation.md。

## 操作

开发：分支 → PR → quality通过 → 负责人评审 → 合并main → 自动部署staging。

生产：Actions → Production → Run workflow → deploy与成功CI编号 → 负责人审批production。

回滚：同一入口选rollback与完整已保留版本号。跨Schema回滚拒绝，需要经评审的前向兼容修复。

运行版本：访问应用的/version.json；服务器运行`bash /opt/lab1/server-release.sh status`同时检查成功版本记录和实际容器。成功发布和回滚记录写入deployments.jsonl。current指针只在全服务健康后更新；失败可能存在部分新容器，不能将旧指针理解为已自动恢复所有旧容器。

服务器仅运行已构建镜像；MySQL不映射公网端口。运行密钥首次随机生成，后续保留共享.env，不随部署重置。旧镜像和版本保留以支持回滚，需定期安排磁盘保留策略。制品默认保留30天。当前应用回滚不等于数据库备份恢复。公开真实用户环境还应配置域名、TLS及容量监控。

## 验证

`python3 scripts/release_test.py`验证缺少版本、非法目标、Schema不兼容、健康失败不更新指针、兼容回滚更新版本与日志。Docker为受控外部边界，实际发布脚本真实执行；真实容器另经CI和主机健康检查。

参考：[GitHub分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[环境审批](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。
