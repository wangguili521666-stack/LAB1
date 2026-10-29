D1:
1. users 用户表
字段	类型	说明
id	BIGINT PK	用户 ID
username	VARCHAR(50) UNIQUE	登录用户名
password_hash	VARCHAR(255)	密码哈希
nickname	VARCHAR(50)	昵称
email	VARCHAR(100)	邮箱
phone	VARCHAR(20)	手机号
college_id	BIGINT FK	所属学院
status	VARCHAR(20)	ACTIVE / DISABLED
created_at	DATETIME	注册时间
updated_at	DATETIME	更新时间

2. roles 角色表
字段	类型	说明
id	BIGINT PK	角色 ID
role_code	VARCHAR(50) UNIQUE	角色标识
role_name	VARCHAR(50)	角色名称
description	VARCHAR(255)	描述

3. user_roles 用户角色关联表
字段	类型	说明
user_id	BIGINT FK	用户 ID
role_id	BIGINT FK	角色 ID
assigned_at	DATETIME	授权时间

4. permissions 权限表
字段	类型	说明
id	BIGINT PK	权限 ID
permission_code	VARCHAR(100) UNIQUE	权限编码
description	VARCHAR(255)	权限说明

5. role_permissions 角色权限关联表
字段	类型	说明
id_role	BIGINT PK	角色 ID
id_permissions	BIGINT PK	权限 ID

6. colleges 学院表
字段	类型	说明
id	BIGINT PK	学院 ID
name	VARCHAR(100) UNIQUE	学院名称

D2：
1. classrooms 教室表
字段	类型	说明
id	BIGINT PK	教室 ID
building	VARCHAR(100)	教学楼
room_number	VARCHAR(30)	房间号
college_id	BIGINT	所属学院，可空；2026-10-28 确认为 D1 逻辑引用，经公开 API 校验，不建立跨库外键
capacity	INT	容量
equipment	JSON	设备信息
status	VARCHAR(20)	AVAILABLE / MAINTENANCE / DISABLED
is_bookable_whole	BOOLEAN	是否允许整教室预约
open_time	TIME	每日开放时间
close_time	TIME	每日关闭时间
created_at	DATETIME	创建时间


2. seats 座位表
字段	类型	说明
id	BIGINT PK	座位 ID
classroom_id	BIGINT FK	所属教室
seat_number	VARCHAR(20)	座位编号
socket_type	VARCHAR(20)	NONE / FIXED / RAIL
status	VARCHAR(20)	AVAILABLE / MAINTENANCE / DISABLED
created_at	DATETIME	创建时间


3. resource_reservations 统一资源占用表
这是 M1 与 M2 共享的关键表。
字段	类型	说明
id	BIGINT PK	资源占用 ID
resource_type	VARCHAR(20)	SEAT / CLASSROOM
resource_id	BIGINT	座位或教室 ID
classroom_id	BIGINT FK	对应教室 ID
source_module	VARCHAR(10)	M1 / M2
source_id	BIGINT	来源业务记录 ID
start_time	DATETIME(3)	占用开始时间，UTC
end_time	DATETIME(3)	占用结束时间，UTC
status	VARCHAR(20)	HELD / CONFIRMED / RELEASED
hold_expires_at	DATETIME(3)	预占有效期，UTC；API 创建 HELD 时必有有效截止，确认/释放后保留原值用于幂等追踪
created_at	DATETIME	创建时间

resource_reservations 约束：唯一 (source_module, source_id)；M1 仅 SEAT，M2 仅 CLASSROOM；时间区间左闭右开，start_time < end_time。classroom_id 指向 D2 自有 classrooms，resource_id 的多态关联由事务内资源校验保证。并发冲突由同一教室行锁保护，普通唯一索引不替代区间互斥。

4. maintenance_blocks 维修来源表（2026-10-28 用户批准）
字段	类型	说明
ticket_id	BIGINT PK	M3 工单逻辑引用，不跨库外键
classroom_id	BIGINT FK	首次同步后固定关联 D2 教室
active	BOOLEAN	该工单是否仍阻塞新预约
revision	INT	M3 单工单单调递增正整数版本，重复/乱序处理见 docs/api/d2.md
updated_at	DATETIME(3)	最后一次接受新版本的 UTC 时间

