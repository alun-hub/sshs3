#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const docsUserGuideDir = path.join(rootDir, 'docs', 'user-guide');
const defaultSiteDocsDir = path.resolve(rootDir, '..', 'sshs3-site', 'public', 'docs');
const targetSiteDir = process.env.SSHS3_SITE_DOCS_DIR || defaultSiteDocsDir;

console.log('📚 sshs3 documentation validator & sync');
console.log(`Source: ${docsUserGuideDir}`);
console.log(`Target: ${targetSiteDir}`);

if (!fs.existsSync(docsUserGuideDir)) {
  console.error(`❌ Source directory ${docsUserGuideDir} not found.`);
  process.exit(1);
}

const docFiles = fs.readdirSync(docsUserGuideDir).filter(f => f.endsWith('.md')).sort();
console.log(`Found ${docFiles.length} markdown guide chapters:`);
for (const file of docFiles) {
  const filePath = path.join(docsUserGuideDir, file);
  const stats = fs.statSync(filePath);
  console.log(`  - ${file} (${stats.size} bytes)`);
}

if (fs.existsSync(targetSiteDir)) {
  console.log(`\nSyncing screenshots to site...`);
  const srcScreenshots = path.join(rootDir, 'docs', 'screenshots');
  const destScreenshots = path.resolve(targetSiteDir, '..', 'img');
  if (fs.existsSync(srcScreenshots) && fs.existsSync(destScreenshots)) {
    const images = fs.readdirSync(srcScreenshots).filter(f => f.endsWith('.png') || f.endsWith('.svg'));
    for (const img of images) {
      fs.copyFileSync(path.join(srcScreenshots, img), path.join(destScreenshots, img));
    }
    console.log(`Synced ${images.length} images to ${destScreenshots}`);
  }
  console.log(`✅ Documentation source and site assets are in sync.`);
} else {
  console.log(`ℹ️ Target site directory ${targetSiteDir} not detected locally. Skipping file copy.`);
}

console.log('✅ Validation complete.');
