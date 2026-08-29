const path = require('node:path');
const dotenv = require('dotenv');

const DEFAULTS = Object.freeze({
  INPUT_DIR: './input',
  OUTPUT_DIR: './output',
  MAX_DURATION_SECONDS: '20',
  GIF_FPS: '15',
  KEEP_ORIGINAL_DIMENSIONS: 'true',
  CHROMA_ENABLED: 'false',
  CHROMA_COLOR: '00FF00',
  CHROMA_SIMILARITY: '0.18',
  CHROMA_BLEND: '0.05',
  CONCURRENCY: '2',
  EXISTING_OUTPUT: 'skip',
});

function parsePositiveNumber(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a number greater than 0 (received: ${value})`);
  }
  return number;
}

function parseBoolean(name, value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false (received: ${value})`);
}

function parsePositiveInteger(name, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer (received: ${value})`);
  }
  return number;
}

function parseExistingOutput(value) {
  if (value === 'skip' || value === 'overwrite') return value;
  throw new Error(`EXISTING_OUTPUT must be skip or overwrite (received: ${value})`);
}

function parseUnitInterval(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${name} must be a number between 0 and 1 (received: ${value})`);
  }
  return number;
}

function parseHexColor(value) {
  const normalized = String(value).replace(/^(#|0x)/i, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(normalized)) {
    throw new Error(`CHROMA_COLOR must be a six-digit RGB hex color (received: ${value})`);
  }
  return normalized;
}

function createConfig(env = {}, cwd = process.cwd()) {
  const values = { ...DEFAULTS, ...env };
  return {
    inputDir: path.resolve(cwd, values.INPUT_DIR),
    outputDir: path.resolve(cwd, values.OUTPUT_DIR),
    maxDurationSeconds: parsePositiveNumber(
      'MAX_DURATION_SECONDS',
      values.MAX_DURATION_SECONDS,
    ),
    gifFps: parsePositiveNumber('GIF_FPS', values.GIF_FPS),
    keepOriginalDimensions: parseBoolean(
      'KEEP_ORIGINAL_DIMENSIONS',
      values.KEEP_ORIGINAL_DIMENSIONS,
    ),
    chromaEnabled: parseBoolean('CHROMA_ENABLED', values.CHROMA_ENABLED),
    chromaColor: parseHexColor(values.CHROMA_COLOR),
    chromaSimilarity: parseUnitInterval(
      'CHROMA_SIMILARITY',
      values.CHROMA_SIMILARITY,
    ),
    chromaBlend: parseUnitInterval('CHROMA_BLEND', values.CHROMA_BLEND),
    concurrency: parsePositiveInteger('CONCURRENCY', values.CONCURRENCY),
    existingOutput: parseExistingOutput(values.EXISTING_OUTPUT),
  };
}

function loadConfig(cwd = process.cwd()) {
  const result = dotenv.config({ path: path.join(cwd, '.env'), quiet: true });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error(`Unable to read .env: ${result.error.message}`);
  }
  return createConfig(process.env, cwd);
}

module.exports = {
  DEFAULTS,
  createConfig,
  loadConfig,
  parseHexColor,
  parseUnitInterval,
  parsePositiveInteger,
  parseExistingOutput,
};
