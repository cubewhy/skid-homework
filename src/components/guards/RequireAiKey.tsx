"use client";
import { useEffect, useState, type PropsWithChildren } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHasActiveAiKey, useAiStore } from "@/store/ai-store";

type RequireAiKeyProps = PropsWithChildren<{
  fallback: string;
}>;

export default function RequireAiKey({
  children,
  fallback,
}: RequireAiKeyProps) {
  const hasKey = useHasActiveAiKey();
  const router = useRouter();
  const pathname = usePathname();

  // Initialize hydration state to false to prevent SSR mismatch.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const isHydrated = useAiStore.persist?.hasHydrated?.() ?? false;
    if (isHydrated) {
      // Use queueMicrotask in useEffect to safely update the hydration state
      queueMicrotask(() => {
        setHydrated(true);
      });
    }

    const unsub = useAiStore.persist?.onFinishHydration?.(() => {
      setHydrated(true);
    });

    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!hydrated || hasKey || pathname === fallback) return;
    const params = new URLSearchParams();
    if (pathname) {
      params.set("from", pathname);
    }
    router.replace(`${fallback}?${params.toString()}`);
  }, [fallback, hasKey, hydrated, pathname, router]);

  if (!hydrated || !hasKey) {
    return null;
  }

  return children;
}
