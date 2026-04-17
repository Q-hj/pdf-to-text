# PDF to Text - Vercel 轻量版

仅支持文本型 PDF 的轻量版本，无 OCR 功能，适合部署到 Vercel Serverless。

## 功能

- PDF 文本提取
- 底部表格解析
- 无 OCR（避免超时）

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/convert` | POST | PDF 转文本 |
| `/api/bottom-table` | POST | 底部表格提取 |
| `/api/health` | GET | 健康检查 |

## 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
cd vercel
vercel
```

## 目录结构

```
vercel/
├── api/
│   ├── lib.js          # 核心函数
│   ├── convert.js      # 转换 API
│   ├── bottom-table.js # 表格 API
│   └── health.js       # 健康检查
├── public/
│   └── index.html      # Web UI
├── package.json
└── vercel.json
```

## 注意

- 仅支持文本型 PDF（非扫描版）
- Vercel 免费版 10秒超时限制
- 完整 OCR 功能请使用 Docker 版本