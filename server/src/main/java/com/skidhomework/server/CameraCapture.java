package com.skidhomework.server;

import android.annotation.SuppressLint;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureFailure;
import android.graphics.ImageFormat;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Range;
import android.util.Size;
import android.view.Surface;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/**
 * Opens an Android camera via Camera2 API and sends frames to an encoder Surface.
 *
 * <p>Since this runs via {@code app_process} at the shell UID level,
 * camera permissions are bypassed (same approach as scrcpy).
 */
public final class CameraCapture {
    private static final int CAMERA_OPEN_TIMEOUT_SECONDS = 5;
    private static final int MAX_INTERNAL_CAMERA_RECOVERY_ATTEMPTS = 4;
    private static final long CAMERA_RECOVERY_DELAY_BASE_MS = 150L;
    private static final long CAMERA_RECOVERY_DELAY_MAX_MS = 1_000L;
    private static final long FIRST_CAPTURE_START_TIMEOUT_MS = 1_500L;
    private static final long STILL_CAPTURE_TIMEOUT_MS = 4_000L;
    private static final byte JPEG_QUALITY = (byte) 95;

    private final String cameraId;
    private final int width;
    private final int height;
    private final int targetFps;
    private final Surface encoderSurface;
    private final Consumer<StopReason> stopCallback;
    private final HandlerThread handlerThread;
    private final Handler handler;
    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final AtomicBoolean disconnectReported = new AtomicBoolean(false);
    private final AtomicBoolean recoveryInProgress = new AtomicBoolean(false);
    private final AtomicBoolean stopReported = new AtomicBoolean(false);
    private final AtomicBoolean startCompleted = new AtomicBoolean(false);
    private final Object cameraLock = new Object();
    private final Object stillCaptureLock = new Object();

    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private CameraManager cameraManager;
    private CameraCharacteristics cameraCharacteristics;
    private ImageReader stillImageReader;
    private Size stillCaptureSize;

    public CameraCapture(
            String cameraId,
            int width,
            int height,
            int targetFps,
            Surface encoderSurface,
            Consumer<StopReason> stopCallback
    ) {
        this.cameraId = cameraId;
        this.width = width;
        this.height = height;
        this.targetFps = targetFps;
        this.encoderSurface = encoderSurface;
        this.stopCallback = stopCallback;

        handlerThread = new HandlerThread("CameraThread");
        handlerThread.start();
        handler = new Handler(handlerThread.getLooper());
    }

    /**
     * Open the camera and start a repeating capture request targeting the encoder surface.
     */
    @SuppressLint("MissingPermission") // Permissions bypassed at shell UID level
    public void start() throws Exception {
        ensureCameraManager();
        openCameraPipeline();
        startCompleted.set(true);
        disconnectReported.set(false);
    }

