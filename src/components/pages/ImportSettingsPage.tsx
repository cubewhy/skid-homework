"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

// UI Components (Adjust import paths based on your project structure)
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AiProvider, ImportAISourceModel, useAiStore } from "@/store/ai-store";

function resolveConfig(hash: string): ImportAISourceModel {
  const payload = hash.substring(1);
  let decodedString = decodeURIComponent(payload);
  if (decodedString.startsWith("b64:")) {
    decodedString = atob(decodedString.substring(4));
  }

  const parsedData = JSON.parse(decodedString);

  // Basic validation checking if necessary fields exist
  if (!parsedData.name || !parsedData.provider) {
    throw new Error("Missing required fields (name or provider).");
  }

  return parsedData;
}

export default function ImportSettingsPage() {
  const router = useRouter();
  const { t } = useTranslation("commons", {
    keyPrefix: "import-settings-page",
  });

  // State
  const [modelJson, setModelJson] = useState<ImportAISourceModel | null>(null);
  const [errorKey, setErrorKey] = useState<"error.parse-failed" | null>(null);
  const [isImported, setIsImported] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const sourceId = useRef<null | string>(null);
  const previousModel = useRef<string | null>(null);

  const { addSource, removeSource, setCurrentModel, currentModel } = useAiStore(
    (s) => s
  );

  useEffect(() => {
    // 1. Get the hash from the URL
    const hash = window.location.hash;

    if (!hash) {
      router.replace("/");
      return;
    }

    try {
      const parsedData = resolveConfig(hash);

      setModelJson(parsedData);
    } catch (err) {
      console.error(err);
      setErrorKey("error.parse-failed");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  // Handler: User confirms import
  const handleConfirmImport = () => {
    if (!modelJson) return;

    const newSourceId = addSource({
      apiKey: modelJson.key ?? null,
      name: modelJson.name,
      provider: modelJson.provider.toLowerCase() as AiProvider,
      baseUrl: modelJson.baseUrl,
      enabled: true,
    });

    // If the imported config has a model, set it as the current model
    if (modelJson.model) {
      previousModel.current = currentModel;
      setCurrentModel(modelJson.model);
    }

    sourceId.current = newSourceId;

    setIsImported(true);
  };

  // Handler: User cancels
  const handleCancel = () => {
    router.push("/");
  };

  const handleUndo = () => {
    if (!sourceId.current) return;

    removeSource(sourceId.current);

    // Restore the previous model if it was changed during import
    if (previousModel.current !== null) {
      setCurrentModel(previousModel.current);
      previousModel.current = null;
    }

    setIsImported(false);
  };

  // ------------------------------------------------------------------
  // Render Views
  // ------------------------------------------------------------------

  // View 1: Error State
  if (errorKey) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-muted/40">
        <Card className="w-full max-w-md border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" /> {t("error.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>{t(errorKey)}</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => router.push("/")}>
              {t("error.home")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // View 2: Loading State
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {t("loading.parsing")}
        </p>
      </div>
    );
  }

  // View 3: Success State (After clicking Yes)
  if (isImported) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-muted/40">
        <Card className="w-full max-w-md text-center py-10">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("success.title")}
            </h2>
            <p className="text-muted-foreground">
              <Trans
                t={t}
                i18nKey="success.description"
                values={{ name: modelJson?.name ?? "" }}
                components={{ strong: <strong /> }}
              />
            </p>
          </CardContent>
          <CardFooter>
            <div className="flex flex-col w-full gap-2">
              <div className="flex w-full gap-2">
                <Button
                  onClick={() => router.push("/settings")}
                  variant="secondary"
                  className="flex-1"
                >
                  {t("success.buttons.settings")}
                </Button>
                <Button
                  onClick={handleUndo}
                  variant="destructive"
                  className="flex-1"
                >
                  {t("success.buttons.undo")}
                </Button>
              </div>
              <Button onClick={() => router.push("/")} className="flex-1">
                {t("success.buttons.home")}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // View 4: Confirmation State (Default)
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/40">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("confirm.title")}</CardTitle>
          <CardDescription>{t("confirm.description")}</CardDescription>
        </CardHeader>

        <CardContent>
          {modelJson && (
            <div className="grid gap-4 rounded-md border p-4 bg-card/50">
              <div className="grid grid-cols-[100px_1fr] items-center gap-1">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("confirm.fields.name")}
                </span>
                <span className="font-medium">{modelJson.name}</span>
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-1">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("confirm.fields.provider")}
                </span>
                <span className="font-medium capitalize">
                  {modelJson.provider}
                </span>
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-1">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("confirm.fields.model")}
                </span>
                <span className="text-sm truncate" title={modelJson.model}>
                  {modelJson.model}
                </span>
              </div>
              <div className="grid grid-cols-[100px_1fr] items-center gap-1">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("confirm.fields.base")}
                </span>
                <span className="text-sm truncate" title={modelJson.baseUrl}>
                  {modelJson.baseUrl}
                </span>
              </div>
            </div>
          )}

          <Alert className="mt-4" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("confirm.alert.title")}</AlertTitle>
            <AlertDescription>
              {t("confirm.alert.description")}
            </AlertDescription>
          </Alert>
        </CardContent>

        <CardFooter className="flex justify-between gap-2">
          <Button variant="outline" onClick={handleCancel}>
            {t("confirm.buttons.cancel")}
          </Button>
          <Button onClick={handleConfirmImport}>
            {t("confirm.buttons.confirm")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
