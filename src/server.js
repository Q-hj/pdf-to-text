import express from 'express';
import multer from 'multer';
import { pdfToText, pdfRegionToText, pdfMultiRegionToText, parseTableText } from './index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 配置文件上传
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 限制 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF 文件'), false);
    }
  }
});

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 首页返回 HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 上传 PDF 文件转换
app.post('/convert', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const ocr = req.query.ocr === 'true';
    const lang = req.query.lang || 'chi_sim+eng';

    const result = await pdfToText(req.file.buffer, {
      splitPages: req.query.splitPages === 'true',
      ocr: ocr,
      autoDetect: !ocr,
      lang: lang
    });

    res.json({
      success: true,
      pages: result.pages,
      text: result.text,
      pageTexts: result.pageTexts,
      metadata: result.metadata
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 通过文件路径转换
app.post('/convert/file', async (req, res) => {
  try {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: '请提供 filePath 参数' });
    }

    const result = await pdfToText(filePath, {
      splitPages: req.query.splitPages === 'true'
    });

    res.json({
      success: true,
      pages: result.pages,
      text: result.text,
      pageTexts: result.pageTexts,
      metadata: result.metadata
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 底部表格提取 API（表头+数据行）- 使用PDF原生文本
app.post('/convert/bottom-table', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    // 直接提取PDF原生文本（不使用OCR）
    const result = await pdfToText(req.file.buffer, {
      splitPages: true,
      autoDetect: false
    });

    // 按页分割文本并解析
    const pageTables = [];
    const pageTexts = result.pageTexts || splitTextToPages(result.text, result.pages);

    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i];
      const parsedData = parseTableText(pageText);

      pageTables.push({
        page: i + 1,
        rawText: pageText.substring(0, 500), // 仅保留前500字符作为参考
        tableData: parsedData
      });
    }

    res.json({
      success: true,
      pages: result.pages,
      position: 'bottom-table',
      pageTables: pageTables
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 辅助函数：将文本按页分割
function splitTextToPages(text, totalPages) {
  if (!text) return [];
  // 使用页码标记分割（PDF常见的分页模式）
  const pages = [];
  const lines = text.split('\n');

  // 简单按行数分割
  const linesPerPage = Math.ceil(lines.length / totalPages);
  for (let i = 0; i < totalPages; i++) {
    const start = i * linesPerPage;
    const end = Math.min(start + linesPerPage, lines.length);
    pages.push(lines.slice(start, end).join('\n'));
  }

  return pages;
}

// 底部表格导出 Excel API（目标格式）- 使用PDF原生文本
app.post('/export/bottom-table-excel', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    // 直接提取PDF原生文本（不使用OCR）
    const result = await pdfToText(req.file.buffer, {
      splitPages: true,
      autoDetect: false
    });

    // 按页分割文本并解析
    const pageTexts = result.pageTexts || splitTextToPages(result.text, result.pages);

    const pageTables = [];
    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i];
      const parsedData = parseTableText(pageText);
      pageTables.push({
        page: i + 1,
        tableData: parsedData
      });
    }

    // 创建 Excel 工作簿
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PDF to Text Tool';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('提取结果');

    // 实际图纸表格字段
    const headers = ['序号', '管线号', '材料等级', '管道级别', '设计温度', '操作温度', '设计压力', '操作压力', '保温类型', '保温厚度', '刷漆', '比例', '图号', '版次'];
    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 15 }));

    // 设置表头样式
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 添加数据行
    pageTables.forEach((pageItem, index) => {
      const rowData = { 序号: index + 1 };

      // 直接从 tableData 中匹配对应的值
      if (pageItem.tableData && pageItem.tableData.length > 0) {
        pageItem.tableData.forEach(item => {
          // 直接使用key匹配
          if (headers.includes(item.key)) {
            rowData[item.key] = item.value;
          }
        });
      }

      worksheet.addRow(rowData);
    });

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=bottom_table_export_${Date.now()}.xlsx`);

    // 写入响应
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 区域提取 API
app.post('/convert/region', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    // 获取区域参数
    const position = req.query.position || req.body?.position || 'top-right';
    const custom = req.body?.custom ? JSON.parse(req.body.custom) : null;
    const lang = req.query.lang || req.body?.lang || 'chi_sim+eng';

    const result = await pdfRegionToText(req.file.buffer, {
      position,
      custom
    }, {
      lang
    });

    res.json({
      success: true,
      pages: result.pages,
      position: result.position,
      pageResults: result.pageResults,
      summary: result.summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Excel 导出 API
app.post('/export/excel', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const mode = req.query.mode || 'region';
    const position = req.query.position || 'top-right';
    const lang = req.query.lang || 'chi_sim+eng';

    let data;
    if (mode === 'full') {
      const result = await pdfToText(req.file.buffer, {
        splitPages: true,
        lang: lang
      });
      data = {
        mode: 'full',
        pageTexts: result.pageTexts || [],
        pages: result.pages
      };
    } else {
      const custom = req.body?.custom ? JSON.parse(req.body.custom) : null;
      const result = await pdfRegionToText(req.file.buffer, {
        position,
        custom
      }, {
        lang
      });
      data = {
        mode: 'region',
        position: result.position,
        pageResults: result.pageResults || [],
        pages: result.pages
      };
    }

    // 创建 Excel 工作簿
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PDF to Text Tool';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('提取结果');

    // 设置列
    worksheet.columns = [
      { header: '页码', key: 'page', width: 10 },
      { header: '提取内容', key: 'text', width: 80 },
      { header: '位置信息', key: 'region', width: 30 }
    ];

    // 设置表头样式
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 添加数据
    if (data.mode === 'full') {
      data.pageTexts.forEach((text, index) => {
        worksheet.addRow({
          page: index + 1,
          text: text || '(无内容)',
          region: '全文'
        });
      });
    } else {
      data.pageResults.forEach(item => {
        worksheet.addRow({
          page: item.page,
          text: item.text || '(无内容)',
          region: item.region?.percent ? `(${item.region.percent.x}%(${item.region.percent.y}%)` : data.position
        });
      });
    }

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=pdf_export_${Date.now()}.xlsx`);

    // 写入响应
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 多区域提取 API
app.post('/convert/multi-region', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const lang = req.query.lang || req.body?.lang || 'chi_sim+eng';

    // 解析区域配置
    let regions = [];
    if (req.body?.regions) {
      regions = JSON.parse(req.body.regions);
    } else {
      // 默认右上角 + 底部
      regions = [
        { position: 'top-right' },
        { position: 'bottom-right' }
      ];
    }

    const result = await pdfMultiRegionToText(req.file.buffer, regions, { lang });

    res.json({
      success: true,
      pages: result.pages,
      regions: result.regions,
      pageResults: result.pageResults
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 多区域 Excel 导出 API
app.post('/export/multi-excel', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const lang = req.query.lang || 'chi_sim+eng';

    // 解析区域配置
    let regions = [];
    if (req.body?.regions) {
      regions = JSON.parse(req.body.regions);
    } else {
      // 默认右上角 + 底部
      regions = [
        { position: 'top-right', name: '编号' },
        { position: 'bottom-center', name: '说明文字' }
      ];
    }

    const result = await pdfMultiRegionToText(req.file.buffer, regions, { lang });

    // 解析底部文字，提取键值对
    const allKeys = new Set();
    const parsedData = [];

    result.pageResults.forEach(pageItem => {
      const rowData = { page: pageItem.page };

      pageItem.regions.forEach(regionItem => {
        const regionName = regions[regionItem.regionIndex]?.name || regionItem.position;
        const text = regionItem.text || '';

        if (regionName === '编号' || regionItem.position === 'top-right') {
          // 编号区域直接作为一列
          rowData['编号'] = text.trim();
        } else {
          // 底部文字解析键值对
          const pairs = parseKeyValuePairs(text);
          pairs.forEach(pair => {
            rowData[pair.key] = pair.value;
            allKeys.add(pair.key);
          });
        }
      });

      parsedData.push(rowData);
    });

    // 创建 Excel 工作簿
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PDF to Text Tool';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('提取结果');

    // 设置列 - 编号 + 所有键值对的键
    const sortedKeys = Array.from(allKeys).sort();
    const columns = [
      { header: '编号', key: '编号', width: 15 }
    ];
    sortedKeys.forEach(key => {
      columns.push({ header: key, key: key, width: 20 });
    });

    worksheet.columns = columns;

    // 设置表头样式
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 添加数据
    parsedData.forEach(rowData => {
      const row = { 编号: rowData['编号'] || '' };
      sortedKeys.forEach(key => {
        row[key] = rowData[key] || '';
      });
      worksheet.addRow(row);
    });

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=pdf_export_${Date.now()}.xlsx`);

    // 写入响应
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 解析键值对文本
 * 支持格式: "键: 值" 或 "键：值" 或 "键 值"（空格分隔）
 */
function parseKeyValuePairs(text) {
  const pairs = [];
  const lines = text.split('\n');

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;

    // 尝试匹配 "键: 值" 或 "键：值" 格式
    const colonMatch = line.match(/^(.+?)[：:]\s*(.*)$/);
    if (colonMatch) {
      const key = colonMatch[1].trim();
      const value = colonMatch[2].trim();
      if (key && value) {
        pairs.push({ key, value });
        return;
      }
    }

    // 尝试匹配空格分隔的键值（如 "项目名称 XXX"）
    const spaceMatch = line.match(/^(.+?)\s{2,}(.+)$/);
    if (spaceMatch) {
      const key = spaceMatch[1].trim();
      const value = spaceMatch[2].trim();
      if (key && value) {
        pairs.push({ key, value });
      }
    }
  });

  return pairs;
}

// 错误处理
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `文件上传错误: ${err.message}` });
  }
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  console.log(`PDF to Text API 服务已启动`);
  console.log(`地址: http://localhost:${port}`);
});