5. operation_log_outbox 审计投递表（第一阶段已获用户批准）
字段	类型	说明
id	BIGINT PK	投递记录 ID
payload	JSON	D3 OperationLogCreate 载荷，不含秘密或请求正文
status	VARCHAR(20)	PENDING / SENT
attempts	INT	发送尝试次数
next_attempt_at	DATETIME	下次可重试 UTC 时间
last_error_code	VARCHAR(50) NULL	不含秘密的错误标识
created_at	DATETIME	创建 UTC 时间
sent_at	DATETIME NULL	成功投递 UTC 时间

D3：公告与操作日志模块
1. announcements 公告表
字段	类型	说明
id	BIGINT PK	公告 ID
title	VARCHAR(200)	标题
content	TEXT	公告内容
type	VARCHAR(30)	公告类型 NOTICE / MAINTENANCE / EMERGENCY
publisher_id	BIGINT	发布人（D1 逻辑引用，草稿时为创建人，发布时更新）
status	VARCHAR(20)	DRAFT / PUBLISHED / WITHDRAWN
published_at	DATETIME	发布时间
expires_at	DATETIME	过期时间
created_at	DATETIME	创建时间
updated_at	DATETIME	修改时间

首版 announcements 增补：created_by BIGINT、updated_by BIGINT、withdrawn_at DATETIME(3) NULL、version INT DEFAULT 1。修改、发布、撤回通过 version 防止并发覆盖，并与操作审计一起提交。


2. operation_logs 操作日志表
字段	类型	说明
id	BIGINT PK	日志 ID
user_id	BIGINT NULL	操作用户
module	VARCHAR(20)	M1 / M2 / M3 / D1 / D2 / D3
action	VARCHAR(100)	操作类型
target_type	VARCHAR(50)	操作对象类型
target_id	BIGINT NULL	操作对象 ID
request_method	VARCHAR(10)	GET / POST 等
request_path	VARCHAR(255)	API 路径
result	VARCHAR(20)	SUCCESS / FAILURE / DENIED
ip_address	VARCHAR(45)	客户端 IP
created_at	DATETIME	D3 接收记录时间

首版 operation_logs 增补：source_event_id VARCHAR(128) NULL、actor_type VARCHAR(16)、occurred_at DATETIME(3)、trace_id VARCHAR(64) NULL、reason VARCHAR(1000) NULL、payload_hash CHAR(64)。UNIQUE(module, source_event_id) 支持重试去重；兼容旧调用省略事件 ID 时每次都追加。module 从调用服务凭据确定，user_id 由可信来源服务声明，D3 不声称独立验证上游的用户操作。日志无修改/删除 API。

3. d3_notifications 通知事件快照
字段：id BIGINT PK、source_module VARCHAR(16)、source_event_id VARCHAR(128)、notification_type VARCHAR(64)、biz_type VARCHAR(64)、biz_id VARCHAR(64)、title VARCHAR(200)、content TEXT、trace_id VARCHAR(64) NULL、payload_hash CHAR(64)、occurred_at/created_at DATETIME(3)、expires_at/invalidated_at DATETIME(3) NULL。
UNIQUE(source_module, source_event_id, notification_type)；业务查询索引 (source_module, biz_type, biz_id, created_at, id)。幂等校验包含接收人集合和通知内容，trace_id 不影响幂等。

4. d3_notification_recipients 用户消息与已读状态
字段：id BIGINT PK（API 的消息 ID）、notification_id BIGINT FK（只关联 D3 内部通知表）、recipient_user_id BIGINT、created_at DATETIME(3)、read_at DATETIME(3) NULL。
UNIQUE(notification_id, recipient_user_id)；用户时间与用户未读索引。read_at 只在第一次标记时写入，独立于通知是否过期/失效。

后续外部渠道的投递任务表尚未创建；此前五表草案中的投递租约、重试和回执仍属于下一阶段设计，不代表首版已经实现。

2026-10-28 本地开发环境：新增初始化入口创建 campus_d3_local 逻辑库和 d3_local_app 专用账号，使用相同的 001_d3_core.sql 迁移，不改变业务表结构。连接信息独立保存在 Git 忽略的 backend/D3/.env.local。团队环境仍通过 .env 配置目标库，不在业务代码中写死库名；本地假身份仅用于本机开发入口。




