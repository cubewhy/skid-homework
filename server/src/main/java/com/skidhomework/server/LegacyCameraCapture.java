package com.skidhomework.server;

import android.content.Context;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.SurfaceTexture;
import android.graphics.YuvImage;
import android.hardware.Camera;
import android.os.Handler;
import android.os.HandlerThread;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

@SuppressWarnings("deprecation")
public final class LegacyCameraCapture implements CameraCaptureBackend {

    private static final int CAMERA_START_TIMEOUT_SECONDS = 5;
    private static final int JPEG_QUALITY = 95;
    private static final int CALLBACK_BUFFER_COUNT = 3;

    private final String cameraId;
    private final int targetWidth;
    private final int targetHeight;
    private final int targetFps;
    private final Consumer<StopReason> stopCallback;
    private final HandlerThread cameraThread;
    private final Handler cameraHandler;
    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final AtomicBoolean stopReported = new AtomicBoolean(false);
    private final Object previewFrameLock = new Object();

    private Camera camera;
    private SurfaceTexture surfaceTexture;
    private int previewWidth;
    private int previewHeight;
    private int previewFormat = ImageFormat.NV21;
    private byte[] latestPreviewFrame;
    private volatile ByteBufferVideoEncoder encoder;

    public LegacyCameraCapture(
            String cameraId,
            int targetWidth,
            int targetHeight,
            int targetFps,
            Consumer<StopReason> stopCallback
    ) {
        this.cameraId = cameraId;
        this.targetWidth = targetWidth;
        this.targetHeight = targetHeight;
        this.targetFps = targetFps;
        this.stopCallback = stopCallback;

        cameraThread = new HandlerThread("LegacyCameraThread");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
    }

