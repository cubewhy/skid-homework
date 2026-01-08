"use client";
import { useEffect, useState, type PropsWithChildren } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHasActiveAiKey, useAiStore } from "@/store/ai-store";
import { useSettingsStore } from "@/store/settings-store";

type RequireAiKeyProps = PropsWithChildren<{
  fallback: string;
}>;

export default function RequireAiKey({
  children,
  fallback,
}: RequireAiKeyProps) {
  const hasKey = useHasActiveAiKey();
  const skipInit = useSettingsStore((s) => s.skipInit);
  const router = useRouter();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const alreadyHydrated = useAiStore.persist?.hasHydrated?.();
    if (alreadyHydrated) {
      setHydrated(true);
      return;
    }

    const unsub = useAiStore.persist?.onFinishHydration?.(() => {
      setHydrated(true);
    });

    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!hydrated || hasKey || skipInit || pathname === fallback) return;
    const params = new URLSearchParams();
    if (pathname) {
      params.set("from", pathname);
    }
    router.replace(`${fallback}?${params.toString()}`);
  }, [fallback, hasKey, skipInit, hydrated, pathname, router]);

  if (!hydrated || (!hasKey && !skipInit)) {
    return null;
  }

  return children;
}
