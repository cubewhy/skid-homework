"use client";

import "../i18n";

import {useEffect} from "react";
import {ThemeProvider} from "@/components/theme-provider";
import {Toaster} from "@/components/ui/sonner";
import i18n from "@/i18n";
import {useSettingsStore} from "@/store/settings-store";

export default function Providers({ children }: { children: React.ReactNode }) {
  const language = useSettingsStore((state) => state.language);
  const initializeLanguage = useSettingsStore(
    (state) => state.initializeLanguage,
  );

  useEffect(() => {
    initializeLanguage();
  }, [initializeLanguage]);

  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  return (
    <ThemeProvider defaultTheme="system" storageKey="theme">
      <div className="safe-area app-scroll-container">{children}</div>
      <Toaster />
    </ThemeProvider>
  );
}
