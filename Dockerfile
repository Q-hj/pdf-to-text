FROM node:18-alpine

# 安装 GraphicsMagick（pdf2pic 需要）
RUN apk add --no-cache graphicsmagick

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY src/ ./src/
COPY public/ ./public/
COPY test/ ./test/

# 创建临时目录
RUN mkdir -p temp/ocr_images

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["node", "src/server.js"]