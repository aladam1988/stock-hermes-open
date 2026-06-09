# Stock Hermes

一个本地优先的股票研究助手原型，用来搭建美股/产业链观察池、整理研究问题，并通过 OpenAI-compatible API 调用大模型生成分析。

> 适合想研究半导体、物理 AI、机器人供应链、美股观察池的人，把零散问题沉淀成一个本地研究工作台。

## 在线预览

GitHub Pages：

```text
http://ai.aladam.ccwu.cc/index.html
```

说明：在线预览只展示前端界面；模型调用、登录、余额记录需要本地启动后端并配置自己的 API Key。

## 核心特点

- 本地网页界面，默认运行在 `http://127.0.0.1:8899/`
- 后端代理模型请求，避免在前端暴露 API Key
- 支持观察池、研究问题、股票分析、产业链梳理等场景
- 设置菜单包含 `Agent 设置` 和 `支付`
- 主页面显示美元余额，用于提醒调用 gpt-5.5 分析股票时的可用预算
- 开源版只保留安全源码和 `.env.example`，不包含任何私密配置

## 快速开始

```bash
git clone https://github.com/aladam1988/stock-hermes-open.git
cd stock-hermes-open
cp .env.example .env
# 编辑 .env，填入你的 OpenAI-compatible API 地址和 Key
python3 server.py
```

打开：

```text
http://127.0.0.1:8899/
```

如果要换端口：

```bash
PORT=8898 python3 server.py
```

## 配置说明

`.env.example` 示例：

```bash
STOCK_HERMES_MODEL="gpt-5.5"
STOCK_HERMES_BASE_URL="https://your-openai-compatible-endpoint/v1"
STOCK_HERMES_API_KEY="PASTE_YOUR_KEY_HERE"
STOCK_HERMES_PROVIDER="custom"
```

你也可以使用任意兼容 OpenAI Chat Completions 的服务。

## 支付与余额

当前版本的支付页是“余额记录页”，不是正式支付通道：

- 余额以美元展示，存储在本地 SQLite 用户表中
- 主页面顶部显示 `余额 $xx.xx`
- 用途是提醒用户：调用 gpt-5.5 做股票分析时还有多少预算
- 不接 Stripe、支付宝、微信支付等真实支付系统

## 适合场景

- 做一个自己的股票研究助手
- 整理美股观察池和产业链标的
- 研究半导体、物理 AI、机器人、无人机等主题
- 把本地研究过程沉淀成可复用工具
- 学习如何安全地把模型 API Key 放在后端而不是前端

## 安全说明

不要把以下文件上传到 GitHub：

- `.env`、`.env.local`、`.env.production`
- `config.yaml`、`auth.json`、`credentials.json`、`token.json`
- `*.db`、`*.sqlite*`
- `*.log`
- 二维码、截图、Cookie、OAuth token、API Key

前端代码不应直接包含模型 API Key。正确做法是：前端请求本地/服务器后端接口，由后端从环境变量读取密钥后转发。

## 开源版与私密版

- 开源版：只保留可公开源码、文档和 `.env.example`
- 私密版：保留本地 `.env`、数据库、日志和个人配置，但不要推送到公开仓库

## 免责声明

本项目仅用于研究和信息整理，不构成投资建议。行情、估值和模型输出都需要自行核验。

## License

MIT
