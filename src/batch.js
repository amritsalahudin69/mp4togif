const fs = require('node:fs/promises');
const path = require('node:path');
const { loadConfig } = require('./config');
const {
  probeVideo,
  validateDuration,
  outputPathFor,
  convertToGif,
} = require('./converter');

function isMp4(filename) {
  return path.extname(filename).toLowerCase() === '.mp4';
}

async function discoverMp4Files(inputDir) {
  await fs.mkdir(inputDir, { recursive: true });
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isMp4(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) =>
      left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }) ||
      left.localeCompare(right, 'en', { numeric: true }));
}

function displayPath(target, cwd = process.cwd()) {
  const relative = path.relative(cwd, target);
  return relative && !relative.startsWith('..') ? relative : target;
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function runBatch(config, dependencies = {}) {
  const probe = dependencies.probe || probeVideo;
  const convert = dependencies.convert || convertToGif;
  const discover = dependencies.discover || discoverMp4Files;
  const exists = dependencies.exists || fileExists;
  const log = dependencies.log || console.log;

  await fs.mkdir(config.outputDir, { recursive: true });
  const files = await discover(config.inputDir);
  const summary = { found: files.length, success: 0, skipped: 0, failed: 0 };

  log('MP4 → GIF Batch Converter');
  log('');
  log(`Input : ${displayPath(config.inputDir)}`);
  log(`Output: ${displayPath(config.outputDir)}`);
  log(`Chroma: ${config.chromaEnabled ? 'enabled' : 'disabled'}`);
  if (config.chromaEnabled) log(`Color : #${config.chromaColor}`);
  log(`Jobs  : ${config.concurrency}`);
  log(`Existing output: ${config.existingOutput}`);
  log('');
  log(`Found ${files.length} MP4 file${files.length === 1 ? '' : 's'}`);

  if (files.length === 0) {
    log('No MP4 files found.');
  }

  const results = await mapWithConcurrency(files, config.concurrency, async (filename, index) => {
    const inputPath = path.join(config.inputDir, filename);
    const outputPath = outputPathFor(inputPath, config.outputDir);
    const lines = [`\n[${index + 1}/${files.length}] ${filename}`];

    try {
      if (config.existingOutput === 'skip' && await exists(outputPath)) {
        lines.push('      Status   : SKIPPED');
        lines.push('      Reason   : output already exists');
        return { status: 'skipped', lines };
      }

      const metadata = await probe(inputPath);
      lines.push(`      Duration : ${metadata.duration.toFixed(2)}s`);
      lines.push(`      Size     : ${metadata.width}x${metadata.height}`);

      if (!validateDuration(metadata.duration, config.maxDurationSeconds)) {
        lines.push('      Status   : SKIPPED');
        lines.push(`      Reason   : duration exceeds ${config.maxDurationSeconds} seconds`);
        return { status: 'skipped', lines };
      }

      await convert(inputPath, outputPath, config);
      lines.push('      Convert  : OK');
      lines.push(`      Output   : ${displayPath(outputPath)}`);
      return { status: 'success', lines };
    } catch (error) {
      lines.push('      Status   : FAILED');
      lines.push(`      Reason   : ${error.message}`);
      return { status: 'failed', lines };
    }
  });

  for (const result of results) {
    summary[result.status] += 1;
    for (const line of result.lines) log(line);
  }

  log('\n--------------------------------');
  log(`Found   : ${summary.found}`);
  log(`Success : ${summary.success}`);
  log(`Skipped : ${summary.skipped}`);
  log(`Failed  : ${summary.failed}`);
  log('--------------------------------');
  return summary;
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`Configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const summary = await runBatch(config);
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`Batch error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  isMp4,
  discoverMp4Files,
  fileExists,
  mapWithConcurrency,
  runBatch,
};