    /**
     * Capture a single high-resolution JPEG from the active camera session.
     */
    public byte[] captureStillJpeg() throws Exception {
        synchronized (stillCaptureLock) {
            if (stopping.get()) {
                throw new IllegalStateException("Camera pipeline is stopping.");
            }

            final CameraDevice activeCamera;
            final CameraCaptureSession activeSession;
            final ImageReader activeReader;
            synchronized (cameraLock) {
                activeCamera = cameraDevice;
                activeSession = captureSession;
                activeReader = stillImageReader;
            }

            if (activeCamera == null || activeSession == null || activeReader == null) {
                throw new IllegalStateException("Camera still capture is not ready.");
            }

            clearPendingStillImage(activeReader);

            final CountDownLatch imageLatch = new CountDownLatch(1);
            final AtomicReference<byte[]> imageBytesRef = new AtomicReference<>();
            final AtomicReference<String> failureMessageRef = new AtomicReference<>();

            activeReader.setOnImageAvailableListener(
                    (reader) -> {
                        Image image = null;
                        try {
                            image = reader.acquireLatestImage();
                            if (image == null) {
                                return;
                            }

                            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                            byte[] bytes = new byte[buffer.remaining()];
                            buffer.get(bytes);
                            imageBytesRef.compareAndSet(null, bytes);
                            imageLatch.countDown();
                        } catch (RuntimeException e) {
                            failureMessageRef.compareAndSet(
                                    null,
                                    "Failed to read still image: " + sanitizeExceptionMessage(e)
                            );
                            imageLatch.countDown();
                        } finally {
                            if (image != null) {
                                image.close();
                            }
                        }
                    },
                    handler
            );

            CaptureRequest.Builder requestBuilder =
                    activeCamera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            requestBuilder.addTarget(activeReader.getSurface());
            requestBuilder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
            requestBuilder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
            requestBuilder.set(
                    CaptureRequest.CONTROL_AF_MODE,
                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
            );
            requestBuilder.set(CaptureRequest.JPEG_QUALITY, JPEG_QUALITY);
            requestBuilder.set(CaptureRequest.JPEG_ORIENTATION, 0);

            try {
                activeSession.capture(
                        requestBuilder.build(),
                        new CameraCaptureSession.CaptureCallback() {
                            @Override
                            public void onCaptureFailed(
                                    CameraCaptureSession session,
                                    CaptureRequest request,
                                    CaptureFailure failure
                            ) {
                                failureMessageRef.compareAndSet(
                                        null,
                                        "Still capture request failed: reason=" + failure.getReason()
                                );
                                imageLatch.countDown();
                            }
                        },
                        handler
                );
            } catch (CameraAccessException | IllegalStateException e) {
                activeReader.setOnImageAvailableListener(null, null);
                throw new RuntimeException(
                        "failed to submit still capture request: " + sanitizeExceptionMessage(e),
                        e
                );
            }

            boolean imageArrived = imageLatch.await(STILL_CAPTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            activeReader.setOnImageAvailableListener(null, null);

            if (!imageArrived) {
                throw new RuntimeException(
                        "still capture timed out after " + STILL_CAPTURE_TIMEOUT_MS + "ms"
                );
            }

            String failureMessage = failureMessageRef.get();
            if (failureMessage != null) {
                throw new RuntimeException(failureMessage);
            }

            byte[] imageBytes = imageBytesRef.get();
            if (imageBytes == null || imageBytes.length == 0) {
                throw new RuntimeException("still capture returned no image bytes");
            }

            return imageBytes;
        }
    }

    private void ensureCameraManager() throws Exception {
        if (cameraManager != null && cameraCharacteristics != null) {
            return;
        }

        try {
            cameraManager = CameraSupport.createShellCameraManager();
        } catch (Exception e) {
            throw new RuntimeException("Failed to obtain CameraManager system service.", e);
        }

        if (cameraManager == null) {
            throw new RuntimeException("Failed to obtain CameraManager system service.");
        }

        cameraCharacteristics = cameraManager.getCameraCharacteristics(cameraId);
    }

    @SuppressLint("MissingPermission") // Permissions bypassed at shell UID level
    private void openCameraPipeline() throws Exception {
        closeCurrentPipeline(null);
        long cameraOpenStartedAtMs = SystemClock.elapsedRealtime();
        CountDownLatch openLatch = new CountDownLatch(1);

        cameraManager.openCamera(cameraId, new CameraDevice.StateCallback() {
            @Override
            public void onOpened(CameraDevice camera) {
                if (stopping.get()) {
                    camera.close();
                    openLatch.countDown();
                    return;
                }
                synchronized (cameraLock) {
                    cameraDevice = camera;
                }
                openLatch.countDown();
            }

            @Override
            public void onDisconnected(CameraDevice camera) {
                handleRecoverableCameraIssue(
                        camera,
                        StopReason.cameraDisconnected(),
                        "[Camera] Disconnected unexpectedly. Attempting in-process camera recovery."
                );
                openLatch.countDown();
            }

            @Override
            public void onError(CameraDevice camera, int error) {
                handleRecoverableCameraIssue(
                        camera,
                        StopReason.cameraError(error),
                        "[Camera] Error "
                                + error
                                + ". Attempting in-process camera recovery."
                );
                openLatch.countDown();
            }
        }, handler);

        if (!openLatch.await(CAMERA_OPEN_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new RuntimeException(
                    "camera open timed out after " + CAMERA_OPEN_TIMEOUT_SECONDS + "s"
            );
        }

        if (cameraDevice == null) {
            throw new RuntimeException("failed to open camera " + cameraId);
        }

        stillCaptureSize = CameraSupport.selectOutputSize(
                cameraCharacteristics,
                ImageFormat.JPEG,
                width,
                height
        );
        stillImageReader = ImageReader.newInstance(
                stillCaptureSize.getWidth(),
                stillCaptureSize.getHeight(),
                ImageFormat.JPEG,
                2
        );

        System.out.println(
                "[Camera] Opened camera "
                        + cameraId
                        + " in "
                        + (SystemClock.elapsedRealtime() - cameraOpenStartedAtMs)
                        + "ms."
        );
        System.out.println(
                "[Camera] Still capture output size: "
                        + stillCaptureSize.getWidth()
                        + "x"
                        + stillCaptureSize.getHeight()
                        + "."
        );

        // Create a shared session so preview streaming and still capture use the same camera pipeline.
        long sessionConfigureStartedAtMs = SystemClock.elapsedRealtime();
        CountDownLatch sessionLatch = new CountDownLatch(1);

        cameraDevice.createCaptureSession(
                Arrays.asList(encoderSurface, stillImageReader.getSurface()),
                new CameraCaptureSession.StateCallback() {
                    @Override
                    public void onConfigured(CameraCaptureSession session) {
                        if (stopping.get()) {
                            try {
                                session.close();
                            } catch (RuntimeException e) {
                                // Ignore session close failures during shutdown.
                            }
                            sessionLatch.countDown();
                            return;
                        }
                        synchronized (cameraLock) {
                            captureSession = session;
                        }
                        sessionLatch.countDown();
                    }

                    @Override
                    public void onConfigureFailed(CameraCaptureSession session) {
                        System.err.println("[Camera] Session configuration failed.");
                        if (shouldUseInProcessRecovery()) {
                            handleRecoverableSessionIssue(
                                    session,
                                    StopReason.cameraSessionFailed("camera session configuration failed"),
                                    "[Camera] Session configuration failed. Attempting in-process camera recovery."
                            );
                        } else {
                            closeCaptureSession(session);
                        }
                        sessionLatch.countDown();
                    }
                },
                handler
        );

        if (!sessionLatch.await(CAMERA_OPEN_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new RuntimeException("camera session creation timed out");
        }

        if (captureSession == null) {
            throw new RuntimeException("failed to configure camera capture session");
        }

        System.out.println(
                "[Camera] Capture session configured in "
                        + (SystemClock.elapsedRealtime() - sessionConfigureStartedAtMs)
                        + "ms."
        );

        // Build a repeating capture request for continuous streaming
        CaptureRequest.Builder requestBuilder =
                cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
        requestBuilder.addTarget(encoderSurface);
        requestBuilder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
        requestBuilder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
        requestBuilder.set(CaptureRequest.CONTROL_AF_MODE,
                CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);

        Range<Integer> fpsRange = selectFpsRange(cameraCharacteristics, targetFps);
        if (fpsRange != null) {
            requestBuilder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fpsRange);
            System.out.println(
                    "[Camera] Using AE target FPS range "
                            + fpsRange
                            + " for target "
                            + targetFps
                            + " fps."
            );
        } else {
            System.out.println("[Camera] No exact AE FPS range found for target " + targetFps + " fps.");
        }

        final long repeatingRequestStartedAtMs = SystemClock.elapsedRealtime();
        final CountDownLatch firstCaptureLatch = new CountDownLatch(1);
        final AtomicBoolean firstCaptureReported = new AtomicBoolean(false);

        try {
            captureSession.setRepeatingRequest(
                    requestBuilder.build(),
                    new CameraCaptureSession.CaptureCallback() {
                        @Override
                        public void onCaptureStarted(
                                CameraCaptureSession session,
                                CaptureRequest request,
                                long timestamp,
                                long frameNumber
                        ) {
                            if (firstCaptureReported.compareAndSet(false, true)) {
                                long firstCaptureLatencyMs =
                                        SystemClock.elapsedRealtime() - repeatingRequestStartedAtMs;
                                System.out.println(
                                        "[Camera] First capture started in "
                                                + firstCaptureLatencyMs
                                                + "ms after repeating request."
                                );
                                firstCaptureLatch.countDown();
                            }
                        }
                    },
                    handler
            );
        } catch (CameraAccessException | IllegalStateException e) {
            closeCurrentPipeline(null);
            throw new RuntimeException("failed to start repeating request: " + e.getMessage(), e);
        }

        if (!firstCaptureLatch.await(FIRST_CAPTURE_START_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            closeCurrentPipeline(null);
            throw new RuntimeException(
                    "camera first capture timed out after "
                            + FIRST_CAPTURE_START_TIMEOUT_MS
                            + "ms"
            );
        }

        System.out.println("[Camera] Capture session started.");
    }

    /**
     * Stop capture and release camera resources.
     */
    public void stop() {
        if (!stopping.compareAndSet(false, true)) {
            return;
        }

        startCompleted.set(false);
        closeCurrentPipeline(null);
        handlerThread.quitSafely();
        try {
            handlerThread.join(1_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void handleRecoverableCameraIssue(
            CameraDevice camera,
            StopReason reason,
            String logMessage
    ) {
        boolean expectedShutdown = stopping.get();
        closeCurrentPipeline(camera);
        if (expectedShutdown) {
            System.out.println("[Camera] Camera callback received during shutdown.");
            return;
        }

        if (!startCompleted.get()) {
            return;
        }

        scheduleInProcessRecovery(reason, logMessage);
    }

    private void handleRecoverableSessionIssue(
            CameraCaptureSession session,
            StopReason reason,
            String logMessage
    ) {
        closeCaptureSession(session);
        if (stopping.get() || !startCompleted.get()) {
            return;
        }

        scheduleInProcessRecovery(reason, logMessage);
    }

    private boolean shouldUseInProcessRecovery() {
        return !stopping.get() && startCompleted.get() && !recoveryInProgress.get();
    }

    private void scheduleInProcessRecovery(StopReason initialReason, String logMessage) {
        if (!recoveryInProgress.compareAndSet(false, true)) {
            return;
        }

        if (disconnectReported.compareAndSet(false, true)) {
            System.err.println(logMessage);
        }

        Thread recoveryThread = new Thread(
                () -> runInProcessRecovery(initialReason),
                "CameraRecovery"
        );
        recoveryThread.setDaemon(true);
        recoveryThread.start();
    }

    private void runInProcessRecovery(StopReason initialReason) {
        StopReason lastReason = initialReason;

        try {
            for (int attempt = 1; attempt <= MAX_INTERNAL_CAMERA_RECOVERY_ATTEMPTS; attempt++) {
                if (stopping.get()) {
                    return;
                }

                long delayMs = computeRecoveryDelayMs(attempt);
                if (delayMs > 0L) {
                    SystemClock.sleep(delayMs);
                }
                if (stopping.get()) {
                    return;
                }

                System.out.println(
                        "[Camera] Recovery attempt #"
                                + attempt
                                + " after "
                                + lastReason
                                + "."
                );

                try {
                    openCameraPipeline();
                    disconnectReported.set(false);
                    System.out.println(
                            "[Camera] Camera pipeline recovered on attempt #"
                                    + attempt
                                    + "."
                    );
                    return;
                } catch (Exception e) {
                    lastReason = StopReason.cameraStartFailed(
                            "camera recovery attempt #"
                                    + attempt
                                    + " failed: "
                                    + sanitizeExceptionMessage(e)
                    );
                    System.err.println("[Camera] " + lastReason.getMessage());
                }
            }
        } finally {
            recoveryInProgress.set(false);
        }

        requestStop(
                StopReason.cameraStartFailed(
                        "camera recovery exhausted after "
                                + MAX_INTERNAL_CAMERA_RECOVERY_ATTEMPTS
                                + " attempts: "
                                + lastReason.getMessage()
                )
        );
    }

    private long computeRecoveryDelayMs(int attempt) {
        long delayMs = CAMERA_RECOVERY_DELAY_BASE_MS;
        for (int index = 1; index < attempt; index++) {
            delayMs = Math.min(delayMs * 2L, CAMERA_RECOVERY_DELAY_MAX_MS);
        }
        return delayMs;
    }

    private void requestStop(StopReason reason) {
        if (stopping.get()) {
            return;
        }
        if (stopReported.compareAndSet(false, true)) {
            stopCallback.accept(reason);
        }
    }

    private String sanitizeExceptionMessage(Throwable throwable) {
        if (throwable == null) {
            return "unknown error";
        }

        Throwable cause = throwable.getCause() != null ? throwable.getCause() : throwable;
        String message = cause.getMessage();
        if (message != null && !message.trim().isEmpty()) {
            return message.trim();
        }
        return cause.toString();
    }

    private void closeCurrentPipeline(CameraDevice callbackCamera) {
        synchronized (cameraLock) {
            closeCaptureSessionLocked();
            closeStillImageReaderLocked();
            if (callbackCamera != null) {
                closeCameraDeviceLocked(callbackCamera);
            } else if (cameraDevice != null) {
                closeCameraDeviceLocked(cameraDevice);
            }
        }
    }

    private void closeCaptureSession(CameraCaptureSession session) {
        try {
            session.close();
        } catch (RuntimeException e) {
            // Ignore close failures during teardown and recovery.
        }
        synchronized (cameraLock) {
            if (captureSession == session) {
                captureSession = null;
            }
        }
    }

    private void closeCaptureSessionLocked() {
        if (captureSession == null) {
            return;
        }

        try {
            captureSession.stopRepeating();
        } catch (CameraAccessException | RuntimeException e) {
            // Ignore errors during cleanup.
        }
        try {
            captureSession.abortCaptures();
        } catch (CameraAccessException | RuntimeException e) {
            // Ignore errors during cleanup.
        }
        try {
            captureSession.close();
        } catch (RuntimeException e) {
            // Ignore errors during cleanup.
        }
        captureSession = null;
    }

    private void closeStillImageReaderLocked() {
        if (stillImageReader == null) {
            return;
        }

        try {
            stillImageReader.setOnImageAvailableListener(null, null);
            stillImageReader.close();
        } catch (RuntimeException e) {
            // Ignore cleanup failures during teardown and recovery.
        }
        stillImageReader = null;
        stillCaptureSize = null;
    }

    private void closeCameraDeviceLocked(CameraDevice camera) {
        try {
            camera.close();
        } catch (RuntimeException e) {
            // Ignore camera close failures during teardown and recovery.
        }
        if (cameraDevice == camera) {
            cameraDevice = null;
        }
    }

    private void clearPendingStillImage(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            while (image != null) {
                image.close();
                image = reader.acquireLatestImage();
            }
        } catch (RuntimeException e) {
            if (image != null) {
                image.close();
            }
        }
    }

    /**
     * Pick the closest supported auto-exposure FPS range for the requested frame rate.
     */
    private static Range<Integer> selectFpsRange(
            CameraCharacteristics characteristics,
            int targetFps
    ) {
        Range<Integer>[] ranges = characteristics.get(
                CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES
        );
        if (ranges == null || ranges.length == 0) {
            return null;
        }

        int[][] candidates = new int[ranges.length][2];
        for (int index = 0; index < ranges.length; index++) {
            Range<Integer> range = ranges[index];
            candidates[index][0] = range.getLower();
            candidates[index][1] = range.getUpper();
        }

        FpsRangeSelector.Selection selection = FpsRangeSelector.select(candidates, targetFps);
        System.out.println(
                "[Camera] AE FPS candidates for target "
                        + targetFps
                        + " fps: "
                        + FpsRangeSelector.describeCandidates(candidates, targetFps)
        );

        if (selection == null) {
            return null;
        }

        return ranges[selection.index];
    }
}
