"use client";
import { useEffect, useState, type PropsWithChildren } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useInitStore } from "@/store/init-store";

export default function RequireInit({ children }: PropsWithChildren) {
  const initCompleted = useInitStore((s) => s.initCompleted);
  const router = useRouter();
  const pathname = usePathname();

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const isHydrated = useInitStore.persist?.hasHydrated?.() ?? false;
    if (isHydrated) {
      queueMicrotask(() => {
        setHydrated(true);
      });
    }

    const unsub = useInitStore.persist?.onFinishHydration?.(() => {
      setHydrated(true);
    });

    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!hydrated || initCompleted || pathname === "/init") return;
    router.replace("/init");
  }, [hydrated, initCompleted, pathname, router]);

  if (!hydrated || !initCompleted) {
    return null;
  }

  return children;
}
