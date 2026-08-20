"use client";
import type { PropsWithChildren } from "react";
import RequireAiKey from "@/components/guards/RequireAiKey";

export default function WebInitGuard({ children }: PropsWithChildren) {
  return <RequireAiKey fallback="/init">{children}</RequireAiKey>;
}
