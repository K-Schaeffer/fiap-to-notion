import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { StateSubject } from '../state/types';

const VIDEOS_DIR = path.join(process.cwd(), 'data', 'videos');

/**
 * Validates that ffmpeg is available on PATH.
 * Call once at the start of converter flow — fails fast with a clear message.
 */
export function assertFfmpegAvailable(): void {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'ffmpeg is not installed or not on PATH. Install it (e.g. `sudo apt install ffmpeg` or `brew install ffmpeg`) and try again.',
    );
  }
}

/** Replaces filesystem-unsafe characters with underscores and trims whitespace. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns the absolute path where a converted video should be stored. */
export function getVideoOutputPath(
  phaseTitle: string,
  subjectTitle: string,
  classTitle: string,
  videoTitle: string,
): string {
  return path.join(
    VIDEOS_DIR,
    sanitizeFilename(phaseTitle),
    sanitizeFilename(subjectTitle),
    sanitizeFilename(classTitle),
    `${sanitizeFilename(videoTitle)}.mp4`,
  );
}

/**
 * Parses ffmpeg's `time=HH:MM:SS.xx` progress token from a stderr chunk.
 * Returns the timestamp string or null if not found.
 */
function parseTimeProgress(chunk: string): string | null {
  const match = chunk.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
  return match ? match[1] : null;
}

/**
 * Downloads an HLS stream and remuxes it to MP4 via ffmpeg.
 * Uses `-c copy` (no re-encoding) and `-movflags +faststart` for streaming-friendly output.
 * `-y` overwrites partial files from interrupted previous runs.
 */
function downloadVideo(
  hlsUrl: string,
  outputPath: string,
  onProgress?: (time: string) => void,
): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      ['-y', '-i', hlsUrl, '-c', 'copy', '-movflags', '+faststart', outputPath],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      const time = parseTimeProgress(text);
      if (time) onProgress?.(time);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-500)}`));
      }
    });

    proc.on('error', reject);
  });
}

export interface ConvertVideoResult {
  classTitle: string;
  videoTitle: string;
}

export interface ConvertProgress {
  videoTitle: string;
  /** Current position in HH:MM:SS.xx format */
  time: string;
}

/**
 * Downloads all unconverted videos for a phase in parallel.
 * Since `-c copy` only does network I/O and remuxing, parallelism is bounded by bandwidth, not CPU.
 */
export async function convertPhaseVideos(
  phaseTitle: string,
  subjects: StateSubject[],
  options?: {
    onVideoDone?: (result: ConvertVideoResult) => void;
    onProgress?: (progress: ConvertProgress) => void;
  },
): Promise<number> {
  const { onVideoDone, onProgress } = options ?? {};

  const tasks = subjects.flatMap((subject) =>
    subject.classes.flatMap((cls) =>
      cls.videos
        .filter((video) => !video.converted)
        .map((video) => async () => {
          const outputPath = getVideoOutputPath(phaseTitle, subject.title, cls.title, video.title);
          await downloadVideo(video.hlsUrl, outputPath, (time) =>
            onProgress?.({ videoTitle: video.title, time }),
          );
          onVideoDone?.({ classTitle: cls.title, videoTitle: video.title });
        }),
    ),
  );

  const concurrency = process.env.FFMPEG_CONCURRENCY
    ? parseInt(process.env.FFMPEG_CONCURRENCY, 10)
    : 0;

  if (concurrency > 0) {
    for (let i = 0; i < tasks.length; i += concurrency) {
      await Promise.all(tasks.slice(i, i + concurrency).map((task) => task()));
    }
  } else {
    await Promise.all(tasks.map((task) => task()));
  }

  return tasks.length;
}
