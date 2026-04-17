#!/usr/bin/env node

import { pdfToText } from './index.js';
import fs from 'fs/promises';
import path from 'path';

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
PDF to Text Converter

用法:
  pdf2text <pdf文件路径> [输出文件路径]
  pdf2text --help

选项:
  -h, --help     显示帮助信息
  -o, --output   指定输出文件路径（可选）
  -p, --pages    按页分割输出

示例:
  pdf2text document.pdf                   # 输出到控制台
  pdf2text document.pdf output.txt        # 输出到文件
  pdf2text document.pdf -p                # 按页显示
`);
}

async function main() {
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  const pdfPath = args.find(arg => !arg.startsWith('-'));
  const outputPath = args.find(arg => arg.startsWith('-o'))?.split('=')[1]
    || args.find(arg => !arg.startsWith('-') && arg !== pdfPath);
  const splitPages = args.includes('-p') || args.includes('--pages');

  if (!pdfPath) {
    console.error('错误: 请指定 PDF 文件路径');
    process.exit(1);
  }

  try {
    console.log(`正在处理: ${pdfPath}`);
    const result = await pdfToText(pdfPath, { splitPages });

    if (splitPages && result.pageTexts) {
      console.log(`\n共 ${result.pages} 页:\n`);
      result.pageTexts.forEach((text, i) => {
        console.log(`--- 第 ${i + 1} 页 ---`);
        console.log(text);
      });
    } else {
      console.log(`\n共 ${result.pages} 页\n`);
      console.log(result.text);
    }

    if (outputPath) {
      const content = splitPages
        ? result.pageTexts.map((t, i) => `--- 第 ${i + 1} 页 ---\n${t}`).join('\n\n')
        : result.text;
      await fs.writeFile(outputPath, content, 'utf-8');
      console.log(`\n文本已保存到: ${outputPath}`);
    }

    console.log('\n元数据:');
    console.log(`  版本: ${result.metadata.version}`);
    if (result.metadata.info) {
      console.log(`  标题: ${result.metadata.info.Title || '未知'}`);
      console.log(`  作者: ${result.metadata.info.Author || '未知'}`);
    }

  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
}

main();