2.1 请求与响应规范
- 请求体：application/json
- 用户认证：Authorization: Bearer <token>
- ID：数据库使用 BIGINT，API 中建议使用十进制字符串，避免 JavaScript 大整数精度问题。
- 时间：统一使用带时区的 ISO 8601 字符串，例如 2026-10-23T09:00:00+08:00；数据库 DATETIME 使用同一约定时区存储。
- 时间区间：[start_time, end_time)，左闭右开，相邻时段不冲突。
- 分页：page 从 1 开始，page_size 默认 20，最大 100。
- 可选参数：表中标记 ? 的字段允许不传；null 和缺省要按接口说明区分。
- 普通用户的身份通过 JWT 确定，不允许通过提交 user_id 冒充其他用户。
成功响应：
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "101"
  },
  "request_id": "req-001"
}


失败响应：
{
  "code": "RESOURCE_CONFLICT",
  "message": "该资源在指定时间段已被占用",
  "data": null,
  "request_id": "req-002"
}


分页响应的 data 统一为：
{
  "items": [],
  "page": 1,
  "page_size": 20,
  "total": 0
}


2.2 HTTP 状态码
HTTP	含义
200	查询、修改成功
201	创建成功
400	参数格式错误
401	未登录、Token 无效
403	权限不足
404	资源不存在
409	时间冲突、重复操作、非法状态转换
422	业务规则不满足
500	服务内部错误
503	依赖模块不可用
业务错误码建议统一为 VALIDATION_ERROR、UNAUTHORIZED、FORBIDDEN、NOT_FOUND、RESOURCE_CONFLICT、INVALID_STATE、DUPLICATE_OPERATION、DEPENDENCY_UNAVAILABLE。
2.3 Schema 字段表示约定
后文使用简写：
标记	JSON / 数据库类型
string	VARCHAR / TEXT
id	BIGINT 的字符串表示
integer	INT / TINYINT
boolean	BOOLEAN
datetime	DATETIME 的 API 字符串表示
object	JSON 对象
array<T>	T 类型数组
?	可选字段
所有接口默认使用上述统一响应包装。下面的“返回”只描述 data 内部的具体结构，不重复书写 code、message 和 request_id。

九、六模块跨模块调用契约
这部分建议作为组内联调的重点。
调用方	被调用方	接口	使用场景
M1	D2	POST /api/d2/availability/search	搜索空闲座位
M1	D2	POST /api/d2/reservations	创建座位预占
M1	D2	POST /api/d2/reservations/{id}/confirm	确认座位占用
M1	D2	POST /api/d2/reservations/{id}/release	取消预约、违约释放
M2	D1	POST /api/d1/internal/authorize	检查申请、审批权限
M2	D2	POST /api/d2/availability/search	查询可申请教室
M2	D2	POST /api/d2/reservations	申请时预占教室
M2	D2	POST /api/d2/reservations/{id}/confirm	二级审批通过
M2	D2	POST /api/d2/reservations/{id}/release	驳回、撤销、超时
M3	D2	POST /api/d2/internal/maintenance/sync	维修下架、验收恢复
D1	M1	GET /api/m1/bookings/me	聚合个人座位记录
D1	M2	GET /api/m2/applications/me	聚合个人教室申请
D1	M3	GET /api/m3/tickets/me	聚合个人报修
M1/M2/M3/D1/D2	D3	POST /api/d3/internal/logs	记录重要操作
对于 D1 的个人记录聚合，/me 接口在服务间调用时不能简单地把 D1 的服务 Token 当作用户 Token。建议保留经过校验的用户身份上下文，或者补充仅供可信服务调用的按用户 ID 查询接口。
另外，课程要求的提醒服务尚未分配模块。建议由 D3 所在成员额外实现公共通知接口，例如：
POST /api/d3/internal/notifications
请求可统一包含 user_id, channel, template_code, payload，但这属于需要扩展的契约，目前 D3 数据库中没有通知记录表。也可以由 M1 自行完成提醒，不必强行修改 D3 的职责。
