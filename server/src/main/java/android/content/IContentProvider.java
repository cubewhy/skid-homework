package android.content;

/**
 * Compile-time stub for the hidden framework interface.
 *
 * <p>The device-side server runs via {@code app_process}, so the real framework
 * definition from the boot class path is used at runtime. The custom server build
 * script compiles against the public SDK stubs only, which do not expose this type.
 */
public interface IContentProvider {
}
