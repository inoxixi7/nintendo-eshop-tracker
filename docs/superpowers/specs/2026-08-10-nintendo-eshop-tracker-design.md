# Nintendo eShop Tracker 设计文档

日期：2026-08-10

## 1. 目标

构建一个个人优先、未来可以公开发布的 Nintendo eShop 数据服务与 PWA。第一版支持日本（JP）、美国（US）和英国（GB），提供游戏基本信息、当前价格、折扣信息、折扣起止时间、价格历史和历史最低价。

系统使用现有 `nintendo-switch-eshop` v8.0.1 代码作为数据源适配参考，但重新划分采集、存储、API 和客户端职责。项目保留上游 Apache-2.0 License、版权声明和来源说明。

## 2. 第一版范围

### 包含

- JP、US、GB 游戏目录采集。
- 名称、封面或缩略图、发行商、开发商、发行日期和地区商品标识。
- 当前原价、折扣价、币种、折扣比例、折扣开始与结束时间。
- 定时采集与追加式价格历史。
- 历史最低价和最近价格变化。
- 游戏搜索、分页、地区筛选和折扣列表。
- 响应式 Web 页面及可安装 PWA。
- 浏览器本地收藏。
- VPS Docker Compose 部署、HTTPS、健康检查和数据库备份。

### 不包含

- 用户注册、登录、跨设备收藏同步。
- 降价推送通知。
- 微信小程序或原生 iOS/Android 客户端。
- JP、US、GB 之外的地区。
- 自动货币换算。
- 无可靠依据的跨区游戏强制匹配。
- 绕过任天堂认证、验证码或访问控制。

## 3. 技术方案选择

采用前后端分离的 TypeScript 单仓库。相比全栈框架单体，它能明确区分页面、公共 API 和后台采集任务；相比微服务，它不引入独立发布、消息队列和分布式运维成本。

推荐技术栈：

- Web：Vue 3、TypeScript、Vite、PWA 插件。
- API：Node.js、TypeScript、Fastify。
- Worker：Node.js、TypeScript，与 API 共用地区适配器和数据库访问层。
- 数据库：PostgreSQL。
- 运行：Docker Compose。
- 入口与 HTTPS：Caddy。
- 包管理：pnpm workspace。

## 4. 项目结构

```text
nintendo-eshop-tracker/
├── apps/
│   ├── web/                 # PWA 页面，只调用公共 API
│   ├── api/                 # 查询 API，不直接批量抓取上游
│   └── worker/              # 定时目录与价格同步
├── packages/
│   ├── eshop/               # JP、US、GB 上游适配器
│   ├── database/            # 数据模型、迁移和仓储层
│   └── shared/              # API DTO、校验 schema 和公共类型
├── deploy/
│   ├── Caddyfile
│   └── backup/              # 数据库备份脚本与恢复说明
├── docs/
├── docker-compose.yml
├── .env.example
├── LICENSE
└── README.md
```

## 5. 组件边界

### `packages/eshop`

每个地区适配器只负责调用一个上游数据源并返回统一的规范化结果。它不知道数据库、HTTP 请求或页面结构。

统一输出分为：

- `CatalogItem`：地区商品身份和基本信息。
- `PriceObservation`：某地区商品在采集时刻的价格状态。

上游原始响应不直接暴露给 App。适配器保留必要的原始标识和来源字段，方便接口变化时诊断。

### `apps/worker`

Worker 调用适配器，校验数据，写入数据库并记录同步结果。目录同步与价格同步是两个独立任务，单个地区失败不阻断其他地区。

### `apps/api`

API 只读取数据库并返回稳定 DTO。用户查询不会实时触发全量任天堂抓取，因此上游短暂故障不会直接让 App 失效。

### `apps/web`

Web 负责搜索输入、筛选、列表、详情、图表、加载与错误状态、本地收藏和 PWA 安装体验。Web 不保存公共价格历史，也不直接访问任天堂接口。

