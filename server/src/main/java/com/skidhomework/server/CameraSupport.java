package com.skidhomework.server;

import android.annotation.TargetApi;
import android.content.AttributionSource;
import android.content.Context;
import android.content.ContextWrapper;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.util.Size;

/**
 * Shared Camera2 helpers for shell-UID camera access.
 */
final class CameraSupport {

    private static final String SHELL_PACKAGE_NAME = "com.android.shell";

    private CameraSupport() {
    }

    private static final class FakeContext extends ContextWrapper {
        FakeContext(Context base) {
            super(base);
        }

        @Override
        public String getPackageName() {
            return SHELL_PACKAGE_NAME;
        }

        @Override
        public String getOpPackageName() {
            return SHELL_PACKAGE_NAME;
        }

        @Override
        public Context getApplicationContext() {
            return this;
        }

        @TargetApi(31)
        @Override
        public AttributionSource getAttributionSource() {
            AttributionSource.Builder builder = new AttributionSource.Builder(2000);
            builder.setPackageName(SHELL_PACKAGE_NAME);
            return builder.build();
        }

        @Override
        public Object getSystemService(String name) {
            if (Context.ACTIVITY_SERVICE.equals(name)) {
                return null;
            }
            return super.getSystemService(name);
        }
    }

    /**
     * Instantiate CameraManager with a shell-like context so shell UID camera access
     * keeps working on newer Android versions.
     */
    static CameraManager createShellCameraManager() throws Exception {
        Class<?> activityThreadClass = Class.forName("android.app.ActivityThread");
        Object activityThread = activityThreadClass.getMethod("systemMain").invoke(null);
        Context systemContext = (Context) activityThreadClass
                .getMethod("getSystemContext")
                .invoke(activityThread);
        Context shellContext = new FakeContext(systemContext);

        java.lang.reflect.Constructor<CameraManager> ctor =
                CameraManager.class.getDeclaredConstructor(Context.class);
        ctor.setAccessible(true);
        return ctor.newInstance(shellContext);
    }

    /**
     * Pick the highest-resolution output size whose aspect ratio most closely matches
     * the preview stream. Exact-ratio matches are preferred before falling back to the
     * nearest available ratio.
     */
    static Size selectOutputSize(
            CameraCharacteristics characteristics,
            int format,
            int referenceWidth,
            int referenceHeight
    ) {
        StreamConfigurationMap map = characteristics.get(
                CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP
        );
        if (map == null) {
            throw new IllegalStateException("Camera does not expose a stream configuration map.");
        }

        Size[] candidates = map.getOutputSizes(format);
        if (candidates == null || candidates.length == 0) {
            throw new IllegalStateException("Camera does not expose output sizes for format " + format + ".");
        }

        double targetAspect = normalizedAspectRatio(referenceWidth, referenceHeight);
        Size bestSize = candidates[0];
        double bestAspectDelta = Double.MAX_VALUE;
        long bestArea = -1L;

        for (Size candidate : candidates) {
            long candidateArea = (long) candidate.getWidth() * (long) candidate.getHeight();
            double candidateAspect = normalizedAspectRatio(candidate.getWidth(), candidate.getHeight());
            double aspectDelta = Math.abs(candidateAspect - targetAspect);

            if (aspectDelta < bestAspectDelta - 0.000_001d) {
                bestSize = candidate;
                bestAspectDelta = aspectDelta;
                bestArea = candidateArea;
                continue;
            }

            if (Math.abs(aspectDelta - bestAspectDelta) <= 0.000_001d && candidateArea > bestArea) {
                bestSize = candidate;
                bestArea = candidateArea;
            }
        }

        return bestSize;
    }

    static double normalizedAspectRatio(int width, int height) {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("Dimensions must be positive.");
        }

        int longer = Math.max(width, height);
        int shorter = Math.min(width, height);
        return (double) longer / (double) shorter;
    }
}
