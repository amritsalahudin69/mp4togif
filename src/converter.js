const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function commandError(command, error) {
  const detail = error.stderr?.trim() || error.message;
  return new Error(`${command} failed: ${detail}`);
}

async function probeVideo(inputPath, run = execFileAsync) {
  let stdout;
  try {
    ({ stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      inputPath,
    ]));
  } catch (error) {
    throw commandError('ffprobe', error);
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('ffprobe returned invalid metadata');
  }

  const stream = data.streams?.[0];
  const metadata = {
    duration: Number(data.format?.duration),
    width: Number(stream?.width),
    height: Number(stream?.height),
  };

  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
    throw new Error('video duration must be greater than 0');
  }
  if (!Number.isInteger(metadata.width) || metadata.width <= 0 ||
      !Number.isInteger(metadata.height) || metadata.height <= 0) {
    throw new Error('video width and height must be greater than 0');
  }

  return metadata;
}

function validateDuration(duration, maximum) {
  return duration <= maximum;
}

function outputPathFor(inputPath, outputDir) {
  return path.join(outputDir, `${path.parse(inputPath).name}.gif`);
}

function buildGifFilter(fps, chroma = { enabled: false }) {
  if (chroma.enabled) {
    const keyedFrames = `fps=${fps},format=rgba,` +
      `colorkey=0x${chroma.color}:${chroma.similarity}:${chroma.blend}`;
    return `${keyedFrames},split[frames][paletteInput];` +
      '[paletteInput]palettegen=stats_mode=full:reserve_transparent=1[palette];' +
      '[frames][palette]paletteuse=dither=sierra2_4a:alpha_threshold=128';
  }

  return `fps=${fps},split[frames][paletteInput];` +
    '[paletteInput]palettegen=stats_mode=full[palette];' +
    '[frames][palette]paletteuse=dither=sierra2_4a';
}

async function convertToGif(inputPath, outputPath, config, run = execFileAsync) {
  // No scale filter is added: source dimensions and aspect ratio are preserved.
  const args = [
    '-v', 'error',
    '-y',
    '-i', inputPath,
    '-an',
    '-filter_complex', buildGifFilter(config.gifFps, {
      enabled: config.chromaEnabled,
      color: config.chromaColor,
      similarity: config.chromaSimilarity,
      blend: config.chromaBlend,
    }),
    '-loop', '0',
    outputPath,
  ];

  try {
    await run('ffmpeg', args);
  } catch (error) {
    throw commandError('ffmpeg', error);
  }
}

module.exports = {
  probeVideo,
  validateDuration,
  outputPathFor,
  buildGifFilter,
  convertToGif,
};