    @Override
    public void start() throws Exception {
        CountDownLatch startLatch = new CountDownLatch(1);
        AtomicReference<Throwable> failureRef = new AtomicReference<>();

        cameraHandler.post(() -> {
            try {
                startLegacyCameraOnThread();
            } catch (Throwable throwable) {
                failureRef.set(throwable);
            } finally {
                startLatch.countDown();
            }
        });

        if (!startLatch.await(CAMERA_START_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new RuntimeException(
                    "legacy camera start timed out after " + CAMERA_START_TIMEOUT_SECONDS + "s"
            );
        }

        Throwable failure = failureRef.get();
        if (failure != null) {
            if (failure instanceof Exception) {
                throw (Exception) failure;
            }
            throw new RuntimeException(failure);
        }
    }

    @Override
    public byte[] captureStillJpeg() throws Exception {
        byte[] latestFrameCopy = getLatestPreviewFrameCopy();
        if (latestFrameCopy == null || latestFrameCopy.length == 0) {
            throw new IllegalStateException("Legacy preview fallback has not produced a frame yet.");
        }

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream(latestFrameCopy.length);
        writePreviewFrameJpeg(latestFrameCopy, outputStream);
        return outputStream.toByteArray();
    }

    @Override
    public void streamStillJpeg(OutputStream outputStream) throws Exception {
        byte[] latestFrameCopy = getLatestPreviewFrameCopy();
        if (latestFrameCopy == null || latestFrameCopy.length == 0) {
            throw new IllegalStateException("Legacy preview fallback has not produced a frame yet.");
        }

        writePreviewFrameJpeg(latestFrameCopy, outputStream);
    }

    @Override
    public void stop() {
        if (!stopping.compareAndSet(false, true)) {
            return;
        }

        CountDownLatch cleanupLatch = new CountDownLatch(1);
        cameraHandler.post(() -> {
            try {
                cleanupCameraLocked();
            } finally {
                cleanupLatch.countDown();
            }
        });

        try {
            cleanupLatch.await(2L, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        cameraThread.quitSafely();
        try {
            cameraThread.join(1_000L);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public void attachEncoder(ByteBufferVideoEncoder encoder) {
        this.encoder = encoder;
    }

    public int getPreviewWidth() {
        return previewWidth;
    }

    public int getPreviewHeight() {
        return previewHeight;
    }

    private void startLegacyCameraOnThread() throws Exception {
        int numericCameraId = Integer.parseInt(cameraId);
        System.out.println(
                "[LegacyCamera] Starting shell-only preview fallback for camera "
                        + numericCameraId
                        + "."
        );

        Context shellContext = CameraSupport.createShellContext();
        if (shellContext == null) {
            throw new IllegalStateException("Failed to create shell context.");
        }

        int rotationOverride = CameraSupport.callWithTemporarilyShellApplication(
                () -> Integer.valueOf(resolveRotationOverride(shellContext))
        ).intValue();

        camera = openLegacyCamera(numericCameraId, shellContext, rotationOverride);
        if (camera == null) {
            throw new IllegalStateException("Camera.open returned null.");
        }

        camera.setErrorCallback((error, activeCamera) -> {
            if (stopping.get()) {
                return;
            }
            System.err.println("[LegacyCamera] Camera error callback code=" + error + ".");
            requestStop(StopReason.cameraError(error));
        });

        CameraParametersResult configuredParameters = configureLegacyCamera(camera);
        previewWidth = configuredParameters.previewWidth;
        previewHeight = configuredParameters.previewHeight;
        previewFormat = configuredParameters.previewFormat;
        latestPreviewFrame = new byte[configuredParameters.previewFrameByteCount];

        surfaceTexture = new SurfaceTexture(0);
        surfaceTexture.setDefaultBufferSize(previewWidth, previewHeight);
        camera.setPreviewTexture(surfaceTexture);

        int callbackBufferSize = configuredParameters.previewFrameByteCount;
        camera.setPreviewCallbackWithBuffer((data, activeCamera) -> {
            if (data != null && data.length >= callbackBufferSize) {
                synchronized (previewFrameLock) {
                    if (latestPreviewFrame == null || latestPreviewFrame.length != callbackBufferSize) {
                        latestPreviewFrame = new byte[callbackBufferSize];
                    }
                    System.arraycopy(data, 0, latestPreviewFrame, 0, callbackBufferSize);
                }
                ByteBufferVideoEncoder activeEncoder = encoder;
                if (activeEncoder != null) {
                    activeEncoder.queueNv21Frame(data, System.nanoTime());
                }
            }

            if (!stopping.get() && data != null) {
                try {
                    activeCamera.addCallbackBuffer(data);
                } catch (RuntimeException ignored) {
                    // Ignore buffer recycle failures during shutdown.
                }
            }
        });

        for (int index = 0; index < CALLBACK_BUFFER_COUNT; index++) {
            camera.addCallbackBuffer(new byte[callbackBufferSize]);
        }

        camera.startPreview();
        System.out.println(
                "[LegacyCamera] Preview fallback started at "
                        + previewWidth
                        + "x"
                        + previewHeight
                        + ", fpsTarget="
                        + targetFps
                        + "."
        );
    }

    private CameraParametersResult configureLegacyCamera(Camera activeCamera) {
        Camera.Parameters parameters = activeCamera.getParameters();

        List<String> supportedFocusModes = parameters.getSupportedFocusModes();
        if (supportedFocusModes != null
                && supportedFocusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)) {
            parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);
        } else if (supportedFocusModes != null
                && supportedFocusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
            parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
        }

        if (parameters.getSupportedPreviewFormats() != null
                && parameters.getSupportedPreviewFormats().contains(ImageFormat.NV21)) {
            parameters.setPreviewFormat(ImageFormat.NV21);
        } else {
            throw new IllegalStateException("Legacy preview fallback requires NV21 preview support.");
        }

        Camera.Size selectedPreviewSize = selectPreviewSize(
                parameters.getSupportedPreviewSizes(),
                targetWidth,
                targetHeight
        );
        if (selectedPreviewSize == null) {
            throw new IllegalStateException(
                    "Legacy preview fallback could not select a preview size. Supported sizes: "
                            + describePreviewSizes(parameters.getSupportedPreviewSizes())
            );
        }
        parameters.setPreviewSize(selectedPreviewSize.width, selectedPreviewSize.height);

        if (parameters.getSupportedPreviewFpsRange() != null) {
            int[] fpsRange = selectPreviewFpsRange(parameters.getSupportedPreviewFpsRange(), targetFps);
            if (fpsRange != null) {
                parameters.setPreviewFpsRange(fpsRange[0], fpsRange[1]);
            }
        }

        try {
            parameters.setRecordingHint(true);
        } catch (RuntimeException ignored) {
            // Ignore vendor-specific recording-hint failures.
        }

        activeCamera.setParameters(parameters);
        Camera.Parameters appliedParameters = activeCamera.getParameters();
        Camera.Size appliedPreviewSize = appliedParameters.getPreviewSize();
        int appliedPreviewFormat = appliedParameters.getPreviewFormat();
        int bitsPerPixel = ImageFormat.getBitsPerPixel(appliedPreviewFormat);
        int previewFrameByteCount = bitsPerPixel > 0
                ? (appliedPreviewSize.width * appliedPreviewSize.height * bitsPerPixel) / 8
                : (appliedPreviewSize.width * appliedPreviewSize.height * 3) / 2;

        System.out.println(
                "[LegacyCamera] Preview size="
                        + appliedPreviewSize.width
                        + "x"
                        + appliedPreviewSize.height
                        + ", format="
                        + appliedPreviewFormat
                        + ", frameBytes="
                        + previewFrameByteCount
                        + "."
        );

        return new CameraParametersResult(
                appliedPreviewSize.width,
                appliedPreviewSize.height,
                appliedPreviewFormat,
                previewFrameByteCount
        );
    }

    private Camera.Size selectPreviewSize(
            List<Camera.Size> sizes,
            int referenceWidth,
            int referenceHeight
    ) {
        if (sizes == null || sizes.isEmpty()) {
            return null;
        }

        double targetAspect = CameraSupport.normalizedAspectRatio(referenceWidth, referenceHeight);
        long targetArea = (long) Math.max(1, referenceWidth) * (long) Math.max(1, referenceHeight);
        Camera.Size bestSize = sizes.get(0);
        double bestAspectDelta = Double.MAX_VALUE;
        long bestAreaDelta = Long.MAX_VALUE;

        for (Camera.Size candidate : sizes) {
            long candidateArea = (long) candidate.width * (long) candidate.height;
            double candidateAspect = CameraSupport.normalizedAspectRatio(
                    candidate.width,
                    candidate.height
            );
            double aspectDelta = Math.abs(candidateAspect - targetAspect);
            long areaDelta = Math.abs(candidateArea - targetArea);

            if (aspectDelta < bestAspectDelta - 0.000_001d) {
                bestSize = candidate;
                bestAspectDelta = aspectDelta;
                bestAreaDelta = areaDelta;
                continue;
            }

            if (Math.abs(aspectDelta - bestAspectDelta) <= 0.000_001d && areaDelta < bestAreaDelta) {
                bestSize = candidate;
                bestAreaDelta = areaDelta;
            }
        }

        return bestSize;
    }

    private int[] selectPreviewFpsRange(List<int[]> ranges, int requestedFps) {
        if (ranges == null || ranges.isEmpty()) {
            return null;
        }

        int requestedScaledFps = Math.max(1, requestedFps) * 1000;
        int[] bestRange = ranges.get(0);
        long bestScore = Long.MAX_VALUE;

        for (int[] range : ranges) {
            if (range == null || range.length < 2) {
                continue;
            }

            long lowerDelta = Math.abs((long) range[0] - requestedScaledFps);
            long upperDelta = Math.abs((long) range[1] - requestedScaledFps);
            long score = lowerDelta + upperDelta;
            if (score < bestScore) {
                bestRange = range;
                bestScore = score;
            }
        }

        return bestRange;
    }

    private String describePreviewSizes(List<Camera.Size> sizes) {
        if (sizes == null || sizes.isEmpty()) {
            return "none";
        }

        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < sizes.size(); index++) {
            if (index > 0) {
                builder.append(", ");
            }
            Camera.Size size = sizes.get(index);
            builder.append(size.width).append('x').append(size.height);
        }
        return builder.toString();
    }

    private byte[] getLatestPreviewFrameCopy() {
        synchronized (previewFrameLock) {
            if (latestPreviewFrame == null) {
                return null;
            }
            byte[] copy = new byte[latestPreviewFrame.length];
            System.arraycopy(latestPreviewFrame, 0, copy, 0, latestPreviewFrame.length);
            return copy;
        }
    }

    private void writePreviewFrameJpeg(byte[] previewFrameNv21, OutputStream outputStream)
            throws IOException {
        YuvImage image = new YuvImage(
                previewFrameNv21,
                previewFormat,
                previewWidth,
                previewHeight,
                null
        );
        boolean encoded = image.compressToJpeg(
                new Rect(0, 0, previewWidth, previewHeight),
                JPEG_QUALITY,
                outputStream
        );
        if (!encoded) {
            throw new IOException("Legacy preview fallback failed to encode a JPEG still.");
        }
        outputStream.flush();
    }

    private void cleanupCameraLocked() {
        if (camera != null) {
            try {
                camera.setPreviewCallbackWithBuffer(null);
            } catch (RuntimeException ignored) {
                // Ignore cleanup failures during shutdown.
            }
            try {
                camera.stopPreview();
            } catch (RuntimeException ignored) {
                // Ignore cleanup failures during shutdown.
            }
            try {
                camera.release();
            } catch (RuntimeException ignored) {
                // Ignore cleanup failures during shutdown.
            }
            camera = null;
        }

        if (surfaceTexture != null) {
            try {
                surfaceTexture.release();
            } catch (RuntimeException ignored) {
                // Ignore cleanup failures during shutdown.
            }
            surfaceTexture = null;
        }
    }

    private void requestStop(StopReason reason) {
        if (stopReported.compareAndSet(false, true)) {
            stopCallback.accept(reason);
        }
    }

    private static int resolveRotationOverride(Context context) throws Exception {
        Class<?> cameraManagerClass = Class.forName("android.hardware.camera2.CameraManager");
        java.lang.reflect.Method method = cameraManagerClass.getDeclaredMethod(
                "getRotationOverride",
                Context.class
        );
        method.setAccessible(true);
        return ((Integer) method.invoke(null, context)).intValue();
    }

    private static Camera openLegacyCamera(
            int cameraId,
            Context context,
            int rotationOverride
    ) throws Exception {
        java.lang.reflect.Method method = Camera.class.getDeclaredMethod(
                "open",
                int.class,
                Context.class,
                int.class
        );
        method.setAccessible(true);
        return (Camera) method.invoke(null, cameraId, context, rotationOverride);
    }

    private static final class CameraParametersResult {
        final int previewWidth;
        final int previewHeight;
        final int previewFormat;
        final int previewFrameByteCount;

        CameraParametersResult(
                int previewWidth,
                int previewHeight,
                int previewFormat,
                int previewFrameByteCount
        ) {
            this.previewWidth = previewWidth;
            this.previewHeight = previewHeight;
            this.previewFormat = previewFormat;
            this.previewFrameByteCount = previewFrameByteCount;
        }
    }
}
