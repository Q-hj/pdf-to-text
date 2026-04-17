import { pdfToTextLight, parseTableText } from './lib.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    if (!buffer.length) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const result = await pdfToTextLight(buffer, { splitPages: true });
    const pageTextItems = result.pageTextItems || [];

    const pageTables = [];
    for (let i = 0; i < pageTextItems.length; i++) {
      const textItems = pageTextItems[i];
      const parsedData = parseTableText(textItems);
      const pageText = result.pageTexts ? result.pageTexts[i] : '';

      pageTables.push({
        page: i + 1,
        rawText: pageText.substring(0, 500),
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
    console.error('Bottom-table error:', error);
    res.status(500).json({ error: error.message });
  }
}