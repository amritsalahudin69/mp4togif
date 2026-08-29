const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createConfig } = require('../src/config');
const {
  isMp4,
  discoverMp4Files,
  mapWithConcurrency,
  runBatch,
} = require('../src/batch');
const { validateDuration, outputPathFor, buildGifFilter } = require('../src/converter');

test('config uses documented defaults', () => {
  const config = createConfig({}, '/project');
  assert.equal(config.inputDir, path.resolve('/project/input'));
  assert.equal(config.outputDir, path.resolve('/project/output'));
  assert.equal(config.maxDurationSeconds, 20);
  assert.equal(config.gifFps, 15);
  assert.equal(config.keepOriginalDimensions, true);
  assert.equal(config.chromaEnabled, false);
  assert.equal(config.chromaColor, '00FF00');
  assert.equal(config.chromaSimilarity, 0.18);
  assert.equal(config.chromaBlend, 0.05);
  assert.equal(config.concurrency, 2);
  assert.equal(config.existingOutput, 'skip');
});

test('concurrency accepts positive integers and rejects malformed values', () => {
  for (const value of ['1', '2', '4']) {
    assert.equal(createConfig({ CONCURRENCY: value }).concurrency, Number(value));
  }
  for (const value of ['0', '-1', '1.5', 'abc']) {
    assert.throws(() => createConfig({ CONCURRENCY: value }),
      /CONCURRENCY must be a positive integer/);
  }
});

test('existing output policy accepts only skip and overwrite', () => {
  assert.equal(createConfig({ EXISTING_OUTPUT: 'skip' }).existingOutput, 'skip');
  assert.equal(createConfig({ EXISTING_OUTPUT: 'overwrite' }).existingOutput, 'overwrite');
  for (const value of ['delete', 'replace', 'true']) {
    assert.throws(() => createConfig({ EXISTING_OUTPUT: value }),
      /EXISTING_OUTPUT must be skip or overwrite/);
  }
});

test('chroma config accepts enabled mode and normalizes supported colors', () => {
  assert.equal(createConfig({ CHROMA_ENABLED: 'true' }).chromaEnabled, true);
  assert.equal(createConfig({ CHROMA_COLOR: '00ff00' }).chromaColor, '00FF00');
  assert.equal(createConfig({ CHROMA_COLOR: '#ff00ff' }).chromaColor, 'FF00FF');
  assert.equal(createConfig({ CHROMA_COLOR: '0x0000ff' }).chromaColor, '0000FF');
});

test('chroma config rejects malformed colors', () => {
  for (const value of ['ZZZZZZ', '12345', '1234567', 'GGFF00']) {
    assert.throws(() => createConfig({ CHROMA_COLOR: value }),
      /CHROMA_COLOR must be a six-digit RGB hex color/);
  }
});

test('chroma similarity and blend accept boundaries and reject out-of-range values', () => {
  assert.equal(createConfig({ CHROMA_SIMILARITY: '0' }).chromaSimilarity, 0);
  assert.equal(createConfig({ CHROMA_SIMILARITY: '1' }).chromaSimilarity, 1);
  assert.equal(createConfig({ CHROMA_BLEND: '0' }).chromaBlend, 0);
  assert.equal(createConfig({ CHROMA_BLEND: '1' }).chromaBlend, 1);

  for (const [name, value] of [
    ['CHROMA_SIMILARITY', '-0.01'],
    ['CHROMA_SIMILARITY', '1.01'],
    ['CHROMA_SIMILARITY', 'nope'],
    ['CHROMA_BLEND', '-0.01'],
    ['CHROMA_BLEND', '1.01'],
    ['CHROMA_BLEND', 'nope'],
  ]) {
    assert.throws(() => createConfig({ [name]: value }),
      new RegExp(`${name} must be a number between 0 and 1`));
  }
});

test('config rejects invalid numeric values', () => {
  for (const value of ['abc', '0', '-10']) {
    assert.throws(() => createConfig({ MAX_DURATION_SECONDS: value }),
      /MAX_DURATION_SECONDS must be a number greater than 0/);
  }
  assert.throws(() => createConfig({ GIF_FPS: '0' }),
    /GIF_FPS must be a number greater than 0/);
});

test('MP4 recognition is case-insensitive and excludes other files', () => {
  assert.equal(isMp4('clip.mp4'), true);
  assert.equal(isMp4('VIDEO.MP4'), true);
  assert.equal(isMp4('Demo.Mp4'), true);
  assert.equal(isMp4('video.mov'), false);
  assert.equal(isMp4('notes.txt'), false);
});

test('duration validation includes the configured boundary', () => {
  assert.equal(validateDuration(20, 20), true);
  assert.equal(validateDuration(20.01, 20), false);
});

