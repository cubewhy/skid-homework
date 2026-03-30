package com.skidhomework.server;

import android.annotation.TargetApi;
import android.app.Application;
import android.content.AttributionSource;
import android.content.ContentResolver;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.IContentProvider;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Binder;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.util.Size;

/**
 * Shared Camera2 helpers for shell-UID camera access.
 */
final class CameraSupport {

    private static final String SHELL_PACKAGE_NAME = "com.android.shell";

    interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    private CameraSupport() {
    }

    private static final class FakeContext extends ContextWrapper {
        private final ContentResolver contentResolver = new ContentResolver(this) {
            @SuppressWarnings({"unused", "ProtectedMemberInFinalClass"}) // @Override (hidden on SDK stubs)
            protected IContentProvider acquireProvider(Context c, String name) {
                return acquireExternalProvider(name);
            }

            @SuppressWarnings("unused") // @Override (hidden on SDK stubs)
            public boolean releaseProvider(IContentProvider provider) {
                return false;
            }

            @SuppressWarnings({"unused", "ProtectedMemberInFinalClass"}) // @Override (hidden on SDK stubs)
            protected IContentProvider acquireUnstableProvider(Context c, String name) {
                return null;
            }

            @SuppressWarnings("unused") // @Override (hidden on SDK stubs)
            public boolean releaseUnstableProvider(IContentProvider provider) {
                return false;
            }

            @SuppressWarnings("unused") // @Override (hidden on SDK stubs)
            public void unstableProviderDied(IContentProvider provider) {
                // Ignore provider death; the scanner server process is short-lived and
                // will recreate the CameraManager on the next recovery loop.
            }
        };

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

        @Override
        public ContentResolver getContentResolver() {
            return contentResolver;
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

        private IContentProvider acquireExternalProvider(String name) {
            try {
                Binder token = new Binder();
                Object activityManager = Class.forName("android.app.ActivityManager")
                        .getMethod("getService")
                        .invoke(null);
                Object holder = invokeContentProviderExternal(activityManager, name, token);
                if (holder == null) {
                    return null;
                }

                java.lang.reflect.Field providerField = holder.getClass().getDeclaredField("provider");
                providerField.setAccessible(true);
                return (IContentProvider) providerField.get(holder);
            } catch (Exception e) {
                throw new RuntimeException("Failed to acquire external content provider " + name + ".", e);
            }
        }

        private Object invokeContentProviderExternal(
                Object activityManager,
                String name,
                Binder token
        ) throws Exception {
            Class<?> managerClass = activityManager.getClass();

            try {
                return managerClass
                        .getMethod(
                                "getContentProviderExternal",
                                String.class,
                                int.class,
                                android.os.IBinder.class,
                                String.class
                        )
                        .invoke(activityManager, name, 0, token, SHELL_PACKAGE_NAME);
            } catch (NoSuchMethodException ignored) {
                // Older releases use narrower signatures; fall through.
            }

            try {
                return managerClass
                        .getMethod(
                                "getContentProviderExternal",
                                String.class,
                                int.class,
                                android.os.IBinder.class
                        )
                        .invoke(activityManager, name, 0, token);
            } catch (NoSuchMethodException ignored) {
                // Android 8/9 era signature fallback.
            }

            return managerClass
                    .getMethod(
                            "getContentProviderExternal",
                            String.class,
                            android.os.IBinder.class
                    )
                    .invoke(activityManager, name, token);
        }
    }

    /**
     * Instantiate CameraManager with a shell-like context so shell UID camera access
     * keeps working on newer Android versions.
     *
     * <p>Android 16 CameraManager may consult Settings.Global through the context
     * ContentResolver while resolving rotation overrides. If the resolver still
     * belongs to the raw system context, AMS sees package "android" for uid 2000
     * and rejects the provider lookup. Build the wrapper on top of the real
     * com.android.shell package context so both the package name and resolver
     * attribution stay aligned with the shell UID.
     */
    static CameraManager createShellCameraManager() throws Exception {
        Context shellContext = createShellContext();
        if (shellContext == null) {
            return null;
        }

        java.lang.reflect.Constructor<CameraManager> ctor =
                CameraManager.class.getDeclaredConstructor(Context.class);
        ctor.setAccessible(true);
        return ctor.newInstance(shellContext);
    }

    static Context createShellContext() throws Exception {
        Class<?> activityThreadClass = Class.forName("android.app.ActivityThread");
        Object activityThread = activityThreadClass.getMethod("systemMain").invoke(null);
        if (activityThread == null) {
            return null;
        }
        Context systemContext = (Context) activityThreadClass
                .getMethod("getSystemContext")
                .invoke(activityThread);
        return new FakeContext(systemContext);
    }

    static CameraCharacteristics getCameraCharacteristics(
            CameraManager cameraManager,
            String cameraId
    ) throws Exception {
        return withTemporarilyShellApplication(
                () -> cameraManager.getCameraCharacteristics(cameraId)
        );
    }

    static <T> T callWithTemporarilyShellApplication(
            ThrowingSupplier<T> supplier
    ) throws Exception {
        return withTemporarilyShellApplication(supplier);
    }

    private static Application createShellApplication(Context shellPackageContext) throws Exception {
        Application application = new Application();
        java.lang.reflect.Method attachBaseContext = ContextWrapper.class
                .getDeclaredMethod("attachBaseContext", Context.class);
        attachBaseContext.setAccessible(true);
        attachBaseContext.invoke(application, shellPackageContext);
        return application;
    }

    private static <T> T withTemporarilyShellApplication(
            ThrowingSupplier<T> supplier
    ) throws Exception {
        Class<?> activityThreadClass = Class.forName("android.app.ActivityThread");
        Object activityThread = activityThreadClass.getMethod("currentActivityThread").invoke(null);
        if (activityThread == null) {
            return supplier.get();
        }

        java.lang.reflect.Field initialApplicationField =
                activityThreadClass.getDeclaredField("mInitialApplication");
        initialApplicationField.setAccessible(true);
        Object originalApplication = initialApplicationField.get(activityThread);
        Context systemContext = (Context) activityThreadClass
                .getMethod("getSystemContext")
                .invoke(activityThread);
        Application shellApplication = createShellApplication(new FakeContext(systemContext));
        initialApplicationField.set(activityThread, shellApplication);
        try {
            return supplier.get();
        } finally {
            initialApplicationField.set(activityThread, originalApplication);
        }
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
