package com.skidhomework.server;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Surface;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * H.264 hardware video encoder using MediaCodec.
 *
 * <p>Creates an encoder configured for the specified resolution and bitrate,
 * provides an input {@link Surface} for the camera to render into, and
 * forwards encoded H.264 NAL units to a {@link SocketRelay}.
 */
public final class VideoEncoder implements PreviewStreamEncoder {

    private static final String MIME_TYPE = "video/avc"; // H.264
    private static final int I_FRAME_INTERVAL = 2; // seconds between keyframes
    private static final long STARTUP_SYNC_FRAME_RETRY_MS = 250L;

    private final MediaCodec codec;
    private final Surface inputSurface;
    private final SocketRelay relay;
    private final Consumer<StopReason> stopCallback;
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final AtomicBoolean firstFrameReported = new AtomicBoolean(false);
    private final CountDownLatch firstFrameLatch = new CountDownLatch(1);
    private volatile boolean running;
    private Thread drainThread;
    private long startedAtMs = -1L;

    public VideoEncoder(int width, int height, int bitrate, int framerate, SocketRelay relay)
            throws IOException {
        this(width, height, bitrate, framerate, relay, reason -> { });
    }

    public VideoEncoder(
            int width,
            int height,
            int bitrate,
            int framerate,
            SocketRelay relay,
            Consumer<StopReason> stopCallback
    ) throws IOException {
        this.relay = relay;
        this.stopCallback = stopCallback;

        MediaFormat format = MediaFormat.createVideoFormat(MIME_TYPE, width, height);
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, framerate);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL);

        codec = MediaCodec.createEncoderByType(MIME_TYPE);
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        inputSurface = codec.createInputSurface();
    }

    /**
     * Returns the Surface that the camera should render frames into.
     */
    public Surface getInputSurface() {
        return inputSurface;
    }

    /**
     * Start the encoder and begin draining output buffers in a background thread.
     */
    public void start() {
        if (closed.get()) {
            throw new IllegalStateException("encoder has already been released");
        }
        if (!started.compareAndSet(false, true)) {
            return;
        }

        running = true;
        startedAtMs = SystemClock.elapsedRealtime();
        codec.start();
        requestSyncFrame("[Encoder] Requested startup sync frame.");

        // Drain encoded output in a dedicated thread
        drainThread = new Thread(this::drainOutputBuffers, "EncoderDrain");
        drainThread.setDaemon(true);
        drainThread.start();

        System.out.println("[Encoder] Started H.264 encoding.");
    }

    /**
     * Wait for the first encoded frame and actively request startup sync frames
     * so the host can receive an initial decodable picture promptly.
     */
    public void awaitFirstFrame(long timeoutMs) throws InterruptedException, IOException {
        long deadlineMs = SystemClock.elapsedRealtime() + timeoutMs;
        requestSyncFrame("[Encoder] Requested first-frame sync frame after camera start.");
        while (SystemClock.elapsedRealtime() < deadlineMs) {
            long remainingMs = deadlineMs - SystemClock.elapsedRealtime();
            long waitSliceMs = Math.min(remainingMs, STARTUP_SYNC_FRAME_RETRY_MS);
            if (firstFrameLatch.await(waitSliceMs, TimeUnit.MILLISECONDS)) {
                return;
            }

            if (!running) {
                throw new IOException("encoder stopped before producing the first frame");
            }

            requestSyncFrame("[Encoder] Startup frame still pending; requesting another sync frame.");
        }

        throw new IOException("encoder did not produce the first frame within " + timeoutMs + "ms");
    }

    /**
     * Stop the encoder and release resources.
     */
    public void stop() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        running = false;
        if (drainThread != null && Thread.currentThread() != drainThread) {
            drainThread.interrupt();
            try {
                drainThread.join(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        if (started.get()) {
            try {
                codec.stop();
            } catch (IllegalStateException e) {
                // Encoder may already be stopped or released during teardown.
            }
        }
        try {
            codec.release();
        } catch (IllegalStateException e) {
            // Encoder may already be released during teardown.
        }
        inputSurface.release();
    }

    /**
     * Continuously dequeue encoded output buffers and send NAL units to the relay.
     */
    private void drainOutputBuffers() {
        MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();

        try {
            while (running) {
                int outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000); // 10ms timeout

                if (outputIndex >= 0) {
                    ByteBuffer outputBuffer = codec.getOutputBuffer(outputIndex);

                    if (outputBuffer != null && bufferInfo.size > 0) {
                        if (isFramePayload(bufferInfo)
                                && firstFrameReported.compareAndSet(false, true)) {
                            System.out.println(
                                    "[Encoder] First encoded frame ready in "
                                            + (SystemClock.elapsedRealtime() - startedAtMs)
                                            + "ms."
                            );
                            firstFrameLatch.countDown();
                        }

                        byte[] nalData = new byte[bufferInfo.size];
                        outputBuffer.position(bufferInfo.offset);
                        outputBuffer.limit(bufferInfo.offset + bufferInfo.size);
                        outputBuffer.get(nalData);

                        try {
                            relay.sendNalUnit(nalData);
                        } catch (IOException e) {
                            System.err.println("[Encoder] Failed to send NAL unit: " + e.getMessage());
                            running = false;
                            break;
                        }
                    }

                    codec.releaseOutputBuffer(outputIndex, false);

                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        stopCallback.accept(StopReason.encoderEndOfStream());
                        running = false;
                        break;
                    }
                } else if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat newFormat = codec.getOutputFormat();
                    System.out.println("[Encoder] Output format changed: " + newFormat);
                }
                // INFO_TRY_AGAIN_LATER: just loop and try again
            }
        } catch (IllegalStateException e) {
            if (running) {
                System.err.println("[Encoder] Encoder stopped unexpectedly: " + e.getMessage());
                stopCallback.accept(
                        StopReason.encoderFailed("encoder stopped unexpectedly: " + e.getMessage())
                );
            }
        } finally {
            running = false;
        }
    }

    private boolean isFramePayload(MediaCodec.BufferInfo bufferInfo) {
        return (bufferInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0;
    }

    private void requestSyncFrame(String logMessage) {
        try {
            Bundle params = new Bundle();
            params.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
            codec.setParameters(params);
            System.out.println(logMessage);
        } catch (RuntimeException e) {
            // Ignore sync-frame request failures; startup probing will still
            // fall back to the outer recovery path if no frame arrives.
        }
    }
}