## 6. 数据模型

### `games`

表示跨地区的可选统一游戏身份。

- `id`：内部 UUID。
- `canonical_title`：规范显示名称。
- `created_at`、`updated_at`。

只有存在可靠证据时才将多个地区商品连接到同一个 `game`。第一版允许一个 `game` 只有一个地区商品。

### `regional_listings`

表示某个国家商店中的具体商品。

- `id`：内部 UUID。
- `game_id`：可关联的统一游戏。
- `country`：`JP`、`US` 或 `GB`。
- `source`：上游适配器名称。
- `source_id`：NSUID 或上游稳定标识。
- `product_code`：可空。
- `title`、`publisher`、`developer`。
- `description`、`image_url`。
- `release_date`。
- `product_type`：`game`、`bundle`、`dlc` 或 `unknown`。
- `source_url`。
- `is_active`。
- `source_payload`：诊断用 JSONB，不作为公共 API 合约。
- `last_seen_at`、`created_at`、`updated_at`。

唯一约束为 `(country, source, source_id)`。

### `current_prices`

- `regional_listing_id`：主键兼外键。
- `currency`。
- `regular_amount_minor`：最小货币单位整数。
- `discount_amount_minor`：可空。
- `discount_start_at`、`discount_end_at`：可空。
- `sales_status`。
- `observed_at`、`updated_at`。

金额不使用浮点数。折扣比例由 API 根据原价和折扣价计算，避免重复存储不一致值。

### `price_history`

- `id`：递增主键。
- `regional_listing_id`。
- `currency`。
- `regular_amount_minor`。
- `discount_amount_minor`：可空。
- `discount_start_at`、`discount_end_at`：可空。
- `sales_status`。
- `observed_at`。

只有价格、币种、销售状态或折扣时间发生变化时才写入新记录。第一条有效价格必须写入。

### `sync_runs`

- `id`、`job_type`、`country`。
- `started_at`、`finished_at`。
- `status`：`running`、`success`、`partial` 或 `failed`。
- `items_read`、`items_written`。
- `error_code`、`error_message`。

## 7. 同步策略

- 目录同步：每天一次，分地区串行或受限并发执行。
- 价格同步：每六小时一次，每批最多使用上游允许的 ID 数量。
- 重试：网络错误和 5xx 最多重试三次，采用指数退避和随机抖动。
- 不重试：结构校验错误、4xx 参数错误和明确的访问拒绝。
- 失效商品：连续七天未出现后标记 `is_active=false`，不删除历史。
- 并发保护：同一任务和地区不能同时运行两个实例。
- 数据新鲜度：API 返回 `observedAt`；超过十二小时的价格返回 `stale=true`。
- 上游失败：继续提供最后一次成功数据，并在健康检查中暴露同步过期状态。

## 8. API 设计

公共前缀为 `/v1`，响应使用 JSON。时间统一为 UTC ISO 8601，金额使用整数最小货币单位并附带币种。

### `GET /v1/games`

参数：`country`、`q`、`onSale`、`page`、`pageSize`、`sort`。

返回规范化游戏列表、当前价格摘要和分页信息。`pageSize` 默认 20，最大 100。

### `GET /v1/games/:id`

返回统一游戏及其 JP、US、GB 地区商品。未可靠关联的商品仍可通过地区商品 ID 单独查询。

### `GET /v1/listings/:id`

返回一个具体地区商品、当前价格、折扣信息和数据更新时间。

### `GET /v1/listings/:id/price-history`

参数：`from`、`to`、`limit`。返回按时间升序的价格变化点和历史最低价。

### `GET /v1/deals`

参数：`country`、`minDiscountPercent`、`endingBefore`、`page`、`pageSize`、`sort`。

仅返回当前存在有效折扣的商品。

### `GET /v1/health`

返回进程、数据库和各地区最后成功同步时间。公开响应不包含密钥、内部地址或完整异常堆栈。

