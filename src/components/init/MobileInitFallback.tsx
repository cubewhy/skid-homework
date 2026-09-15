"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useInitStore } from "@/store/init-store";

export default function MobileInitFallback() {
  const setInitCompleted = useInitStore((s) => s.setInitCompleted);
  const router = useRouter();

  useEffect(() => {
    setInitCompleted(true);
    router.replace("/");
  }, [setInitCompleted, router]);

  return null;
}
