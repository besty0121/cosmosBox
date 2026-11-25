import { DirectorFps, DirectorRecordingResult } from '../types/cosmos';

export interface VideoRecorderStartOptions {
  canvas: HTMLCanvasElement;
  fps: DirectorFps;
  width: number;
  height: number;
  filenamePrefix: string;
  audioStream?: MediaStream | null;
}

export function isWebMRecordingSupported(): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & {
    captureStream?: (frameRate?: number) => MediaStream;
  };
  return typeof proto.captureStream === 'function';
}

function selectMimeType(withAudio: boolean): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  const candidates = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function triggerWebMDownload(blob: Blob, filename: string): void {
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
 * Because HUD panels live in the sibling React DOM overlay rather than WebGL,
 * captured WebM output contains zero UI banners, buttons, or reticles.
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

  public start(options: VideoRecorderStartOptions): void {
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
    const mimeType = selectMimeType(clonedAudioTracks.length > 0);
    const videoBitsPerSecond =
      options.width >= 1900
        ? options.fps >= 60
          ? 16_000_000
          : 12_000_000
        : options.fps >= 60
          ? 10_000_000
          : 8_000_000;

    const recorderOpts: MediaRecorderOptions = mimeType
      ? { mimeType, videoBitsPerSecond }
      : { videoBitsPerSecond };

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combinedStream, recorderOpts);
    } catch (err) {
      this.stopStreamTracks(combinedStream);
      throw err instanceof Error ? err : new Error('初始化 WebM 编码器失败');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safePrefix = options.filenamePrefix.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'director';
    const filename = `CosmosBox-${safePrefix}-${stamp}.webm`;

    this.aborted = false;
    this.chunks = [];
    this.stream = combinedStream;
    this.recorder = recorder;
    this.startMs = performance.now();
    this.activeMeta = {
      fps: options.fps,
      width: options.width,
      height: options.height,
      mimeType: recorder.mimeType || mimeType || 'video/webm',
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
      triggerWebMDownload(blob, meta.filename);
      done?.({
        filename: meta.filename,
        mimeType: meta.mimeType,
        sizeBytes: blob.size,
        durationSec,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
      });
    };

    recorder.start(250);
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
