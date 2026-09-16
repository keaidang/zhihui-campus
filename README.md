# 智汇校园 · 一站式智慧校园服务平台

> 基于腾讯云 EdgeOne 边缘全栈架构的校园综合服务平台（毕业设计）

## 项目定位

一个覆盖校园生活全场景的一站式平台：统一登录与权限体系之下，集成学生管理、选课、图书借阅、宿舍管理、社团、点餐、二手交易、失物招领、健身打卡等模块。区别于单个管理系统，本项目的核心卖点是**统一架构 + 模块化设计 + 边缘全栈部署**。

## 技术栈总览

| 层 | 选型 |
|---|---|
| 前端 | Vue 3 + Element Plus + Pinia（管理端）、uni-app（小程序/H5） |
| 后端 | EdgeOne Pages：Edge Functions（轻逻辑）+ Node Functions（业务 API） |
| 数据库 | TiDB Cloud Serverless（MySQL 兼容，免费额度）／ 备选云 RDS MySQL 8.0 |
| KV | Session、配置、计数、限流（Edge Functions 使用） |
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
