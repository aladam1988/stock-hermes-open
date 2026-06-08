# Stock Hermes

一个本地优先的股票研究助手原型，用于观察美股/产业链标的、整理研究问题，并通过 OpenAI-compatible API 调用大模型生成分析。

## 特点

- 本地网页界面，默认运行在 `http://127.0.0.1:8899/`
- 支持通过后端代理调用模型，避免在前端暴露 API Key
- 适合做观察池、股票研究笔记和产业链分析原型
- 包含设置页，可查看当前模型配置状态

## 快速开始

```bash
cp .env.example .env
# 编辑 .env，填入你的 OpenAI-compatible API 地址和 Key
python3 server.py --port 8899
```

打开：

```text
http://127.0.0.1:8899/
```

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
