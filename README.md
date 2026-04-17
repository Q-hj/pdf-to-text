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
- 自定义区域内容提取
- Excel 导出功能

## 打包部署

### esbuild 打包（推荐）

将项目打包为独立目录，便于分发部署：

```bash
# 构建
npm run build

# 输出目录：dist/
#   - server.mjs  (Web 服务)
#   - cli.mjs     (CLI 工具)
#   - public/     (Web UI)

# 安装依赖后运行
cd dist
npm install canvas express multer pdf-parse exceljs pdfjs-dist sharp tesseract.js pdf2pic
npm start              # 启动服务
PORT=3003 npm start    # 指定端口
node cli.mjs file.pdf  # CLI 使用
```

### Docker 方式

```bash
# 方式一：使用 npm 脚本
npm run build:docker      # 构建镜像
npm run docker:up         # 启动服务
npm run docker:logs       # 查看日志
npm run docker:down       # 停止服务

# 方式二：使用 docker-compose
docker-compose up -d
# 访问 http://localhost:3000

# 方式三：直接 docker 命令
docker build -t pdf-to-text .
docker run -d -p 3000:3000 --name pdf-to-text pdf-to-text
```

### 指定端口

```bash
# docker-compose 方式：修改 docker-compose.yml 中的 ports 配置
# 例如 "3003:3000" 将服务映射到 3003 端口

# 或直接运行时指定
docker run -d -p 3003:3000 -e PORT=3000 --name pdf-to-text pdf-to-text
```

### 本地开发

```bash
npm install
npm start                 # 默认 3000 端口
PORT=3003 npm start       # 指定端口启动
npm run clean             # 清理临时文件
```

## CLI 命令行使用

```bash
npm run cli -- --help
npm run cli -- document.pdf
npm run cli -- document.pdf output.txt
npm run cli -- document.pdf -p    # 按页分割
```

## Web API

### 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | Web 界面 |
| `/convert` | POST | 上传 PDF 转换 |
| `/convert/file` | POST | 通过文件路径转换 |
| `/convert/region` | POST | 区域提取 |
| `/convert/multi-region` | POST | 多区域提取 |
| `/convert/bottom-table` | POST | 底部表格提取 |
| `/export/excel` | POST | Excel 导出 |
| `/export/bottom-table-excel` | POST | 底部表格 Excel 导出 |
| `/export/multi-excel` | POST | 多区域合并 Excel 导出 |
| `/health` | GET | 健康检查 |

### 参数

| 参数 | 说明 |
|------|------|
| `splitPages=true` | 按页分割返回 |
| `ocr=true` | 强制使用 OCR |
| `lang=chi_sim+eng` | OCR 语言 |
| `position=top-right` | 区域位置 |

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
├── .dockerignore
├── package.json
├── src/
│   ├── index.js      # 核心转换
│   ├── cli.js        # CLI 工具
│   └── server.js     # Web 服务
├── public/
│   └── index.html    # Web 界面
├── temp/             # 临时文件目录
└── test/
    └── test.js
```

## 注意事项

- OCR 比普通文本提取慢，首次使用会下载语言训练数据
- 文件大小限制 50MB
- 扫描版 PDF 推荐 200 DPI 以上清晰度