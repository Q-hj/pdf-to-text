import pdf from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Tesseract worker 缓存
const tesseractWorkers = new Map();

async function getTesseractWorker(lang) {
  if (!tesseractWorkers.has(lang)) {
    console.log(`初始化 Tesseract Worker (${lang})...`);
    const primaryLang = lang.split('+')[0];
    const worker = await Tesseract.createWorker(primaryLang, 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log(`  OCR 进度: ${(m.progress * 100).toFixed(1)}%`);
        }
      }
    });
    tesseractWorkers.set(lang, worker);
  }
  return tesseractWorkers.get(lang);
}

/**
 * 将 PDF 文件转换为文本（支持文本型和扫描型 PDF）
 */
export async function pdfToText(input, options = {}) {
  const { ocr = false, autoDetect = true, splitPages = false, lang = 'chi_sim+eng' } = options;

  let dataBuffer;
  let filePath = null;

  if (typeof input === 'string') {
    const absolutePath = path.resolve(input);
    filePath = absolutePath;
    dataBuffer = await fs.readFile(absolutePath);
  } else if (Buffer.isBuffer(input)) {
    dataBuffer = input;
    if (ocr || autoDetect) {
      const tempDir = path.join(process.cwd(), 'temp');
      await fs.mkdir(tempDir, { recursive: true });
      filePath = path.join(tempDir, `temp_${Date.now()}.pdf`);
      await fs.writeFile(filePath, dataBuffer);
    }
  } else {
    throw new Error('输入必须是文件路径字符串或 Buffer');
  }

  let textResult = null;
  let needsOCR = ocr;
  let pageTexts = [];

  if (!ocr && autoDetect) {
    try {
      // 使用 pagerender 逐页提取文本
      const pageTextsArr = [];
      const data = await pdf(dataBuffer, {
        pagerender: async function(pageData) {
          const textContent = await pageData.getTextContent();
          const text = textContent.items.map(item => item.str).join('');
          pageTextsArr.push(text);
          return text;
        }
      });
      textResult = data;
      pageTexts = pageTextsArr;

      const textContent = data.text || '';
      const textLength = textContent.trim().length;
      const avgCharsPerPage = textLength / data.numpages;

      if (avgCharsPerPage < 50) {
        needsOCR = true;
        console.log(`检测到可能的扫描版 PDF（每页平均 ${avgCharsPerPage.toFixed(1)} 字符），启用 OCR...`);
      }
    } catch (e) {
      needsOCR = true;
      console.log('PDF 解析失败，启用 OCR...');
    }
  } else if (!ocr) {
    // 使用 pagerender 逐页提取文本
    const pageTextsArr = [];
    const data = await pdf(dataBuffer, {
      pagerender: async function(pageData) {
        const textContent = await pageData.getTextContent();
        const text = textContent.items.map(item => item.str).join('');
        pageTextsArr.push(text);
        return text;
      }
    });
    textResult = data;
    pageTexts = pageTextsArr;
  }

  if (needsOCR) {
    console.log('正在使用 OCR 识别图片型 PDF...');
    const actualFilePath = filePath || await saveBufferToTemp(dataBuffer);
    const ocrResult = await performOCR(actualFilePath, lang);

    if (typeof input !== 'string') {
      try {
        if (filePath) await fs.unlink(filePath);
      } catch (e) {}
    }

    const result = {
      text: ocrResult.text,
      pages: ocrResult.pages,
      pageTexts: ocrResult.pageTexts,
      metadata: {
        info: textResult?.info || {},
        version: textResult?.version || 'unknown',
        ocrUsed: true,
        ocrLang: lang
      }
    };

    if (!splitPages) {
      delete result.pageTexts;
    }

    return result;
  }

  const result = {
    text: textResult.text,
    pages: textResult.numpages,
    pageTexts: pageTexts, // 直接使用 pagerender 提取的逐页文本
    metadata: {
      info: textResult.info,
      version: textResult.version,
      ocrUsed: false
    }
  };

  if (!splitPages) {
    delete result.pageTexts;
  }

  return result;
}

/**
 * 提取 PDF 指定区域的文本（按页输出）
 */