M1
1. seat_bookings 座位预约表
字段	类型	说明
id	BIGINT PK	预约 ID
user_id	BIGINT FK	预约学生
seat_id	BIGINT FK	座位 ID
reservation_id	BIGINT	D2 资源占用 ID
start_time	DATETIME	开始时间
end_time	DATETIME	结束时间
status	VARCHAR(20)	BOOKED / CHECKED_IN / CANCELLED / NO_SHOW / COMPLETED
created_at	DATETIME	预约创建时间
cancelled_at	DATETIME	取消时间

2. seat_checkins 签到记录表
字段	类型	说明
id	BIGINT PK	签到 ID
booking_id	BIGINT FK UNIQUE	对应预约
checkin_method	VARCHAR(20)	CODE / QR
checkin_time	DATETIME	签到时间

3. booking_violations 违约记录表
字段	类型	说明
id	BIGINT PK	违约 ID
user_id	BIGINT FK	违约用户
booking_id	BIGINT FK UNIQUE	对应预约
violation_type	VARCHAR(30)	NO_SHOW
occurred_at	DATETIME	违约时间

4. booking_settings 预约配置表
字段	类型	说明
setting_key	VARCHAR(50) PK	配置名称
setting_value	VARCHAR(255)	配置值
updated_at	DATETIME	更新时间

M2:
1. classroom_applications 教室申请表
字段	类型	说明
id	BIGINT PK	申请 ID
applicant_id	BIGINT FK	申请人
classroom_id	BIGINT FK	申请教室
reservation_id	BIGINT	D2 预占记录 ID
purpose	VARCHAR(255)	申请用途
start_time	DATETIME	开始时间
end_time	DATETIME	结束时间
status	VARCHAR(30)	PENDING_L1 / PENDING_L2 / APPROVED / REJECTED / CANCELLED
approval_deadline	DATETIME	审批截止时间
created_at	DATETIME	提交时间
updated_at	DATETIME	更新时间

2. application_approvals 审批记录表
字段	类型	说明
id	BIGINT PK	审批 ID
application_id	BIGINT FK	教室申请 ID
approval_level	TINYINT	审批级别 1 / 2
approver_id	BIGINT FK	审批人
decision	VARCHAR(20)	APPROVED / REJECTED
comment	TEXT	审批意见或驳回理由
decided_at	DATETIME	审批时间


M3：物业报修工单模块
1. repair_types 故障类型表
字段	类型	说明
id	BIGINT PK	故障类型 ID
type_name	VARCHAR(50)	电力 / 网络 / 桌椅等
default_priority	TINYINT	默认优先级
sla_hours	INT	维修时限

2. repair_tickets 报修工单表
字段	类型	说明
id	BIGINT PK	工单 ID
ticket_number	VARCHAR(50) UNIQUE	唯一工单号
reporter_id	BIGINT FK	报修用户
repair_type_id	BIGINT FK	故障类型
classroom_id	BIGINT FK NULL	故障教室，可空
location_description	VARCHAR(255)	故障位置
description	TEXT	故障描述
priority	TINYINT	当前优先级
status	VARCHAR(30)	工单状态 PENDING_ASSIGNMENT / ASSIGNED / IN_PROGRESS / PENDING_ACCEPTANCE / COMPLETED / CANCELLED
assigned_to	BIGINT FK NULL	维修人员
assigned_at	DATETIME	派单时间
deadline_at	DATETIME	维修截止时间
escalation_count	INT	升级次数
completed_at	DATETIME	完工时间
accepted_at	DATETIME	验收时间
created_at	DATETIME	报修时间


3. repair_progress 维修进度表
字段	类型	说明
id	BIGINT PK	进度 ID
ticket_id	BIGINT FK	工单 ID
operator_id	BIGINT FK	操作用户
action_type	VARCHAR(30)	ASSIGN / START / UPDATE / FINISH / REWORK / ESCALATE
old_status	VARCHAR(30)	变更前状态
new_status	VARCHAR(30)	变更后状态
description	TEXT	操作说明
created_at	DATETIME	操作时间


4. repair_reviews 维修评价表
字段	类型	说明
id	BIGINT PK	评价 ID
ticket_id	BIGINT FK UNIQUE	工单 ID
reviewer_id	BIGINT FK	评价用户
rating	TINYINT	评分 1–5
comment	TEXT	评价内容
created_at	DATETIME	评价时间
