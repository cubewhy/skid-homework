package com.skidhomework.server;

import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.SystemClock;

import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/**
 * Minimal Android Camera Server for ADB-based document scanning.
 *
 * <p>Launched via {@code adb shell CLASSPATH=/data/local/tmp/camera-server.jar
 * app_process / com.skidhomework.server.Server [options]}.
 *
 * <p>Opens a camera using the Camera2 API, encodes frames to H.264 via MediaCodec,
 * and streams the encoded NAL units over a LocalSocket for the host to read.
 *
 * <p>Protocol: each NAL unit is prefixed with a 4-byte big-endian length header.
 */
public final class Server {

    private static final String DEFAULT_SOCKET_NAME = "scanner";
    private static final String DEFAULT_STILL_SOCKET_SUFFIX = "-still";
    private static final String DEFAULT_STILL_STREAM_SOCKET_SUFFIX = "-still-stream";
    private static final int DEFAULT_WIDTH = 640;
    private static final int DEFAULT_HEIGHT = 360;
    private static final int DEFAULT_BITRATE = 2_000_000; // 2 Mbps
    private static final int DEFAULT_FRAMERATE = 30;
    private static final String DEFAULT_CAMERA_ID = "0"; // Back camera
    private static final int MAX_CONSECUTIVE_PIPELINE_RECOVERIES = 8;
    private static final int MAX_CONSECUTIVE_CAMERA_RECOVERIES = Integer.MAX_VALUE;
    private static final long STABLE_SESSION_RESET_MS = 5_000L;
    private static final long CAMERA_RECOVERY_RESET_MS = 2_500L;
    private static final long RECOVERY_DELAY_BASE_MS = 250L;
    private static final long RECOVERY_DELAY_MAX_MS = 2_000L;
    private static final long CAMERA_RECOVERY_DELAY_BASE_MS = 150L;
    private static final long CAMERA_RECOVERY_DELAY_MAX_MS = 1_000L;
    private static final long STARTUP_FIRST_FRAME_TIMEOUT_MS = 1_800L;

