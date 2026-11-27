import { DirectorFps, DirectorRecordingResult, DirectorVideoFormat } from '../types/cosmos';

export interface VideoRecorderStartOptions {
  canvas: HTMLCanvasElement;
  format: DirectorVideoFormat;
  fps: DirectorFps;
  width: number;
  height: number;
  filenamePrefix: string;
  audioStream?: MediaStream | null;
}

export interface VideoRecorderStartResult {
  actualFormat: DirectorVideoFormat;
  fallbackFrom?: DirectorVideoFormat;
}

export function isVideoRecordingSupported(): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & {
    captureStream?: (frameRate?: number) => MediaStream;
  };
  return typeof proto.captureStream === 'function';
}

export const isWebMRecordingSupported = isVideoRecordingSupported;

function getCodecCandidates(
  format: DirectorVideoFormat,
  withAudio: boolean,
  width: number,
  fps: number
): string[] {
  if (format === 'mp4') {
    const needsLevel42 = width >= 1900 && fps >= 60;
    if (withAudio) {
      const base = [
        'video/mp4;codecs=avc1.640028,mp4a.40.2',
        'video/mp4;codecs=avc1.4D4028,mp4a.40.2',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=h264,aac',
        'video/mp4;codecs=avc1.42E01E,opus',
        'video/mp4',
      ];
      return needsLevel42
        ? ['video/mp4;codecs=avc1.64002A,mp4a.40.2', 'video/mp4;codecs=avc1.4D402A,mp4a.40.2', ...base]
        : ['video/mp4;codecs=avc1.64002A,mp4a.40.2', ...base];
    }
    const base = [
      'video/mp4;codecs=avc1.640028',
      'video/mp4;codecs=avc1.4D4028',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=h264',
      'video/mp4',
    ];
    return needsLevel42
      ? ['video/mp4;codecs=avc1.64002A', 'video/mp4;codecs=avc1.4D402A', ...base]
      : ['video/mp4;codecs=avc1.64002A', ...base];
  }

  return withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
}

export function isMp4RecordingSupported(withAudio = false): boolean {
  if (!isVideoRecordingSupported() || typeof MediaRecorder.isTypeSupported !== 'function') {
    return false;
  }
  return getCodecCandidates('mp4', withAudio, 1280, 30).some((m) =>
    MediaRecorder.isTypeSupported(m)
  );
}

function buildOrderedCandidates(
  preferredFormat: DirectorVideoFormat,
  withAudio: boolean,
  width: number,
  fps: number
): string[] {
  const canCheck = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
  const alternateFormat: DirectorVideoFormat = preferredFormat === 'mp4' ? 'webm' : 'mp4';

  const preferredList = getCodecCandidates(preferredFormat, withAudio, width, fps);
  const alternateList = getCodecCandidates(alternateFormat, withAudio, width, fps);

  const filterSupported = (list: string[]) =>
    canCheck ? list.filter((m) => MediaRecorder.isTypeSupported(m)) : list;

  const candidates = [...filterSupported(preferredList), ...filterSupported(alternateList), ''];
  return Array.from(new Set(candidates));
}

function triggerVideoDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/**
 * Clean WebGL canvas video recorder using captureStream() + MediaRecorder.
 * Prioritizes native H.264 MP4 when requested (with seamless WebM fallback if the
 * browser lacks H.264 MediaRecorder support). Because HUD panels live in the
 * sibling React DOM overlay rather than WebGL, exported clips contain zero UI.
 */
