# MP4 to GIF Batch Converter

Minimal Node.js CLI for converting every MP4 file in `input/` to a GIF in
`output/`. Files use controlled concurrency, and one failed file does not stop
the rest of the batch.

## Requirements

- Node.js
- npm
- FFmpeg
- ffprobe
- WSL-compatible shell

FFmpeg and ffprobe must already be available in `PATH`.

## Setup

```bash
npm install
```

## Run

Place videos in `input/`, then run:

```bash
npm run batch
```

Generated GIFs are written to `output/` with the original basename.

## Configuration

The CLI works without a `.env` file. Copy `.env.example` to `.env` only when
you want to override these defaults:

```env
INPUT_DIR=./input
OUTPUT_DIR=./output
MAX_DURATION_SECONDS=20
GIF_FPS=15
KEEP_ORIGINAL_DIMENSIONS=true
CHROMA_ENABLED=false
CHROMA_COLOR=00FF00
CHROMA_SIMILARITY=0.18
CHROMA_BLEND=0.05
CONCURRENCY=2
EXISTING_OUTPUT=skip
```

With `KEEP_ORIGINAL_DIMENSIONS=true`, no resize filter is applied. GIFs retain
the source width and height, so high-resolution output files can be large.

Chroma keying is disabled by default, preserving the normal GIF conversion.
Set `CHROMA_ENABLED=true` to make the configured six-digit RGB
`CHROMA_COLOR` transparent. `CHROMA_SIMILARITY` controls the accepted color
distance and `CHROMA_BLEND` softens the keyed edge; both accept values from
`0` to `1`. GIF transparency is binary palette transparency.

`CONCURRENCY` limits simultaneous conversion jobs and must be a positive
integer. The default is `2`; use `1` for sequential operation.
`EXISTING_OUTPUT=skip` avoids probing or converting files whose GIF already
exists. Set it to `overwrite` to replace existing GIFs non-interactively.

Files are discovered in natural order (`clip2.mp4` before `clip10.mp4`). The
CLI exits non-zero after completing the full queue if any individual file
failed; success-only, skipped-only, and empty batches exit zero.

## Tests

```bash
npm test
```
