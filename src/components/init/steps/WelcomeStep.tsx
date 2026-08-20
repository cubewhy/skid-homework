"use client";
import { Camera, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function WelcomeStep() {
  const { t } = useTranslation("commons", { keyPrefix: "init-page.welcome" });

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex items-center gap-2">
        <Sparkles className="h-8 w-8 text-primary" />
        <span className="text-2xl font-bold tracking-tight">SkidHomework</span>
      </div>

      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("tagline")}</p>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {t("description")}
      </p>

      <div className="mt-8 grid w-full max-w-xs gap-3 text-left text-sm">
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          <span>{t("features.privacy")}</span>
        </div>
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <Camera className="h-4 w-4 shrink-0 text-primary" />
          <span>{t("features.camera")}</span>
        </div>
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <Rocket className="h-4 w-4 shrink-0 text-primary" />
          <span>{t("features.fast")}</span>
        </div>
      </div>
    </div>
  );
}
