import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const externalModules = [
  'canvas',
  'sharp',
  'pdf2pic',
  'tesseract.js',
  'exceljs',
  'express',
  'multer',
  'pdf-parse',
  'pdfjs-dist'
];

async function build() {
  console.log('Building PDF-to-Text...');

  // Build server (ESM format)
  console.log('Building server...');
  await esbuild.build({
    entryPoints: [join(__dirname, '../src/server.js')],
    bundle: true,
    platform: 'node',
    outfile: join(__dirname, '../dist/server.mjs'),
    format: 'esm',
    external: externalModules,
    minify: false,
    sourcemap: true
  });

  // Build CLI (ESM format)
  console.log('Building CLI...');
  await esbuild.build({
    entryPoints: [join(__dirname, '../src/cli.js')],
    bundle: true,
    platform: 'node',
    outfile: join(__dirname, '../dist/cli.mjs'),
    format: 'esm',
    external: externalModules,
    minify: false,
    sourcemap: true
  });

  // Copy public folder
  console.log('Copying public folder...');
  const publicSrc = join(__dirname, '../public');
  const publicDest = join(__dirname, '../dist/public');
  copyFolder(publicSrc, publicDest);

  // Create package.json for dist
  console.log('Creating dist package.json...');
  const distPackage = {
    name: 'pdf-to-text-dist',
    version: '1.0.0',
    type: 'module',
    main: 'server.mjs',
    bin: {
      'pdf2text': './cli.mjs'
    },
    scripts: {
      start: 'node server.mjs'
    }
  };

  import('fs').then(fs => fs.writeFileSync(
    join(__dirname, '../dist/package.json'),
    JSON.stringify(distPackage, null, 2)
  ));

  console.log('Build complete!');
  console.log('Output: dist/');
  console.log('  - server.mjs  (Web server)');
  console.log('  - cli.mjs     (CLI tool)');
  console.log('  - public/     (Web UI)');
}

function copyFolder(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      copyFolder(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});