test('output filename preserves the source basename', () => {
  assert.equal(outputPathFor('/input/intro.mp4', '/output'), '/output/intro.gif');
});

test('GIF filter uses FPS and a palette pipeline without scaling', () => {
  const filter = buildGifFilter(15);
  assert.match(filter, /fps=15/);
  assert.match(filter, /palettegen/);
  assert.match(filter, /paletteuse/);
  assert.doesNotMatch(filter, /scale/);
  assert.doesNotMatch(filter, /colorkey/);
});

test('chroma-enabled GIF filter keys color before a transparency-aware palette', () => {
  const filter = buildGifFilter(15, {
    enabled: true,
    color: '00FF00',
    similarity: 0.18,
    blend: 0.05,
  });
  assert.match(filter, /fps=15,format=rgba,colorkey=0x00FF00:0\.18:0\.05/);
  assert.match(filter, /palettegen=.*reserve_transparent=1/);
  assert.match(filter, /paletteuse=.*alpha_threshold=128/);
  assert.doesNotMatch(filter, /scale/);
});

test('discovery returns top-level MP4 files in deterministic natural order', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp4togif-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(root, 'clip10.MP4'), ''),
    fs.writeFile(path.join(root, 'clip2.mp4'), ''),
    fs.writeFile(path.join(root, 'clip1.mp4'), ''),
    fs.writeFile(path.join(root, 'clip3.mp4'), ''),
    fs.writeFile(path.join(root, 'ignore.mov'), ''),
    fs.mkdir(path.join(root, 'nested')),
  ]);
  await fs.writeFile(path.join(root, 'nested', 'hidden.mp4'), '');
  assert.deepEqual(await discoverMp4Files(root), [
    'clip1.mp4', 'clip2.mp4', 'clip3.mp4', 'clip10.MP4',
  ]);
});

test('concurrency helper never exceeds its configured limit', async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return item * 2;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('empty input is a valid batch result', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp4togif-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const messages = [];
  const result = await runBatch({
    inputDir: path.join(root, 'input'),
    outputDir: path.join(root, 'output'),
    maxDurationSeconds: 20,
    gifFps: 15,
    chromaEnabled: false,
    concurrency: 2,
    existingOutput: 'skip',
  }, { log: (message) => messages.push(message) });
  assert.deepEqual(result, { found: 0, success: 0, skipped: 0, failed: 0 });
  assert.ok(messages.includes('No MP4 files found.'));
});

test('concurrent batch continues after failure and accounts for every file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp4togif-isolation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const converted = [];
  const config = {
    inputDir: path.join(root, 'input'),
    outputDir: path.join(root, 'output'),
    maxDurationSeconds: 20,
    gifFps: 15,
    chromaEnabled: false,
    concurrency: 2,
    existingOutput: 'overwrite',
  };
  const result = await runBatch(config, {
    discover: async () => ['bad.mp4', 'good.mp4'],
    probe: async (file) => {
      if (file.endsWith('bad.mp4')) throw new Error('ffprobe failed');
      return { duration: 2, width: 320, height: 240 };
    },
    convert: async (input) => converted.push(path.basename(input)),
    log: () => {},
  });
  assert.deepEqual(result, { found: 2, success: 1, skipped: 0, failed: 1 });
  assert.deepEqual(converted, ['good.mp4']);
});

test('existing output skip avoids probe and conversion', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp4togif-skip-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'output');
  await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, 'done.gif'), 'existing');
  let probes = 0;
  let conversions = 0;
  const result = await runBatch({
    inputDir: path.join(root, 'input'),
    outputDir,
    maxDurationSeconds: 20,
    gifFps: 15,
    chromaEnabled: false,
    concurrency: 2,
    existingOutput: 'skip',
  }, {
    discover: async () => ['done.mp4'],
    probe: async () => { probes += 1; },
    convert: async () => { conversions += 1; },
    log: () => {},
  });
  assert.deepEqual(result, { found: 1, success: 0, skipped: 1, failed: 0 });
  assert.equal(probes, 0);
  assert.equal(conversions, 0);
});

test('overwrite policy converts when output exists', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp4togif-overwrite-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'output');
  await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, 'done.gif'), 'existing');
  let conversions = 0;
  const result = await runBatch({
    inputDir: path.join(root, 'input'),
    outputDir,
    maxDurationSeconds: 20,
    gifFps: 15,
    chromaEnabled: false,
    concurrency: 1,
    existingOutput: 'overwrite',
  }, {
    discover: async () => ['done.mp4'],
    probe: async () => ({ duration: 1, width: 64, height: 48 }),
    convert: async () => { conversions += 1; },
    log: () => {},
  });
  assert.deepEqual(result, { found: 1, success: 1, skipped: 0, failed: 0 });
  assert.equal(conversions, 1);
});