    public static void main(String[] args) {
        android.os.Looper.prepareMainLooper();
        ServerConfig config = parseArgs(args);

        System.out.println("[Server] Starting camera server...");
        System.out.println("[Server] Socket: " + config.socketName);
        System.out.println("[Server] Still socket: " + config.stillSocketName);
        System.out.println("[Server] Still stream socket: " + config.stillStreamSocketName);
        System.out.println("[Server] Resolution: " + config.width + "x" + config.height);
        System.out.println("[Server] Bitrate: " + config.bitrate + ", FPS: " + config.framerate);
        System.out.println("[Server] Camera: " + config.cameraId);
        System.out.println(
                "[Server] Defer still surface until capture: " + config.deferStillSurfaceUntilCapture
        );

        AtomicReference<LocalServerSocket> serverSocketRef = new AtomicReference<>();
        AtomicReference<LocalSocket> clientSocketRef = new AtomicReference<>();
        AtomicReference<SocketRelay> relayRef = new AtomicReference<>();
        AtomicReference<CameraCaptureBackend> activeCaptureRef = new AtomicReference<>();
        SocketRelay relay = null;
        StillCaptureSocketServer stillCaptureServer = null;
        StillCaptureStreamSocketServer stillCaptureStreamServer = null;
        AtomicBoolean shutdownRequested = new AtomicBoolean(false);
        AtomicReference<StopSignal> activeStopSignal = new AtomicReference<>();
        AtomicReference<StopReason> terminalStopReason = new AtomicReference<>();
        AtomicReference<String> finalStopReason = new AtomicReference<>("unknown");

        Consumer<StopReason> requestTerminalStop = (reason) -> {
            StopReason safeReason = reason == null ? StopReason.fatal("terminal stop requested with a null reason") : reason;
            if (terminalStopReason.compareAndSet(null, safeReason)) {
                finalStopReason.set(safeReason.toString());
                System.out.println("[Server] Terminal stop requested: " + safeReason);
            }

            if (safeReason.isSocketTerminal() || "process_shutdown".equals(safeReason.getCode())) {
                SocketRelay activeRelay = relayRef.getAndSet(null);
                if (activeRelay != null) {
                    activeRelay.close();
                }
                closeQuietly(clientSocketRef.getAndSet(null));
                closeQuietly(serverSocketRef.getAndSet(null));
            }

            StopSignal stopSignal = activeStopSignal.get();
            if (stopSignal != null) {
                stopSignal.request(safeReason);
            }
        };

        try {
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                shutdownRequested.set(true);
                requestTerminalStop.accept(StopReason.processShutdown());
                closeQuietly(clientSocketRef.getAndSet(null));
                closeQuietly(serverSocketRef.getAndSet(null));
            }, "ServerShutdownHook"));

            // Create a LocalServerSocket to accept the host connection
            LocalServerSocket serverSocket = new LocalServerSocket(config.socketName);
            serverSocketRef.set(serverSocket);
            System.out.println("[Server] Waiting for client connection...");

            LocalSocket clientSocket = serverSocket.accept();
            clientSocketRef.set(clientSocket);
            clientSocket.setSendBufferSize(1024 * 1024);
            System.out.println("[Server] Client connected.");
            closeQuietly(serverSocket);
            serverSocketRef.set(null);

            OutputStream outputStream = clientSocket.getOutputStream();

            // Create the socket relay that writes length-prefixed NAL units
            relay = new SocketRelay(outputStream, requestTerminalStop);
            relayRef.set(relay);
            stillCaptureServer = new StillCaptureSocketServer(
                    config.stillSocketName,
                    () -> {
                        CameraCaptureBackend activeCapture = activeCaptureRef.get();
                        if (activeCapture == null) {
                            throw new IllegalStateException("Camera session is not ready for still capture.");
                        }
                        return activeCapture.captureStillJpeg();
                    }
            );
            stillCaptureServer.start();
            stillCaptureStreamServer = new StillCaptureStreamSocketServer(
                    config.stillStreamSocketName,
                    (streamOutput) -> {
                        CameraCaptureBackend activeCapture = activeCaptureRef.get();
                        if (activeCapture == null) {
                            throw new IllegalStateException("Camera session is not ready for streamed still capture.");
                        }
                        activeCapture.streamStillJpeg(streamOutput);
                    }
            );
            stillCaptureStreamServer.start();

            StopReason lastReason = runStreamingLoop(
                    config,
                    relay,
                    activeCaptureRef,
                    shutdownRequested,
                    activeStopSignal,
                    terminalStopReason
            );
            finalStopReason.set(lastReason.toString());
            logFinalStopReason(lastReason);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            requestTerminalStop.accept(StopReason.processShutdown());
        } catch (Exception e) {
            requestTerminalStop.accept(StopReason.fatal("fatal error: " + e.getMessage()));
            System.err.println("[Server] Fatal error: " + e.getMessage());
            e.printStackTrace();
        } finally {
            if (stillCaptureServer != null) {
                stillCaptureServer.close();
            }
            if (stillCaptureStreamServer != null) {
                stillCaptureStreamServer.close();
            }
            SocketRelay activeRelay = relayRef.getAndSet(null);
            if (activeRelay != null) {
                activeRelay.close();
            } else if (relay != null) {
                relay.close();
            }
            closeQuietly(clientSocketRef.getAndSet(null));
            closeQuietly(serverSocketRef.getAndSet(null));

            System.out.println("[Server] Camera server stopped. Reason: " + finalStopReason.get());
        }
    }

    private static StopReason runStreamingLoop(
            ServerConfig config,
            SocketRelay relay,
            AtomicReference<CameraCaptureBackend> activeCaptureRef,
            AtomicBoolean shutdownRequested,
            AtomicReference<StopSignal> activeStopSignal,
            AtomicReference<StopReason> terminalStopReason
    ) throws InterruptedException {
        int consecutiveRecoveries = 0;
        StopReason lastReason = StopReason.fatal("streaming loop exited without a reason");
        boolean useLegacyPreviewFallback = false;

        while (!shutdownRequested.get()) {
            StopReason forcedStop = terminalStopReason.get();
            if (forcedStop != null) {
                return forcedStop;
            }

            StopSignal sessionStopSignal = new StopSignal();
            activeStopSignal.set(sessionStopSignal);

            PreviewStreamEncoder encoder = null;
            CameraCaptureBackend capture = null;
            long sessionStartMs = SystemClock.elapsedRealtime();
            boolean retryWithLegacyPreviewFallback = false;

            try {
                Consumer<StopReason> requestSessionStop = sessionStopSignal::request;

                if (useLegacyPreviewFallback) {
                    LegacyCameraCapture legacyCapture = new LegacyCameraCapture(
                            config.cameraId,
                            config.width,
                            config.height,
                            config.framerate,
                            requestSessionStop
                    );
                    capture = legacyCapture;
                    capture.start();

                    ByteBufferVideoEncoder legacyEncoder = new ByteBufferVideoEncoder(
                            legacyCapture.getPreviewWidth(),
                            legacyCapture.getPreviewHeight(),
                            config.bitrate,
                            config.framerate,
                            relay,
                            requestSessionStop
                    );
                    encoder = legacyEncoder;
                    legacyCapture.attachEncoder(legacyEncoder);
                } else {
                    VideoEncoder surfaceEncoder = new VideoEncoder(
                            config.width,
                            config.height,
                            config.bitrate,
                            config.framerate,
                            relay,
                            requestSessionStop
                    );
                    encoder = surfaceEncoder;
                    capture = new CameraCapture(
                            config.cameraId,
                            config.width,
                            config.height,
                            config.framerate,
                            surfaceEncoder.getInputSurface(),
                            config.deferStillSurfaceUntilCapture,
                            requestSessionStop
                    );
                }

                encoder.start();
                if (!useLegacyPreviewFallback) {
                    capture.start();
                }
                activeCaptureRef.set(capture);
                System.out.println("[Server] Waiting for first encoded frame...");
                encoder.awaitFirstFrame(STARTUP_FIRST_FRAME_TIMEOUT_MS);

                System.out.println("[Server] Streaming started. Waiting for disconnect or shutdown...");
                sessionStopSignal.await();
            } catch (Exception e) {
                StopReason startupFailure = classifyStartupFailure(e);
                if (!useLegacyPreviewFallback && isLegacyPreviewFallbackCandidate(startupFailure)) {
                    useLegacyPreviewFallback = true;
                    retryWithLegacyPreviewFallback = true;
                    System.err.println(
                            "[Server] Camera2 shell path is blocked on this device. "
                                    + "Retrying with legacy camera preview fallback. Reason: "
                                    + startupFailure.getMessage()
                    );
                    e.printStackTrace();
                } else {
                    sessionStopSignal.request(startupFailure);
                    System.err.println("[Server] Session startup failed: " + startupFailure.getMessage());
                    e.printStackTrace();
                }
            } finally {
                activeStopSignal.compareAndSet(sessionStopSignal, null);
                activeCaptureRef.compareAndSet(capture, null);
                if (capture != null) {
                    capture.stop();
                }
                if (encoder != null) {
                    encoder.stop();
                }
            }

            if (retryWithLegacyPreviewFallback) {
                continue;
            }

            lastReason = terminalStopReason.get();
            if (lastReason != null) {
                return lastReason;
            }

            lastReason = sessionStopSignal.getReason();
            final long sessionDurationMs = SystemClock.elapsedRealtime() - sessionStartMs;
            if (!lastReason.isRecoverable()) {
                return lastReason;
            }

            if (shouldResetRecoveryCounter(lastReason, sessionDurationMs)) {
                consecutiveRecoveries = 0;
            }
            consecutiveRecoveries++;
            logSessionStop(lastReason, sessionDurationMs, consecutiveRecoveries);

            if (hasExceededRecoveryLimit(lastReason, consecutiveRecoveries)) {
                return StopReason.fatal(
                        "recovery limit exceeded after "
                                + getRecoveryLimit(lastReason)
                                + " attempts; last reason: "
                                + lastReason.getMessage()
                );
            }

            long delayMs = computeRecoveryDelayMs(lastReason, consecutiveRecoveries);
            System.out.println(
                    "[Server] Recovering "
                            + describeRecoveryTarget(lastReason)
                            + " attempt #"
                            + consecutiveRecoveries
                            + " in "
                            + delayMs
                            + "ms after "
                            + lastReason
                            + "."
            );
            Thread.sleep(delayMs);
        }

        return StopReason.processShutdown();
    }

    private static StopReason classifyStartupFailure(Exception exception) {
        Throwable cause = exception.getCause() != null ? exception.getCause() : exception;
        String message = cause.getMessage() != null ? cause.getMessage() : exception.toString();
        String exceptionDetails = describeExceptionChain(exception).toLowerCase();

        if (isDeviceEnvironmentBlocker(exceptionDetails)) {
            return StopReason.cameraEnvironmentBlocked(
                    "camera environment blocked on this device: " + message
            );
        }

        if (exception instanceof IOException || cause instanceof IOException) {
            return StopReason.encoderFailed("encoder startup failed: " + message);
        }

        return StopReason.cameraStartFailed("camera pipeline startup failed: " + message);
    }

    private static boolean isDeviceEnvironmentBlocker(String details) {
        return details.contains("given calling package android does not match caller's uid")
                || details.contains("/sys/class/thermal/")
                || (details.contains("getthermalinfo") && details.contains("permission denied"))
                || (details.contains("failed to invoke createcapturesession")
                && details.contains("permission denied"));
    }

    private static boolean isLegacyPreviewFallbackCandidate(StopReason reason) {
        return reason != null && "camera_environment_blocked".equals(reason.getCode());
    }

    private static String describeExceptionChain(Throwable throwable) {
        StringBuilder builder = new StringBuilder();
        Throwable current = throwable;
        while (current != null) {
            if (builder.length() > 0) {
                builder.append(" | ");
            }
            builder.append(current.getClass().getSimpleName());
            String message = current.getMessage();
            if (message != null && !message.trim().isEmpty()) {
                builder.append(": ").append(message.trim());
            }
            current = current.getCause();
        }
        return builder.toString();
    }

    private static boolean shouldResetRecoveryCounter(
            StopReason reason,
            long sessionDurationMs
    ) {
        if (reason.isCameraRecoveryCandidate()) {
            return sessionDurationMs >= CAMERA_RECOVERY_RESET_MS;
        }
        return sessionDurationMs >= STABLE_SESSION_RESET_MS;
    }

    private static boolean hasExceededRecoveryLimit(
            StopReason reason,
            int consecutiveRecoveries
    ) {
        return consecutiveRecoveries > getRecoveryLimit(reason);
    }

    private static int getRecoveryLimit(StopReason reason) {
        if (reason.isCameraRecoveryCandidate()) {
            return MAX_CONSECUTIVE_CAMERA_RECOVERIES;
        }
        return MAX_CONSECUTIVE_PIPELINE_RECOVERIES;
    }

    private static long computeRecoveryDelayMs(StopReason reason, int consecutiveRecoveries) {
        long delayMs = reason.isCameraRecoveryCandidate()
                ? CAMERA_RECOVERY_DELAY_BASE_MS
                : RECOVERY_DELAY_BASE_MS;
        long maxDelayMs = reason.isCameraRecoveryCandidate()
                ? CAMERA_RECOVERY_DELAY_MAX_MS
                : RECOVERY_DELAY_MAX_MS;
        for (int i = 1; i < consecutiveRecoveries; i++) {
            delayMs = Math.min(delayMs * 2L, maxDelayMs);
        }
        return delayMs;
    }

    private static String describeRecoveryTarget(StopReason reason) {
        if (reason.isCameraRecoveryCandidate()) {
            return "camera pipeline";
        }
        if (reason.isEncoderRecoveryCandidate()) {
            return "encoder pipeline";
        }
        return "streaming pipeline";
    }

    private static void logSessionStop(
            StopReason reason,
            long sessionDurationMs,
            int consecutiveRecoveries
    ) {
        System.out.println(
                "[Server] Session stop: code="
                        + reason.getCode()
                        + ", recoverable="
                        + reason.isRecoverable()
                        + ", target="
                        + describeRecoveryTarget(reason)
                        + ", durationMs="
                        + sessionDurationMs
                        + ", recoveryCount="
                        + consecutiveRecoveries
                        + ", message="
                        + reason.getMessage()
        );
    }

    private static void logFinalStopReason(StopReason reason) {
        String classification = "abnormal";
        if ("process_shutdown".equals(reason.getCode())) {
            classification = "normal";
        } else if ("socket_closed".equals(reason.getCode())) {
            classification = "external_disconnect";
        } else if ("socket_write_failed".equals(reason.getCode())) {
            classification = "upstream_write_failure";
        }

        System.out.println(
                "[Server] Final stop classification="
                        + classification
                        + ", code="
                        + reason.getCode()
                        + ", message="
                        + reason.getMessage()
        );
    }

    private static ServerConfig parseArgs(String[] args) {
        ServerConfig config = new ServerConfig();

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--socket":
                    config.socketName = args[++i];
                    break;
                case "--width":
                    config.width = Integer.parseInt(args[++i]);
                    break;
                case "--still-socket":
                    config.stillSocketName = args[++i];
                    break;
                case "--still-stream-socket":
                    config.stillStreamSocketName = args[++i];
                    break;
                case "--height":
                    config.height = Integer.parseInt(args[++i]);
                    break;
                case "--bitrate":
                    config.bitrate = Integer.parseInt(args[++i]);
                    break;
                case "--fps":
                    config.framerate = Integer.parseInt(args[++i]);
                    break;
                case "--camera":
                    config.cameraId = args[++i];
                    break;
                case "--defer-still-surface":
                    config.deferStillSurfaceUntilCapture = true;
                    break;
                default:
                    System.err.println("[Server] Unknown argument: " + args[i]);
                    break;
            }
        }

        if (config.stillSocketName == null || config.stillSocketName.trim().isEmpty()) {
            config.stillSocketName = defaultStillSocketName(config.socketName);
        }
        if (config.stillStreamSocketName == null || config.stillStreamSocketName.trim().isEmpty()) {
            config.stillStreamSocketName = defaultStillStreamSocketName(config.socketName);
        }

        return config;
    }

    private static final class ServerConfig {
        String socketName = DEFAULT_SOCKET_NAME;
        String stillSocketName = defaultStillSocketName(DEFAULT_SOCKET_NAME);
        String stillStreamSocketName = defaultStillStreamSocketName(DEFAULT_SOCKET_NAME);
        int width = DEFAULT_WIDTH;
        int height = DEFAULT_HEIGHT;
        int bitrate = DEFAULT_BITRATE;
        int framerate = DEFAULT_FRAMERATE;
        String cameraId = DEFAULT_CAMERA_ID;
        boolean deferStillSurfaceUntilCapture = false;
    }

    private static String defaultStillSocketName(String previewSocketName) {
        return previewSocketName + DEFAULT_STILL_SOCKET_SUFFIX;
    }

    private static String defaultStillStreamSocketName(String previewSocketName) {
        return previewSocketName + DEFAULT_STILL_STREAM_SOCKET_SUFFIX;
    }

    private static void closeQuietly(LocalSocket socket) {
        if (socket == null) {
            return;
        }

        try {
            socket.close();
        } catch (IOException e) {
            // Ignore cleanup failures.
        }
    }

    private static void closeQuietly(LocalServerSocket socket) {
        if (socket == null) {
            return;
        }

        try {
            socket.close();
        } catch (IOException e) {
            // Ignore cleanup failures.
        }
    }
}
