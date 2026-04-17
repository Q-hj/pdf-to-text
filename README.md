<<<<<<< HEAD
# PDF to Text

将 PDF 文件转换为文本的 Node.js 工具，支持 CLI 命令行和 Web API 两种使用方式。

支持**文本型 PDF** 和**扫描版 PDF（图片型）**，扫描版使用 OCR 自动识别。

## 功能特点

- 文本型 PDF 直接提取
- 扫描版 PDF 自动检测并启用 OCR
- 支持中英文、繁体中文 OCR 识别
- Web 界面上传转换
- CLI 命令行工具
- Docker 一键部署

## 快速部署（Docker）

### 方式一：docker-compose

```bash
# 构建并启动
docker-compose up -d

# 访问 http://localhost:3000
```

### 方式二：直接 docker

```bash
# 构建镜像
docker build -t pdf-to-text .

# 运行容器
docker run -d -p 3000:3000 --name pdf-to-text pdf-to-text

# 访问 http://localhost:3000
```

### 停止服务

```bash
docker-compose down
# 或
docker stop pdf-to-text
```

## 本地开发

### 安装依赖

```bash
npm install
```

### 启动 Web 服务

```bash
npm start
# 访问 http://localhost:3000
```

## CLI 命令行使用

```bash
# 查看帮助
npm run cli -- --help

# 转换 PDF 并输出到控制台
npm run cli -- document.pdf

# 转换 PDF 并保存到文件
npm run cli -- document.pdf output.txt

# 按页分割显示
npm run cli -- document.pdf -p
```

## Web API

### 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | Web 界面 |
| `/convert` | POST | 上传 PDF 转换 |
| `/convert/file` | POST | 通过文件路径转换 |
| `/health` | GET | 健康检查 |

### 参数

| 参数 | 说明 |
|------|------|
| `splitPages=true` | 按页分割返回 |
| `ocr=true` | 强制使用 OCR |
| `lang=chi_sim+eng` | OCR 语言（中文+英文） |

### 示例

```bash
# 普通转换
curl -X POST http://localhost:3000/convert \
  -F "pdf=@document.pdf"

# 强制 OCR（扫描版）
curl -X POST "http://localhost:3000/convert?ocr=true&lang=chi_sim+eng" \
  -F "pdf=@scanned.pdf"
```

### 响应示例

```json
{
  "success": true,
  "pages": 10,
  "text": "完整文本内容...",
  "pageTexts": ["第1页内容...", "第2页内容..."],
  "metadata": {
    "ocrUsed": false,
    "version": "1.10"
  }
}
```

## OCR 语言选项

| 值 | 说明 |
|------|------|
| `chi_sim+eng` | 简体中文+英文（默认） |
| `chi_sim` | 仅简体中文 |
| `eng` | 仅英文 |
| `chi_tra+eng` | 繁体中文+英文 |

## 目录结构

```
pdf-to-text/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── src/
│   ├── index.js      # 核心转换（支持 OCR）
│   ├── cli.js        # CLI 工具
│   └── server.js     # Web 服务
├── public/
│   └── index.html    # Web 界面
└── test/
    └── test.js
```

## 注意事项

- OCR 比普通文本提取慢，首次使用会下载语言训练数据
- 文件大小限制 50MB
- 扫描版 PDF 推荐 200 DPI 以上清晰度
=======
# pdf-to-text
自定义区域内容模块PDF转文本(支持中文英文,中文+英文)
>>>>>>> 4a1cd531b1435fd4b8dfd712a9c35471b7997f7d