export async function pdfRegionToText(input, region = {}, options = {}) {
  const { position = 'top-right', custom = null } = region;
  const { lang = 'chi_sim+eng' } = options;

  let filePath;

  if (typeof input === 'string') {
    filePath = path.resolve(input);
  } else if (Buffer.isBuffer(input)) {
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    filePath = path.join(tempDir, `region_${Date.now()}.pdf`);
    await fs.writeFile(filePath, input);
  } else {
    throw new Error('输入必须是文件路径字符串或 Buffer');
  }

  console.log(`正在提取 PDF 区域文本，位置: ${position}`);

  const result = await extractRegionFromPages(filePath, position, custom, lang);

  // 清理临时文件
  if (Buffer.isBuffer(input)) {
    try {
      await fs.unlink(filePath);
    } catch (e) {}
  }

  return result;
}

/**
 * 提取 PDF 多个区域的文本（按页输出）
 * @param {string|Buffer} input - PDF 文件路径或 Buffer
 * @param {Array} regions - 区域配置数组 [{position, custom}, ...]
 * @param {object} options - 选项 {lang}
 */
export async function pdfMultiRegionToText(input, regions = [], options = {}) {
  const { lang = 'chi_sim+eng' } = options;

  let filePath;

  if (typeof input === 'string') {
    filePath = path.resolve(input);
  } else if (Buffer.isBuffer(input)) {
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    filePath = path.join(tempDir, `multi_region_${Date.now()}.pdf`);
    await fs.writeFile(filePath, input);
  } else {
    throw new Error('输入必须是文件路径字符串或 Buffer');
  }

  if (!regions || regions.length === 0) {
    regions = [{ position: 'top-right', custom: null }];
  }

  console.log(`正在提取 PDF 多区域文本，共 ${regions.length} 个区域`);

  const pdfInfo = await getPdfInfo(filePath);
  const totalPages = pdfInfo.pages;

  const worker = await getTesseractWorker(lang);
  const tempDir = path.join(process.cwd(), 'temp', 'ocr');
  await fs.mkdir(tempDir, { recursive: true });

  const pageResults = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    console.log(`处理第 ${pageNum}/${totalPages} 页...`);

    const pageRegions = [];

    try {
      // 先转换整页为图片
      const outputPath = path.join(tempDir, `multi_page_${pageNum}`);
      await execFileAsync('pdftoppm', [
        '-png',
        '-r', '150',
        '-f', String(pageNum),
        '-l', String(pageNum),
        filePath,
        outputPath
      ]);

      let pageImagePath = `${outputPath}-${String(pageNum).padStart(2, '0')}.png`;
      try {
        await fs.access(pageImagePath);
      } catch {
        pageImagePath = `${outputPath}-${pageNum}.png`;
        try {
          await fs.access(pageImagePath);
        } catch {
          throw new Error('PDF 页面转换失败');
        }
      }

      const meta = await sharp(pageImagePath).metadata();
      const width = meta.width;
      const height = meta.height;

      // 提取每个区域
      for (let regionIdx = 0; regionIdx < regions.length; regionIdx++) {
        const region = regions[regionIdx];
        const { position, custom } = region;

        const cropRegion = calculateCropRegion(position, custom, width, height);
        console.log(`  区域 ${regionIdx + 1}: ${position}, x=${cropRegion.left}, y=${cropRegion.top}`);

        const regionImagePath = path.join(tempDir, `multi_region_${pageNum}_${regionIdx}_${Date.now()}.png`);
        await sharp(pageImagePath)
          .extract(cropRegion)
          .toFile(regionImagePath);

        const ocrResult = await worker.recognize(regionImagePath);

        pageRegions.push({
          regionIndex: regionIdx,
          position: position,
          text: ocrResult.data.text?.trim() || '',
          region: {
            position,
            pixels: cropRegion,
            percent: custom || getPositionPercent(position)
          }
        });

        try {
          await fs.unlink(regionImagePath);
        } catch (e) {}
      }

      // 清理页面图片
      try {
        await fs.unlink(pageImagePath);
      } catch (e) {}

      pageResults.push({
        page: pageNum,
        regions: pageRegions
      });

    } catch (e) {
      console.error(`第 ${pageNum} 页处理失败: ${e.message}`);
      pageResults.push({
        page: pageNum,
        regions: regions.map((r, idx) => ({
          regionIndex: idx,
          position: r.position,
          text: '',
          error: e.message
        }))
      });
    }
  }

  // 清理临时文件
  if (Buffer.isBuffer(input)) {
    try {
      await fs.unlink(filePath);
    } catch (e) {}
  }

  return {
    pages: totalPages,
    regions: regions,
    pageResults: pageResults
  };
}

