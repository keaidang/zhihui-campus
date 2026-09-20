# 智汇校园 · 一站式智慧校园服务平台

> 毕业设计论文标题（定稿 2026-09-16）：
> **《基于云边协同与 Serverless 架构的"智汇校园"一站式服务平台设计与实现》**
>
> 基于腾讯云 EdgeOne 云边协同全栈架构的校园综合服务平台（毕业设计）

## 项目定位

一个覆盖校园生活全场景的一站式平台：统一登录与权限体系之下，集成用户与组织管理、选课与成绩、请销假审批、校园邮箱、图书借阅、失物招领、社团活动、校园论坛（含交易板块）、宿舍管理、站内信、数据驾驶舱等模块。区别于单个管理系统，本项目的核心卖点是**统一架构 + 模块化设计 + 边缘全栈部署**。

## 技术栈总览

| 层 | 选型 |
|---|---|
| 前端 | Vue 3 + Element Plus + Pinia + Vue Router（单套产物响应式，桌面/移动共用；App 端由 H5 封装成壳，见 ARCHITECTURE ADR-8） |
| 后端 | EdgeOne Pages：Edge Functions（轻逻辑）+ Node Functions（业务 API） |
| 数据库 | TiDB Cloud Serverless（MySQL 兼容，免费额度）／ 备选云 RDS MySQL 8.0 |
| KV | 访问统计计数、功能开关（Edge Functions 使用；入口限流已改 DB 流水计数，多实例安全） |
| Blob | 图片、附件等非结构化数据 |
| 部署 | Git 推送 → EdgeOne Pages 自动构建部署 |

## 目录结构

```
智汇校园-一站式服务平台/
├── docs/                # 项目记忆文档（AI 协作必读）
│   ├── PRD.md           # 需求与功能清单
│   ├── ARCHITECTURE.md  # 架构与技术决策
│   ├── DATABASE.md      # 数据库设计（单一事实来源）
│   ├── API.md           # 接口约定
│   ├── CONVENTIONS.md   # 代码与协作规范
│   └── PROGRESS.md      # 进度与待办
├── web-admin/           # Vue 3 管理端
├── miniprogram/         # uni-app 小程序端
├── functions/           # EdgeOne Functions（edge + node）
└── seed/                # 演示数据脚本
```

## AI 协作必读

任何 AI 会话开工前，先读取 `docs/` 下全部文档再继续任务。规范见 `docs/CONVENTIONS.md`。
