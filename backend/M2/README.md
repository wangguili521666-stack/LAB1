# M2 服务（整教室申请 / 两级审批 / 超时拒绝）

老师或系统管理员查询可整间预约的教室并提交申请。自习室管理员做一级审批，系统管理员做二级审批。驳回、申请人撤销和审批超时都会释放 D2 预占。

权限由 D1 `POST /api/d1/internal/authorize` 判定，资源占用由 D2 判定。M2 只连接 `campus_m2`。

## 权限码

| 权限码 | 使用者 |
|---|---|
| `classroom:apply` | 申请整教室。教室有所属学院时会带上 `resource_college_id` |
| `classroom:approve_l1` | 一级审批，自习室管理员 |
| `classroom:approve_l2` | 二级审批，系统管理员 |

没有所属学院的教室不传 `resource_college_id`。服务间调用在配置了 `INTERNAL_SERVICE_TOKEN` 时携带请求头 `X-Service-Token`。

## 审批时限

默认 24 小时，环境变量 `M2_APPROVAL_TIMEOUT_HOURS` 可改。进程内定时任务把截止后仍待审批的申请改为 `REJECTED`，并通知 D2 释放。D3 写日志失败只记录错误，不回滚申请。

## 本地运行

先在仓库根目录启动 MySQL，并保证 `.env` 里有 `M2_DB_PASSWORD`。

```bash
cp .env.example .env
npm install
npm run migrate
npm run dev
```

`JWT_SECRET` 必须与 D1 的签名密钥相同。测试会清空 `campus_m2` 里的申请表，并需要本机 MySQL：

```bash
npm test
```