/**
 * 保存 Buffer 到临时文件
 */
async function saveBufferToTemp(buffer) {
  const tempDir = path.join(process.cwd(), 'temp');
  await fs.mkdir(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `temp_${Date.now()}.pdf`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * 从 PDF 各页提取指定区域的文本（使用 pdftoppm）
 */
async function extractRegionFromPages(filePath, position, custom, lang) {
  const tempDir = path.join(process.cwd(), 'temp', 'ocr');
  await fs.mkdir(tempDir, { recursive: true });

  // 获取 PDF 页数
  const pdfInfo = await getPdfInfo(filePath);
  const totalPages = pdfInfo.pages;

  console.log(`PDF 共 ${totalPages} 页，开始区域提取...`);

  // 初始化 Tesseract worker
  const worker = await getTesseractWorker(lang);

  const pageResults = [];

  // 对于底部表格，使用更高分辨率
  const dpi = position === 'bottom-table' ? 300 : 150;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    console.log(`处理第 ${pageNum}/${totalPages} 页...`);

    try {
      // 使用 pdftoppm 将 PDF 页面转为图片
      const outputPath = path.join(tempDir, `page_${pageNum}`);
      await execFileAsync('pdftoppm', [
        '-png',
        '-r', String(dpi),
        '-f', String(pageNum),
        '-l', String(pageNum),
        filePath,
        outputPath
      ]);

      // pdftoppm 生成的文件名格式: page_1-01.png 或 page_1-1.png
      let pageImagePath = `${outputPath}-${String(pageNum).padStart(2, '0')}.png`;

      // 检查文件是否存在，尝试不同格式
      try {
        await fs.access(pageImagePath);
      } catch {
        // 尝试另一种格式
        pageImagePath = `${outputPath}-${pageNum}.png`;
        try {
          await fs.access(pageImagePath);
        } catch {
          throw new Error('PDF 页面转换失败');
        }
      }

      // 获取图片尺寸
      const meta = await sharp(pageImagePath).metadata();
      const width = meta.width;
      const height = meta.height;

      // 计算裁剪区域
      const cropRegion = calculateCropRegion(position, custom, width, height);
      console.log(`  裁剪区域: x=${cropRegion.left}, y=${cropRegion.top}, w=${cropRegion.width}, h=${cropRegion.height}`);

      // 裁剪图片
      const regionImagePath = path.join(tempDir, `region_${pageNum}_${Date.now()}.png`);
      await sharp(pageImagePath)
        .extract(cropRegion)
        .toFile(regionImagePath);

      // OCR 识别
      const ocrResult = await worker.recognize(regionImagePath);

      pageResults.push({
        page: pageNum,
        text: ocrResult.data.text?.trim() || '',
        region: {
          position,
          pixels: cropRegion,
          percent: custom || getPositionPercent(position)
        }
      });

      // 清理临时图片
      try {
        await fs.unlink(pageImagePath);
        await fs.unlink(regionImagePath);
      } catch (e) {}

    } catch (e) {
      console.error(`第 ${pageNum} 页处理失败: ${e.message}`);
      pageResults.push({
        page: pageNum,
        text: '',
        error: e.message
      });
    }
  }

  return {
    pages: totalPages,
    position: position,
    pageResults: pageResults,
    summary: pageResults.map(p => `第${p.page}页: ${p.text}`).join('\n')
  };
}

/**
 * 获取 PDF 信息
 */
async function getPdfInfo(filePath) {
  const dataBuffer = await fs.readFile(filePath);
  const data = await pdf(dataBuffer);
  return {
    pages: data.numpages,
    info: data.info
  };
}

/**
 * 计算 OCR 裁剪区域
 * @param {string} position - 预设位置
 * @param {object} custom - 自定义区域
 * @param {number} imageWidth - 图片宽度
 * @param {number} imageHeight - 图片高度
 * @param {object} margin - 边距（跳过边缘标记）百分比
 */
function calculateCropRegion(position, custom, imageWidth, imageHeight, margin = { top: 3, bottom: 3, left: 3, right: 3 }) {
  // 计算有效区域（去掉边缘标记）
  const effectiveLeft = Math.round(imageWidth * (margin.left || 0) / 100);
  const effectiveTop = Math.round(imageHeight * (margin.top || 0) / 100);
  const effectiveRight = Math.round(imageWidth * (100 - (margin.right || 0)) / 100);
  const effectiveBottom = Math.round(imageHeight * (100 - (margin.bottom || 0)) / 100);

  const effectiveWidth = effectiveRight - effectiveLeft;
  const effectiveHeight = effectiveBottom - effectiveTop;

  if (custom) {
    return {
      left: effectiveLeft + Math.round(custom.x * effectiveWidth / 100),
      top: effectiveTop + Math.round(custom.y * effectiveHeight / 100),
      width: Math.round(custom.width * effectiveWidth / 100),
      height: Math.round(custom.height * effectiveHeight / 100)
    };
  }

  const defaultWidthPercent = 30;
  const defaultHeightPercent = 20;

  const regionWidth = Math.round(effectiveWidth * defaultWidthPercent / 100);
  const regionHeight = Math.round(effectiveHeight * defaultHeightPercent / 100);

  switch (position) {
    case 'top-right':
      return {
        left: effectiveRight - regionWidth,
        top: effectiveTop,
        width: regionWidth,
        height: regionHeight
      };
    case 'top-left':
      return {
        left: effectiveLeft,
        top: effectiveTop,
        width: regionWidth,
        height: regionHeight
      };
    case 'bottom-right':
      return {
        left: effectiveRight - regionWidth,
        top: effectiveBottom - regionHeight,
        width: regionWidth,
        height: regionHeight
      };
    case 'bottom-left':
      return {
        left: effectiveLeft,
        top: effectiveBottom - regionHeight,
        width: regionWidth,
        height: regionHeight
      };
    case 'center':
      return {
        left: effectiveLeft + Math.round((effectiveWidth - regionWidth) / 2),
        top: effectiveTop + Math.round((effectiveHeight - regionHeight) / 2),
        width: regionWidth,
        height: regionHeight
      };
    case 'bottom-center':
      // 底部居中，宽度更大（70%），高度10%，紧贴底部，底部不截取边距
      const bottomMargin = { top: 3, bottom: 0, left: 3, right: 3 };
      const bcEffectiveLeft = Math.round(imageWidth * (bottomMargin.left || 0) / 100);
      const bcEffectiveTop = Math.round(imageHeight * (bottomMargin.top || 0) / 100);
      const bcEffectiveRight = Math.round(imageWidth * (100 - (bottomMargin.right || 0)) / 100);
      const bcEffectiveBottom = Math.round(imageHeight * (100 - (bottomMargin.bottom || 0)) / 100);
      const bcEffectiveWidth = bcEffectiveRight - bcEffectiveLeft;
      const bcEffectiveHeight = bcEffectiveBottom - bcEffectiveTop;

      const bottomCenterWidth = Math.round(bcEffectiveWidth * 70 / 100);
      const bottomCenterHeight = Math.round(bcEffectiveHeight * 10 / 100);
      return {
        left: bcEffectiveLeft + Math.round((bcEffectiveWidth - bottomCenterWidth) / 2),
        top: bcEffectiveBottom - bottomCenterHeight,
        width: bottomCenterWidth,
        height: bottomCenterHeight
      };
    case 'bottom-table':
      // 底部表格区域，提取完整表格区域（包含值行+表头行）
      const tableMargin = { top: 3, bottom: 0, left: 3, right: 3 };
      const tableEffectiveLeft = Math.round(imageWidth * (tableMargin.left || 0) / 100);
      const tableEffectiveTop = Math.round(imageHeight * (tableMargin.top || 0) / 100);
      const tableEffectiveRight = Math.round(imageWidth * (100 - (tableMargin.right || 0)) / 100);
      const tableEffectiveBottom = Math.round(imageHeight * (100 - (tableMargin.bottom || 0)) / 100);
      const tableEffectiveWidth = tableEffectiveRight - tableEffectiveLeft;
      const tableEffectiveHeight = tableEffectiveBottom - tableEffectiveTop;

      // 提取底部 12% 区域（包含表格）
      const tableWidth = Math.round(tableEffectiveWidth * 94 / 100);
      const tableHeight = Math.round(tableEffectiveHeight * 12 / 100);
      return {
        left: tableEffectiveLeft + Math.round((tableEffectiveWidth - tableWidth) / 2),
        top: tableEffectiveBottom - tableHeight,
        width: tableWidth,
        height: tableHeight
      };
    default:
      return {
        left: effectiveRight - regionWidth,
        top: effectiveTop,
        width: regionWidth,
        height: regionHeight
      };
  }
}

/**
 * 获取预设位置的百分比定义
 */
function getPositionPercent(position) {
  const defaults = { width: 30, height: 20 };

  switch (position) {
    case 'top-right':
      return { x: 70, y: 0, ...defaults };
    case 'top-left':
      return { x: 0, y: 0, ...defaults };
    case 'bottom-right':
      return { x: 70, y: 80, ...defaults };
    case 'bottom-left':
      return { x: 0, y: 80, ...defaults };
    case 'bottom-center':
      return { x: 15, y: 87, width: 70, height: 10 };
    case 'bottom-table':
      // 底部表格区域，提取完整表格区域
      return { x: 3, y: 88, width: 94, height: 12 };
    case 'center':
      return { x: 35, y: 40, ...defaults };
    default:
      return { x: 70, y: 0, ...defaults };
  }
}

/**
 * 解析表格文本为键值对（使用 PDF 原生文本）
 * 格式：管线号材料等级管道级别设计温度操作温度设计压力操作压力版次
 * 如：71-25-N7-UC4421-1A1N-N1A1NGC2704010.7A1
 * 期望输出：管线号=71-25-N7-UC4421-1A1N-N, 材料等级=1A1N, 管道级别=GC2, 设计温度=70, 操作温度=40, 设计压力=1, 操作压力=0.7, 版次=A1
 * @param {string} text - PDF 提取的文本
 * @returns {Array} - [{key: '管线号', value: '71-25-N7-UC4421-1A1N-N'}, ...]
 */
function parseTableText(text) {
  if (!text || !text.trim()) return [];

  // 固定的中文表头顺序（根据 demo.xlsx）
  const chineseHeaders = [
    '管线号', '材料等级', '管道级别', '设计温度', '操作温度',
    '设计压力', '操作压力', '保温类型', '保温厚度', '刷漆', '比例', '图号', '版次'
  ];

  // 搜索管线号模式（71-25-N7-UC4421-XXX-XXX）
  const lineNoPattern = /71-\d+-N7-UC\d+-[A-Z0-9]+-N/;
  const lineNoMatch = text.match(lineNoPattern);

  if (!lineNoMatch) return [];

  // 提取管线号
  const lineNo = lineNoMatch[0];

  // 找到管线号后的数据字符串
  // 例如: 1A1NGC2704010.7A1
  const afterLineNo = text.substring(lineNoMatch.index + lineNo.length);

  // 解析数据格式: 材料等级 + 管道级别 + 设计温度 + 操作温度 + 设计压力 + 操作压力 + 版次
  // 材料等级：字母数字组合，通常是4字符 (如 1A1N, 1A1L 等)
  // 优先匹配4字符模式，如果没有则匹配3字符模式
  let spec = '';
  const specMatch4 = afterLineNo.match(/^([A-Z]?\d[A-Z]\d[A-Z])/);
  if (specMatch4) {
    spec = specMatch4[1];
  } else {
    const specMatch3 = afterLineNo.match(/^([A-Z]?\d[A-Z]\d)/);
    if (specMatch3) {
      spec = specMatch3[1];
    }
  }

  // 管道级别：GC + 数字 (如 GC2)
  const remaining1 = afterLineNo.substring(spec.length);
  const gradeMatch = remaining1.match(/^GC\d/);
  const grade = gradeMatch ? gradeMatch[0] : '';

  // 设计温度：固定2位数字 (如 70)
  const remaining2 = remaining1.substring(grade.length);
  const desTmpMatch = remaining2.match(/^(\d{2})/);
  const desTmp = desTmpMatch ? desTmpMatch[1] : '';

  // 操作温度：固定2位数字 (如 40)
  const remaining3 = remaining2.substring(desTmp.length);
  const opeTmpMatch = remaining3.match(/^(\d{2})/);
  const opeTmp = opeTmpMatch ? opeTmpMatch[1] : '';

  // 设计压力：整数或小数 (如 1)
  // 操作压力：通常以0.开头的小数 (如 0.7)
  // 数据格式可能是: 10.7 (设计压力=1, 操作压力=0.7) 或 10.70.7 等
  const remaining4 = remaining3.substring(opeTmp.length);
  let desPr = '';
  let opePr = '';

  // 查找版次A的位置来确定压力字段边界
  const revPos = remaining4.indexOf('A');
  if (revPos > 0) {
    const pressurePart = remaining4.substring(0, revPos);

    // 尝试匹配格式：整数 + 0.X 小数 (如 10.7 → 设计压力=1, 操作压力=0.7)
    const pattern1 = pressurePart.match(/^(\d)0\.(\d+)$/);
    if (pattern1) {
      desPr = pattern1[1];
      opePr = '0.' + pattern1[2];
    } else {
      // 尝试匹配格式：整数 + 小数 (如 10.7 → 可能是设计压力=10, 操作压力=0.7)
      // 或者格式：两个数拼接 (如 1.0.7)
      const parts = pressurePart.split('.');
      if (parts.length >= 2) {
        // 第一个数字作为设计压力
        desPr = parts[0];
        // 剩余部分作为操作压力 (拼接回去)
        if (parts.length === 2) {
          // 如果只有两部分，需要判断
          // 如果第二部分以0开头，可能是操作压力的整数部分
          if (parts[1].startsWith('0')) {
            // 不太合理，可能是设计压力有小数
            desPr = pressurePart;
          } else {
            // parts[1]可能是操作压力的整数部分(如7)，需要加0.前缀
            opePr = '0.' + parts[1];
          }
        } else if (parts.length >= 3) {
          // 多个小数点，拼接中间部分
          opePr = '0.' + parts.slice(1).join('.');
        }
      } else {
        // 无小数点，全部作为设计压力
        desPr = pressurePart;
      }
    }
  }

  // 版次：字母+数字 (如 A1)
  const remaining6 = remaining4.substring(desPr.length + opePr.length);
  const revMatch = remaining6.match(/^A\d/);
  const rev = revMatch ? revMatch[0] : '';

  // 组合结果（保温类型、保温厚度、刷漆、比例、图号暂无数据）
  const values = [lineNo, spec, grade, desTmp, opeTmp, desPr, opePr, '', '', '', '', '', rev];

  const result = [];
  for (let i = 0; i < chineseHeaders.length; i++) {
    result.push({
      key: chineseHeaders[i],
      value: values[i] || ''
    });
  }

  return result;
}

/**
 * 使用 OCR 处理扫描版 PDF（全页识别）
 */
async function performOCR(filePath, lang = 'chi_sim+eng') {
  const pdfInfo = await getPdfInfo(filePath);
  const totalPages = pdfInfo.pages;

  console.log(`PDF 共 ${totalPages} 页，开始 OCR 识别...`);

  const worker = await getTesseractWorker(lang);
  const tempDir = path.join(process.cwd(), 'temp', 'ocr');
  await fs.mkdir(tempDir, { recursive: true });

  const pageTexts = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    console.log(`正在处理第 ${pageNum}/${totalPages} 页...`);

    try {
      const outputPath = path.join(tempDir, `fullpage_${pageNum}`);
      await execFileAsync('pdftoppm', [
        '-png',
        '-r', '150',
        '-f', String(pageNum),
        '-l', String(pageNum),
        filePath,
        outputPath
      ]);

      const pageImagePath = `${outputPath}-1.png`;

      const result = await worker.recognize(pageImagePath);
      pageTexts.push(result.data.text || '');

      // 清理
      try {
        await fs.unlink(pageImagePath);
      } catch (e) {}

    } catch (e) {
      console.error(`第 ${pageNum} 页处理失败: ${e.message}`);
      pageTexts.push('');
    }
  }

  return {
    text: pageTexts.join('\n\n'),
    pages: totalPages,
    pageTexts: pageTexts
  };
}

/**
 * 简单按页分割文本
 */
function splitTextByPages(text, totalPages) {
  const lines = text.split('\n');
  const linesPerPage = Math.ceil(lines.length / totalPages);
  const pages = [];

  for (let i = 0; i < totalPages; i++) {
    const start = i * linesPerPage;
    const end = start + linesPerPage;
    pages.push(lines.slice(start, end).join('\n'));
  }

  return pages;
}

export default pdfToText;

// 导出表格解析函数
export { parseTableText };