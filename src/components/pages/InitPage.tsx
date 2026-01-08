"use client";
import { motion } from "framer-motion";
import { Sparkles, ShieldCheck, Camera, Rocket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENROUTER_BASE_URL,
  useAiStore,
} from "@/store/ai-store";
import { useSettingsStore } from "@/store/settings-store";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Label } from "../ui/label";
import { Trans, useTranslation } from "react-i18next";

export default function InitPage() {
  const sources = useAiStore((s) => s.sources);
  const activeSourceId = useAiStore((s) => s.activeSourceId);
  const setActiveSource = useAiStore((s) => s.setActiveSource);
  const updateSource = useAiStore((s) => s.updateSource);
  const setSkipInit = useSettingsStore((s) => s.setSkipInit);

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? sources[0],
    [sources, activeSourceId],
  );

  const [key, setKey] = useState(activeSource?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState<string | undefined>(
    activeSource?.baseUrl,
  );

  useEffect(() => {
    setKey(activeSource?.apiKey ?? "");
    setBaseUrl(activeSource?.baseUrl);
  }, [activeSource]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation("commons", { keyPrefix: "init-page" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSource) return;
    const trimmedKey = key.trim();
    if (!trimmedKey) return;

    const trimmedBase = (baseUrl ?? "").trim();
    
    let defaultBaseUrl = "";
    if (activeSource.provider === "gemini") {
      defaultBaseUrl = DEFAULT_GEMINI_BASE_URL;
    } else if (activeSource.provider === "openai") {
      defaultBaseUrl = DEFAULT_OPENAI_BASE_URL;
    } else {
      defaultBaseUrl = DEFAULT_OPENROUTER_BASE_URL;
    }

    updateSource(activeSource.id, {
      apiKey: trimmedKey || null,
      baseUrl: trimmedBase || defaultBaseUrl,
      enabled: true,
    });
    const from = searchParams.get("from");
    const to = from && from !== "/init" ? from : "/";
    router.replace(to);
  };

  const handleSkip = () => {
    setSkipInit(true);
    const from = searchParams.get("from");
    const to = from && from !== "/init" ? from : "/";
    router.replace(to);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b">
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]">
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.12]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="grid"
              width="32"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 32 0 L 0 0 0 32"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[380px] w-[380px] rounded-full bg-fuchsia-500/20 blur-3xl" />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6" />
          <span className="text-lg font-semibold tracking-tight">
            SkidHomework
          </span>
        </div>
        <div className="text-sm">{t("tagline")}</div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-6">
        <section className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-balance text-4xl font-bold leading-tight tracking-tight md:text-5xl"
            >
              <span className="bg-gradient-to-r from-indigo-300 via-slate-500 dark:via-white to-fuchsia-300 bg-clip-text text-transparent">
                {t("headline.highlight")}
              </span>
              <br />
              <span>{t("headline.subtitle")}</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08 }}
              className="mt-5 max-w-prose"
            >
              {t("intro")}
            </motion.p>

            <motion.ul
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16 }}
              className="mt-6 grid gap-3 text-sm"
            >
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> {t("features.telemetry")}
              </li>
              <li className="flex items-center gap-2">
                <Camera className="h-4 w-4" /> {t("features.camera")}
              </li>
              <li className="flex items-center gap-2">
                <Rocket className="h-4 w-4" /> {t("features.setup")}
              </li>
            </motion.ul>

            {/* Main form for API key submission */}
            <motion.form
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.24 }}
              className="mt-8 space-y-4"
            >
              <div className="w-full max-w-md">
                <Label htmlFor="provider" className="mb-1 block text-xs">
                  {t("form.provider.label")}
                </Label>
                <select
                  id="provider"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  value={activeSource?.id}
                  onChange={(event) => setActiveSource(event.target.value)}
                >
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex w-full max-w-md items-center gap-3">
                <Input
                  type="password"
                  placeholder={t("form.key-placeholder", {
                    provider: activeSource?.name ?? "",
                  })}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className="h-11 flex-1 focus-visible:ring-indigo-500"
                />
                <Button type="submit" className="h-11 px-5">
                  {t("form.submit")}
                </Button>
              </div>

              {/* START: Advanced settings section, collapsible */}
              <Accordion type="single" collapsible className="w-full max-w-md">
                <AccordionItem value="advanced-settings" className="border-b-0">
                  <AccordionTrigger className="text-sm hover:no-underline">
                    {t("form.advanced.title")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 mx-1">
                      {/* Input for custom API Base URL */}
                      <Label htmlFor="base-url" className="text-xs">
                        {t("form.advanced.base-url-label")}
                      </Label>
                      <Input
                        id="base-url"
                        type="url"
                        placeholder={t("form.advanced.base-url-placeholder", {
                          provider: activeSource?.name ?? "",
                        })}
                        value={baseUrl ?? ""}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className="placeholder:text-slate-500 focus-visible:ring-indigo-500"
                      />
                      <p className="text-xs text-slate-400">
                        {t("form.advanced.base-url-helper", {
                          provider: activeSource?.name ?? "",
                        })}
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              {/* END: Advanced settings section */}
            </motion.form>

            <div className="mt-4 w-full max-w-md flex justify-center">
              <Button 
                variant="ghost" 
                onClick={handleSkip} 
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {t("form.skip")}
              </Button>
            </div>

            <p className="mt-3 text-xs text-slate-400">
              {activeSource?.provider === "gemini" ? (
                <Trans
                  t={t}
                  i18nKey="form.api-hint"
                  components={{
                    link: (
                      <a
                        href="https://aistudio.google.com/api-keys"
                        className="underline"
                      />
                    ),
                  }}
                />
              ) : activeSource?.provider === "openrouter" ? (
                <Trans
                  t={t}
                  i18nKey="form.api-hint-openrouter"
                  components={{
                    link: (
                      <a
                        href="https://openrouter.ai/keys"
                        className="underline"
                      />
                    ),
                  }}
                />
              ) : (
                <Trans
                  t={t}
                  i18nKey="form.api-hint-openai"
                  components={{
                    link: (
                      <a
                        href="https://platform.openai.com/settings/organization/api-keys"
                        className="underline"
                      />
                    ),
                  }}
                />
              )}
            </p>

            <p className="mt-3 text-xs text-slate-400">
              {t("form.storage-note")}
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative"
          >
            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 shadow-2xl backdrop-blur">
              <div className="mb-4 flex items-center gap-2 text-slate-300">
                <Camera className="h-5 w-5" />
                <span className="text-sm">{t("preview.title")}</span>
              </div>
              <div className="aspect-[16/10] w-full rounded-xl bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 ring-1 ring-white/10" />
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-slate-300">
                <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                  {t("preview.ocr")}
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                  {t("preview.steps")}
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                  {t("preview.hints")}
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 mx-auto max-w-6xl px-6 pb-10 text-xs text-slate-500">
        <div className="opacity-80">
          {t("footer.notice")}{" "}
          <a
            href="https://github.com/cubewhy/skid-homework"
            className="underline"
          >
            {/* {t("footer.source")} */}
            https://github.com/cubewhy/skid-homework
          </a>
        </div>
      </footer>
    </div>
  );
}
