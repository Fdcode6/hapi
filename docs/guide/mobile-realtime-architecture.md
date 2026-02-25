# iOS 移动端实时连接架构（WebSocket + Push + 增量补偿）

> 适用范围：HAPI 的移动端（Expo / iOS 优先）在「前台实时、后台可恢复、商用级体验」场景下的实现规范。  
> 文档时间：2026-02-25

## 1. 背景与结论

### 1.1 为什么不能只靠 WebSocket

iOS 上 App 进入后台后，系统会暂停网络活动，长连接会被中断或失活。  
因此“后台永久保持 WebSocket 在线”不现实。

### 1.2 行业最佳实践（本项目采用）

采用 **Hybrid 模式**：

1. **前台：WebSocket 实时通道**（低延迟）
2. **后台：Push 通知触发感知**（APNs / Expo Push）
3. **回前台：按 cursor (`afterSeq`) 增量补偿**
4. **服务端保留事件日志与幂等命令**（可重放、可去重）

目标：用户几乎看不到“认证中 / 同步中 / 重连中”阻塞提示。

---

## 2. 当前项目基线（已实现）

### 2.1 云端与本机执行平面

- Cloud API：`apps/cloud-api`
- 本机 daemon：`apps/fdcode-daemon`
- 运行时通道：`/v1/device-runtime/*`（HTTP 轮询 + 事件上报）
- 事件回放：`GET /v1/sessions/:id/events?afterSeq=<n>`
- 命令幂等：`commandId + sessionId`

### 2.2 通知能力

- Bark 完成通知：已实现
- Expo Push：服务端已支持真实下发（可通过环境变量启用）

### 2.3 持久化

- Cloud API 已切换 SQLite 持久化（commands/events/session_owners/push_tokens）

---

## 3. 目标架构（移动端）

```text
前台:
Mobile App ── WebSocket ── Cloud Realtime Gateway
                 │
                 └─ afterSeq 补偿拉取（HTTP）

后台:
Cloud Event -> Expo Push/APNs -> Mobile Notification

回前台:
refresh token -> replay events(afterSeq) -> reconnect websocket
```

核心原则：**实时靠 WS，稳定靠事件补偿**。

---

## 4. 会话与同步模型

### 4.1 必要字段

- `sessionId`
- `seq`（单调递增）
- `eventId`
- `commandId`（幂等）
- `afterSeq`（客户端本地游标）

### 4.2 同步规则

1. 客户端本地维护每个 session 的 `lastSeq`
2. 前台收到 WS 事件：
   - 验证 `seq` 连续
   - 去重（`eventId` 或 `seq`）
3. 若发现 gap（例如期望 12，收到 14）：
   - 标记 `degraded`
   - 立即请求 `GET events?afterSeq=11` 补齐

---

## 5. iOS 生命周期状态机

### 5.1 状态定义

- `healthy`：实时正常
- `degraded`：可用但需补偿
- `offline`：临时不可达

### 5.2 前后台切换

#### App 进入后台

- 关闭/忽略 WS（由系统接管）
- 持久化 `lastSeq` 到本地存储
- 不展示强提示

#### App 回到前台

1. 静默 refresh token
2. 拉取 `afterSeq` 增量事件
3. 重建 WS
4. 状态从 `degraded -> healthy`

---

## 6. Push 策略

### 6.1 事件到通知映射（建议）

- `ready`：任务完成可交互
- `tool_request`：等待用户授权
- `error`：任务失败或需要处理

### 6.2 展示策略

- 非关键状态不打扰用户
- 完成通知简洁、可点击回到具体 session
- 同一 session 做短窗口去抖（避免刷屏）

---

## 7. UX 规范（避免“糟糕提示感”）

1. **< 10 秒断连**：不显示任何阻塞文案
2. **>= 10 秒**：仅轻量提示（如顶部小条）
3. 聊天主区域保持可读，不出现大面积 loading 遮罩
4. 用户发送消息时若网络抖动：
   - 先本地 optimistic 渲染
   - 后续按 commandId 回填最终状态

---

## 8. 服务端接口与职责建议

### 8.1 保持已有（已实现）

- `POST /v1/sessions/:id/commands`
- `GET /v1/sessions/:id/events?afterSeq=...`
- `POST /v1/push/register`
- `DELETE /v1/push/register`

### 8.2 Realtime Gateway（已实现）

- `WS /v1/realtime?sessionId=...&afterSeq=...`
- 连接建立后先执行一次 `afterSeq` 补偿
- 再进入实时推流
- 断线后客户端可无损恢复
  
对应代码：
- Cloud：`apps/cloud-api/src/realtime/*`
- Mobile：`apps/mobile-expo/src/realtime/*`

> 即使引入 WS，也保留 HTTP replay 作为兜底。

---

## 9. 可靠性与可观测性

### 9.1 指标（必须上报）

- WS 重连次数 / 会话
- replay 请求次数
- seq gap 发生率
- push 发送成功率
- 从前台恢复到 `healthy` 的耗时（P50/P95）

### 9.2 告警建议

- replay 失败率 > 5%
- push 失败率持续升高
- 某版本客户端 gap 率异常

---

## 10. 实施顺序（推荐）

1. **先不动现有 HTTP 主链路**
2. 新增移动端 WS 网关与客户端连接层
3. 接入 lifecycle（前后台）与 cursor 补偿
4. 接入 Push 策略与通知去抖
5. 做灰度（少量用户）观察指标
6. 再切默认路径为 WS 优先

---

## 11. 验收标准（Definition of Done）

1. 前台消息延迟明显低于纯轮询
2. 后台 10 分钟后回前台可在 2 秒内恢复 `healthy`（正常网络）
3. 不出现持久“认证中/同步中/重连中”主界面阻塞
4. 任意断网恢复后，`seq` 无缺口（可补齐）
5. push 到达率、事件一致性达到目标阈值

---

## 12. 环境变量建议

Cloud API：

```bash
FDCODE_DB_PATH=/var/lib/fdcode/cloud-api.sqlite
FDCODE_EXPO_PUSH_ENABLED=1
FDCODE_EXPO_PUSH_ENDPOINT=https://exp.host/--/api/v2/push/send
FDCODE_EXPO_ACCESS_TOKEN=
FDCODE_BARK_ENDPOINT=https://api.day.app/<device_key>
```

Mobile：

```bash
API_BASE_URL=https://your-domain.example.com
REALTIME_WS_URL=wss://your-domain.example.com/v1/realtime
```

---

## 13. 结语

本方案不是“强行后台保活连接”，而是“**可中断、可恢复、可补偿**”的移动实时架构。  
对 iOS 来说，这是更符合系统机制、也更接近商用品质的实现路径。