export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startMs = 0;
  private activeMeta: {
    fps: DirectorFps;
    width: number;
    height: number;
    mimeType: string;
    format: DirectorVideoFormat;
    fallbackFrom?: DirectorVideoFormat;
    filename: string;
  } | null = null;
  private stopPromise: Promise<DirectorRecordingResult | null> | null = null;
  private resolveStop: ((res: DirectorRecordingResult | null) => void) | null = null;
  private aborted = false;

  public isRecording(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive';
  }

  public getElapsedSec(): number {
    if (!this.isRecording()) return 0;
    return Math.max(0, (performance.now() - this.startMs) / 1000);
  }

  public start(options: VideoRecorderStartOptions): VideoRecorderStartResult {
    if (this.isRecording()) {
      throw new Error('当前已在录制中');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('当前浏览器不支持 MediaRecorder 视频录制');
    }

    const canvasWithCapture = options.canvas as HTMLCanvasElement & {
      captureStream?: (frameRate?: number) => MediaStream;
    };
    if (typeof canvasWithCapture.captureStream !== 'function') {
      throw new Error('当前浏览器不支持 canvas.captureStream() 画布采流');
    }

    const videoStream = canvasWithCapture.captureStream(options.fps);
    const combinedTracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

    // Clone incoming audio tracks so stopping this recorder never kills CosmosAudio's node graph
    const clonedAudioTracks: MediaStreamTrack[] = [];
    if (options.audioStream) {
      for (const track of options.audioStream.getAudioTracks()) {
        if (track.readyState === 'live') {
          const cloned = track.clone();
          clonedAudioTracks.push(cloned);
          combinedTracks.push(cloned);
        }
      }
    }

    const combinedStream = new MediaStream(combinedTracks);
    const videoBitsPerSecond =
      options.width >= 1900
        ? options.fps >= 60
          ? 16_000_000
          : 12_000_000
        : options.fps >= 60
          ? 10_000_000
          : 8_000_000;

    const candidates = buildOrderedCandidates(
      options.format,
      clonedAudioTracks.length > 0,
      options.width,
      options.fps
    );

    let recorder: MediaRecorder | null = null;
    let chosenMime = '';
    let lastError: unknown = null;

    for (const mime of candidates) {
      try {
        const opts: MediaRecorderOptions = mime
          ? { mimeType: mime, videoBitsPerSecond }
          : { videoBitsPerSecond };
        recorder = new MediaRecorder(combinedStream, opts);
        chosenMime = mime;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!recorder) {
      this.stopStreamTracks(combinedStream);
      throw lastError instanceof Error ? lastError : new Error('初始化视频编码器失败');
    }

    const resolvedMime = (recorder.mimeType || chosenMime || 'video/webm').toLowerCase();
    const actualFormat: DirectorVideoFormat = resolvedMime.includes('mp4') ? 'mp4' : 'webm';
    const fallbackFrom: DirectorVideoFormat | undefined =
      actualFormat !== options.format ? options.format : undefined;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safePrefix =
      options.filenamePrefix.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'director';
    const filename = `CosmosBox-${safePrefix}-${stamp}.${actualFormat}`;

    this.aborted = false;
    this.chunks = [];
    this.stream = combinedStream;
    this.recorder = recorder;
    this.startMs = performance.now();
    this.activeMeta = {
      fps: options.fps,
      width: options.width,
      height: options.height,
      mimeType: recorder.mimeType || chosenMime || (actualFormat === 'mp4' ? 'video/mp4' : 'video/webm'),
      format: actualFormat,
      fallbackFrom,
      filename,
    };

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
      }
    };

    recorder.onerror = () => {
      const done = this.resolveStop;
      this.cleanup();
      done?.(null);
    };

    recorder.onstop = () => {
      const done = this.resolveStop;
      const meta = this.activeMeta;
      const wasAborted = this.aborted;
      const collected = this.chunks.slice();
      const durationSec = Math.max(0.1, (performance.now() - this.startMs) / 1000);
      this.cleanup();

      if (wasAborted || !meta || collected.length === 0) {
        done?.(null);
        return;
      }

      const blob = new Blob(collected, { type: meta.mimeType });
      triggerVideoDownload(blob, meta.filename);
      done?.({
        filename: meta.filename,
        mimeType: meta.mimeType,
        format: meta.format,
        fallbackFrom: meta.fallbackFrom,
        sizeBytes: blob.size,
        durationSec,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
      });
    };

    recorder.start(250);
    return { actualFormat, fallbackFrom };
  }

  public stop(): Promise<DirectorRecordingResult | null> {
    if (!this.recorder || this.recorder.state === 'inactive') {
      this.cleanup();
      return Promise.resolve(null);
    }
    if (this.stopPromise) return this.stopPromise;

    this.stopPromise = new Promise<DirectorRecordingResult | null>((resolve) => {
      this.resolveStop = resolve;
      try {
        this.recorder?.stop();
      } catch {
        this.cleanup();
        resolve(null);
      }
    });
    return this.stopPromise;
  }

  public abort(): void {
    this.aborted = true;
    const done = this.resolveStop;
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // Ignore stop errors during teardown
      }
    }
    this.cleanup();
    done?.(null);
  }

  private stopStreamTracks(stream: MediaStream | null): void {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Ignore stopped tracks
      }
    }
  }

  private cleanup(): void {
    this.stopStreamTracks(this.stream);
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.activeMeta = null;
    this.stopPromise = null;
    this.resolveStop = null;
  }
}
