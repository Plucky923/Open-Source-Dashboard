# API 参考

[文档首页](README.md) · [快速开始](getting-started.md) · [架构与数据口径](architecture.md) · [运行与维护](operations.md)

后端默认监听 `http://localhost:3000`。通过 Docker Compose 的前端入口访问时，`/api` 会由 Nginx 代理，例如 `http://localhost:8080/api/v1/organization/summary`。

## 通用参数

多数统计接口支持 `range` 查询参数：

- `range=7d`、`range=30d`、`range=90d`：最近 N 天。
- `range=all`：全部历史数据，仅适用于下文列出的接口。

当前实现中，`all` 可用于组织汇总、仓库、时间序列、聚合时间序列，SIG Commit/API/聚合时间序列、贡献者和 SIG 对比接口。SIG `summary`、基础 `timeseries`、增长分析以及 CSV/Excel 导出应传 `<days>d`，否则不能得到“全部历史”语义。

聚合趋势、SIG 对比和导出接口还可使用 `granularity=day|week|month` 控制时间粒度。

```bash
curl 'http://localhost:3000/api/v1/organization/summary?range=30d'
curl 'http://localhost:3000/api/v1/organization/timeseries/aggregated?range=90d&granularity=week'
```

## 组织接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/organization/summary` | 组织汇总指标和数据新鲜度 |
| GET | `/api/v1/organization/sigs` | SIG 的 ID 和名称列表 |
| GET | `/api/v1/organization/repositories` | 组织内仓库级指标 |
| GET | `/api/v1/organization/timeseries` | 组织活动日时间序列 |
| GET | `/api/v1/organization/timeseries/aggregated` | 按日、周或月聚合的组织活动时间序列 |
| GET | `/api/v1/organization/latest-activity` | GitHub 上最新的开放 PR 或 Issue |
| GET | `/api/v1/organization/growth-analysis` | 当前区间与前一区间的增长对比 |
| GET | `/api/v1/organization/day/:date` | 指定日期的组织活动明细 |

示例：

```bash
curl 'http://localhost:3000/api/v1/organization/repositories?range=30d'
curl 'http://localhost:3000/api/v1/organization/day/2026-09-01'
curl 'http://localhost:3000/api/v1/organization/latest-activity?type=prs&page=1&per_page=10'
```

组织汇总中的新鲜度字段示例：

```json
{
  "last_updated_at": "2026-09-09T00:00:00.000Z",
  "data_status": "fresh"
}
```

从未成功完成定时采集时，`last_updated_at` 可能为 `null`，且 `data_status` 为 `missing`。

`latest-activity` 的 `type` 必须是 `prs` 或 `issues`；`per_page` 最大为 100。

## SIG 接口

路径中的 `:sigId` 是 `/api/v1/organization/sigs` 返回的数据库 ID，不是 SIG 名称。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/sig/:sigId/summary` | SIG 汇总指标 |
| GET | `/api/v1/sig/:sigId/timeseries` | SIG 活动日时间序列 |
| GET | `/api/v1/sig/:sigId/timeseries/commits` | SIG Commit 与代码行时间序列 |
| GET | `/api/v1/sig/:sigId/timeseries/api` | SIG PR、Issue 与贡献者时间序列 |
| GET | `/api/v1/sig/:sigId/timeseries/aggregated` | 按日、周或月聚合的 SIG 时间序列 |
| GET | `/api/v1/sig/:sigId/growth-analysis` | SIG 增长对比 |
| GET | `/api/v1/sig/:sigId/contributors` | SIG 贡献者数据 |
| GET | `/api/v1/sigs/compare` | 对比 `sigIds` 指定的多个 SIG |

```bash
curl 'http://localhost:3000/api/v1/sig/1/summary?range=30d'
curl 'http://localhost:3000/api/v1/sig/1/contributors?range=all'
curl 'http://localhost:3000/api/v1/sigs/compare?sigIds=1,2&range=90d&granularity=week'
```

## 贡献者接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/contributors/leaderboard` | 贡献者排行榜 |
| GET | `/api/v1/contributors/stats` | 贡献者总数、新贡献者和最活跃日期概览 |
| GET | `/api/v1/contributors/:username` | 指定贡献者的活动详情 |

```bash
curl 'http://localhost:3000/api/v1/contributors/leaderboard?range=30d'
curl 'http://localhost:3000/api/v1/contributors/stats?range=30d'
curl 'http://localhost:3000/api/v1/contributors/octocat?range=all'
```

Bot 账号不会进入人类贡献者指标，但 Bot 提交仍计入组织、SIG 和仓库的 Commit 与代码行活动量。

## 导出接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/export/csv` | 导出 CSV |
| GET | `/api/v1/export/excel` | 导出 Excel |
| POST | `/api/v1/export/pdf` | 根据请求体中的当前页面数据生成 PDF |

```bash
curl -L 'http://localhost:3000/api/v1/export/csv?range=30d' -o dashboard.csv
```

CSV 和 Excel 接口支持：

- `type=org|sig|comparison`
- `range=<days>d`
- `sigIds=1,2`，用于 SIG 或对比导出
- `granularity=day|week|month`

PDF 接口不是数据查询接口。前端以 JSON 请求体提交 `type`、`range`、`sigIds`、`summary`、`growthData`、`sigData`、`contributors` 和 `timeseries` 等已加载数据，再由后端排版生成文件。
