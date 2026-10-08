# yantu · 沿途放票地图

选定车次 → 看清每一站的放票进度 → 辅助「买长乘短 / 买短乘长 + 补票」购票决策。

> 仅查询公开数据 · 无登录态 · 不下单 · 仅供学习研究，请遵守 12306 服务规则

## 功能

- **车次列表**：出发站→目的站间全部车次的分席别余票（12306 风格：数字 / 有 / 候补 / 无票 / 未开售），支持车次类型筛选（高铁动车 / 普速）、只看有票
- **补票方案**：指定车次后，自动叉乘「提前上车点 × 补票下车点」全部区间，逐区间查询余票，计算 多买/少买 站数与实购票价
- **地铁线式经停图**：一条横线串起全部经停站，点选方案行即高亮对应乘车区间，吸附悬浮不随滚动消失
- **放票时间**：基于 15 天预售期推算起售日，按出发站显示具体起售时刻（数据来自 12306 官方起售时间表）
- **键盘操作**：↑↓ 切换方案行，Enter/Esc 操作站点联想
- **状态语义**：数字（余票）/ 有（充足）/ 候补（可排队）/ 无票（售罄或未投放）/ 未开售（超出预售期）

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + TypeScript |
| 后端 | Node 18+（零依赖，内置 fetch） |
| 数据源 | 同程旅行（suanya.com）公开查询接口；放票时间来自 12306 官方起售时间表 |
| 部署 | Vercel（静态前端 + Serverless Functions） |

## 项目结构

```
yantu/
├── api/                        # Vercel Serverless Functions
│   ├── _lib.mjs                # 共享查询逻辑（叉乘算法、缓存、限流、超时）
│   ├── query.mjs               # GET /api/query
│   └── sale-info.mjs           # GET /api/sale-info
├── frontend/                   # React 前端
│   ├── src/…
│   └── public/stations.json    # 3388 站站点字典
├── server/index.mjs            # 本地开发服务（复用 api/_lib.mjs）
├── config.json                 # 配置：限流开关（默认关闭）
├── vercel.json                 # 构建与函数配置
└── docs/requirements.md        # 需求文档
```

## 本地运行

```bash
# 1. 启动后端（端口 3000）
node server/index.mjs

# 2. 启动前端（端口 5173，/api 自动代理到 3000）
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173

## 部署到 Vercel

```bash
npm i -g vercel
vercel          # 首次关联项目
vercel --prod   # 上线
```

页面与 API 同域名，无需额外配置 CORS。

## 配置说明（config.json）

```json
{
  "rateLimit": {
    "enabled": false,   // IP 限流开关（默认关闭）
    "perMinute": 10     // 每 IP 每分钟最大查询次数
  }
}
```

## 更新站点字典

```bash
python scripts/gen_stations.py   # 拉取 12306 station_name.js -> stations.json
```

## 内置防护

- 相同参数 60s 内返回缓存结果（失败不缓存）
- 上游请求 10s 超时；并发区间查询带 50~200ms 随机抖动
- 前端请求超时与去重

## 需求文档

详见 [docs/requirements.md](docs/requirements.md)。
