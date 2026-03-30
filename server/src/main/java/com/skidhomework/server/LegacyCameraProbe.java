package com.skidhomework.server;

import android.content.Context;
import android.graphics.SurfaceTexture;
import android.hardware.Camera;
import android.os.Handler;
import android.os.HandlerThread;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Minimal shell-only probe for the legacy camera1 API.
 *
 * <p>This intentionally avoids Camera2 {@code createCaptureSession(...)} so we can
 * verify on-device whether the shell UID is blocked by the Nothing/HyperOS Camera2
 * thermal path specifically, or whether all camera stacks are blocked.
 */
@SuppressWarnings("deprecation")
public final class LegacyCameraProbe {

    private LegacyCameraProbe() {
    }

    public static void main(String[] args) {
        HandlerThread cameraThread = new HandlerThread("LegacyCameraProbe");
        cameraThread.start();
        Handler cameraHandler = new Handler(cameraThread.getLooper());

        AtomicReference<Camera> cameraRef = new AtomicReference<>();
        AtomicReference<SurfaceTexture> surfaceTextureRef = new AtomicReference<>();
        AtomicReference<Throwable> failureRef = new AtomicReference<>();
        CountDownLatch resultLatch = new CountDownLatch(1);
        AtomicInteger previewFrameBytes = new AtomicInteger(0);

        try {
            cameraHandler.post(() -> {
                try {
                    int cameraId = 0;
                    System.out.println(
                            "[LegacyCameraProbe] Opening legacy camera "
                                    + cameraId
                                    + " on thread "
                                    + Thread.currentThread().getName()
                                    + "..."
                    );
                    Context shellContext = CameraSupport.createShellContext();
                    if (shellContext == null) {
                        throw new IllegalStateException("Failed to create shell context.");
                    }
                    int rotationOverride = CameraSupport.callWithTemporarilyShellApplication(
                            () -> Integer.valueOf(resolveRotationOverride(shellContext))
                    ).intValue();
                    Camera camera = openLegacyCamera(cameraId, shellContext, rotationOverride);
                    cameraRef.set(camera);
                    System.out.println("[LegacyCameraProbe] Camera.open succeeded.");

                    Camera.Size previewSize = configureLegacyCamera(camera);
                    camera.setErrorCallback((error, activeCamera) -> System.err.println(
                            "[LegacyCameraProbe] Camera error callback code=" + error + "."
                    ));

                    SurfaceTexture surfaceTexture = new SurfaceTexture(0);
                    if (previewSize != null) {
                        surfaceTexture.setDefaultBufferSize(
                                previewSize.width,
                                previewSize.height
                        );
                        System.out.println(
                                "[LegacyCameraProbe] SurfaceTexture buffer size="
                                        + previewSize.width
                                        + "x"
                                        + previewSize.height
                                        + "."
                        );
                    }
                    surfaceTextureRef.set(surfaceTexture);
                    camera.setPreviewTexture(surfaceTexture);
                    camera.startPreview();
                    System.out.println("[LegacyCameraProbe] startPreview succeeded.");

                    camera.setOneShotPreviewCallback((data, activeCamera) -> {
                        previewFrameBytes.set(data == null ? 0 : data.length);
                        System.out.println(
                                "[LegacyCameraProbe] Preview callback returned bytes="
                                        + previewFrameBytes.get()
                                        + " on thread "
                                        + Thread.currentThread().getName()
                                        + "."
                        );
                        resultLatch.countDown();
                    });
                } catch (Throwable throwable) {
                    failureRef.set(throwable);
                    resultLatch.countDown();
                }
            });

            if (!resultLatch.await(4L, TimeUnit.SECONDS)) {
                throw new IllegalStateException("One-shot preview callback timed out.");
            }

            Throwable failure = failureRef.get();
            if (failure != null) {
                throw failure;
            }

            if (previewFrameBytes.get() <= 0) {
                throw new IllegalStateException("Preview callback returned empty frame bytes.");
            }

            System.out.println("[LegacyCameraProbe] Success.");
        } catch (Throwable throwable) {
            String message = throwable.getMessage() == null
                    ? throwable.toString()
                    : throwable.getMessage();
            System.err.println("[LegacyCameraProbe] Failed: " + message);
            throwable.printStackTrace(System.err);
            System.exit(1);
        } finally {
            CountDownLatch cleanupLatch = new CountDownLatch(1);
            cameraHandler.post(() -> {
                try {
                    Camera camera = cameraRef.get();
                    if (camera != null) {
                        try {
                            camera.stopPreview();
                        } catch (RuntimeException ignored) {
                            // Ignore cleanup failures during probing.
                        }
                        try {
                            camera.release();
                        } catch (RuntimeException ignored) {
                            // Ignore cleanup failures during probing.
                        }
                    }

                    SurfaceTexture surfaceTexture = surfaceTextureRef.get();
                    if (surfaceTexture != null) {
                        try {
                            surfaceTexture.release();
                        } catch (RuntimeException ignored) {
                            // Ignore cleanup failures during probing.
                        }
                    }
                } finally {
                    cleanupLatch.countDown();
                }
            });
            try {
                cleanupLatch.await(2L, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            cameraThread.quitSafely();
        }
    }

    private static Camera.Size configureLegacyCamera(Camera camera) {
        Camera.Parameters parameters = camera.getParameters();

        List<String> supportedFocusModes = parameters.getSupportedFocusModes();
        if (supportedFocusModes != null
                && supportedFocusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
            parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
        }

        Camera.Size largestPictureSize = selectLargestSize(parameters.getSupportedPictureSizes());
        if (largestPictureSize != null) {
            parameters.setPictureSize(largestPictureSize.width, largestPictureSize.height);
            System.out.println(
                    "[LegacyCameraProbe] Picture size="
                            + largestPictureSize.width
                            + "x"
                            + largestPictureSize.height
                            + "."
            );
        }

        Camera.Size largestPreviewSize = selectLargestSize(parameters.getSupportedPreviewSizes());
        if (largestPreviewSize != null) {
            parameters.setPreviewSize(largestPreviewSize.width, largestPreviewSize.height);
            System.out.println(
                    "[LegacyCameraProbe] Preview size="
                            + largestPreviewSize.width
                            + "x"
                            + largestPreviewSize.height
                            + "."
            );
        }

        camera.setParameters(parameters);
        return largestPreviewSize;
    }

    private static Camera.Size selectLargestSize(List<Camera.Size> sizes) {
        if (sizes == null || sizes.isEmpty()) {
            return null;
        }

        Camera.Size bestSize = sizes.get(0);
        long bestArea = (long) bestSize.width * (long) bestSize.height;
        for (Camera.Size candidate : sizes) {
            long area = (long) candidate.width * (long) candidate.height;
            if (area > bestArea) {
                bestSize = candidate;
                bestArea = area;
            }
        }
        return bestSize;
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
}
