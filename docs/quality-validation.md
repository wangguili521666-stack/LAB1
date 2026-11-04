# 工程质量要求验收记录（2026-11-04）

## 本轮修改

1. 登记107条需求，原有90条编号验收项以及17条补充要求全部保留；每项有验收、实现入口、验证入口、方法、责任模块、状态和缺口。增加不可静默删除的历史编号清单及CI完整性门禁。
2. 增加6项基线检查器正反例，验证删需求、缺标准、漏登记、无效引用、无证据完成与标准不同步能被发现。
3. 增加5项真实实现定向变异，原版通过后在临时副本修改实现，必须出现行为断言失败；不以语法错误或环境异常充数。没有修改业务实现。
4. 增加基础设施统一入口 infra:up/status/stop；复用现有Docker健康检查、自动配置、迁移和种子流程；部署包加入docs，确保质量脚本随包可用。
5. unit/full CI均接入基线检查、检查器测试和行为变异实验。业务API和表结构未改变。

## 实际结果

- npm run requirements:check：107条通过完整性检查。
- node --test scripts/requirements-check.test.mjs：6项通过。
- npm run test:mutation：5/5变异被断言捕获，0存活；细节见 test-results/mutation-Rt6tNN/，MUT-PAYLOAD 实际破坏成功响应码。
- npm run test:all：退出码0；日志 test-results/run-full.Bhk9B6Ca/output.log，状态 test-results/run-full.Bhk9B6Ca/status.txt。
- 完整CI中新增门禁通过；前端构建、六模块空库初始化、两轮重放成功；M2数据库测试10项、D2数据库测试29项、跨模块58项HTTP断言通过；临时容器、卷和专属镜像已清理。
- npm run package：成功；检查压缩包包含docs/requirements/traceability.json、质量脚本、基础设施入口、Compose及.env.example，不含真实.env。
- bash -n与git diff --check通过。

## 保留的限制

五项变异是定向样本，不代表全部业务测试都有完整变异覆盖。D3原测试中13项可选MySQL专项仍跳过，不算通过。多数业务需求未在本轮逐条核对每个验收分支，因此保守标记pending_acceptance；关联文件是实现/验证核查入口，不冒充完整自动覆盖。

邮件/微信实际发送、M2审计持久化重试、生产审批发布与回滚演练保留为deferred。未完成内容没有删除；应在后续实现后补充验收证据并更新状态。基线文件的恶意同步删改仍依靠Git评审；仓库必需CI检查需要托管平台配置。