### 错误格式

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "pageSize must be between 1 and 100",
    "requestId": "..."
  }
}
```

## 9. Web/PWA 设计

第一版包含四个页面：

- 折扣页：地区切换、折扣率排序和即将结束筛选。
- 游戏页：搜索、分页、地区和是否打折筛选。
- 商品详情页：基本信息、当前价格、折扣时间和历史价格图。
- 收藏页：浏览器本地收藏，不要求登录。

页面必须明确显示币种、国家、数据更新时间和过期状态。网络失败时展示最近缓存的只读页面，并说明数据可能不是最新。

PWA 提供应用图标、添加到桌面、独立窗口和静态资源缓存。第一版不缓存完整价格数据库，也不在后台自行采集价格。

## 10. 安全与公开发布准备

- GitHub 仓库初始设为 private。
- `.env`、数据库、备份和上游响应转储不提交 Git。
- 个人阶段可对整个站点增加访问密码；内部同步和管理入口必须使用独立密钥。
- 公共 GET API 从第一版开始配置 IP 级速率限制和最大分页大小。
- CORS 初期只允许 PWA 域名和本地开发地址。
- 日志隐藏密钥、Authorization、数据库连接串和个人信息。
- 数据库使用持久卷并执行每日备份，至少保留七天。
- 未来公开发布前增加隐私说明、服务条款、监控告警和容量测试。

浏览器客户端中的字符串不能作为秘密 API 密钥。公开 PWA 上线后，读接口依靠限流和缓存防滥用，而不是把固定密钥写入前端。

## 11. 部署

Docker Compose 初始包含：

- `web`：构建并提供 PWA 静态文件。
- `api`：只读查询服务。
- `worker`：执行目录和价格同步。
- `postgres`：持久化数据库。
- `caddy`：HTTPS 和反向代理。

路由：

- `/` 指向 Web。
- `/api/*` 转发到 API，并在转发时去掉 `/api` 前缀。

部署由 GitHub 代码版本驱动，但价格采集调度运行在 VPS，不依赖 GitHub Actions 定时任务。数据库迁移必须在应用切换前执行，并提供回滚或向后兼容策略。

## 12. 测试与验收

### 自动测试

- 适配器：使用固定 JP XML、US Algolia JSON、GB JSON 样本验证规范化结果。
- 价格：验证原价、折扣价、无折扣、折扣时间和整数金额转换。
- Worker：验证首次写入、无变化不写历史、价格变化新增历史和单地区失败隔离。
- 数据库：验证唯一约束、外键、分页和历史最低价查询。
- API：验证正常响应、参数校验、404、分页上限和统一错误格式。
- Web：验证加载、空结果、失败、过期数据和本地收藏。

### 真实联网测试

真实上游测试与普通单元测试分开，按需或定时少量执行，避免测试套件频繁访问任天堂。每个地区至少验证目录非空和一个已知商品的价格结构，不固定断言游戏总数或具体价格。

### 第一版验收标准

- JP、US、GB 每个地区至少完成一次目录和价格同步。
- 任一商品的价格变化可以形成两条历史记录。
- API 在上游不可用时仍返回数据库中的最后成功数据。
- 折扣页、搜索页、商品详情和历史图在手机尺寸可用。
- 新 VPS 可以仅依靠文档、环境变量模板和 Docker Compose 完成部署。
- 数据库备份可以在空数据库中恢复并通过健康检查。

## 13. 后续扩展顺序

第一版稳定后，按以下顺序扩展：

1. 更多欧洲国家、香港和台湾。
2. 降价通知与目标价格。
3. 用户账户和跨设备收藏。
4. 微信小程序客户端，共用现有 `/v1` API。
5. 更可靠的跨区游戏关联和人工校正工具。

这些扩展不改变第一版的核心边界：适配器产生规范数据，Worker 保存历史，API 提供稳定查询，客户端只负责用户体验。
