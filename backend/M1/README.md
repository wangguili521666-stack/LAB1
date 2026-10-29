# M1 后端

通过根目录 ./start.sh 启动，使用本模块独立 MySQL 数据库。API 及状态规则见 ../../docs/api/m1.md，服务认证和恢复机制见 ../../docs/architecture/service-auth.md。

本地启动需配置 DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD、D1_BASE_URL、D2_BASE_URL、D3_BASE_URL、D2_SERVICE_TOKEN、D3_SERVICE_TOKEN、PORT；M1 另需 CHECKIN_SECRET（至少 32 字符）。先 npm ci、npm run migrate，再 npm start。

真实集成验收：根目录 scripts/integration.mjs；签到和定时任务验收由隔离本地运行器执行。当前提醒为站内消息。
