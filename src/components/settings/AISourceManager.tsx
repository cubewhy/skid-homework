import AddAISourceDialog from "@/components/dialogs/settings/AddAISourceDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { AiSource, ImportAISourceModel, useAiStore } from "@/store/ai-store";
import { Plus, Share2Icon, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_BASE_BY_PROVIDER } from "./SettingsPage";
import ShareAISourceDialog from "@/components/dialogs/settings/ShareAISourceDialog";
import { toast } from "sonner";

export default function AISourceManager() {
  const { t } = useTranslation("commons", { keyPrefix: "settings-page" });
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const sources = useAiStore((s) => s.sources);
  const activeSourceId = useAiStore((s) => s.activeSourceId);
  const setActiveSource = useAiStore((s) => s.setActiveSource);
  const toggleSource = useAiStore((s) => s.toggleSource);
  const removeSource = useAiStore((s) => s.removeSource);

  const [shareDialogUrl, setShareDialogUrl] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const handleShareSource = (source: AiSource) => {
    const json: ImportAISourceModel = {
      name: source.name,
      provider: source.provider,
      baseUrl: source.baseUrl,
      key: source.apiKey ?? undefined,
      model: source.model,
    };

    // convert to url
    const url = `${window.location.origin}/settings/import#b64:${btoa(JSON.stringify(json))}`;

    setShareDialogUrl(url);
    setShareDialogOpen(true);
  };

  const canRemoveSource = sources.length > 1;

  const handleRemoveSource = (id: string) => {
    if (sources.length <= 1) {
      toast.error(t("sources.remove.error"));
      return;
    }
    const target = sources.find((source) => source.id === id);
    removeSource(id);
    if (target) {
      toast.success(
        t("sources.remove.success", {
          name: target.name,
        }),
      );
    }
  };

  return (
    <>
      <ShareAISourceDialog
        open={shareDialogOpen}
        onOpenChangeAction={setShareDialogOpen}
        url={shareDialogUrl}
      />
      <AddAISourceDialog open={addDialogOpen} onChange={setAddDialogOpen} />
      <Card>
        <CardHeader>
          <CardTitle>{t("sources.title")}</CardTitle>
          <CardDescription>{t("sources.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {t("sources.active.label")}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t("sources.add.label")}
            </Button>
          </div>

          <div className="space-y-2">
            {sources.map((source) => {
              const isActive = source.id === activeSourceId;
              return (
                <div
                  key={source.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between",
                    isActive && "border-primary",
                  )}
                  onClick={() => setActiveSource(source.id)}
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3 select-none">
                    <div>
                      <p className="text-sm font-medium">
                        {source.name}
                        <span className="ml-2 text-xs uppercase text-muted-foreground">
                          {t(`sources.providers.${source.provider}`)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {source.baseUrl ??
                          DEFAULT_BASE_BY_PROVIDER[source.provider]}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        onClick={(e) => e.stopPropagation()}
                        checked={source.enabled}
                        onCheckedChange={(state) =>
                          toggleSource(source.id, Boolean(state))
                        }
                      />
                      {t("sources.enabled.toggle")}
                    </label>

                    {/* Share button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleShareSource(source);
                      }}
                      aria-label={t("sources.share.label")}
                    >
                      <Share2Icon className="h-4 w-4" />
                    </Button>

                    {/* Delete button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveSource(source.id);
                      }}
                      disabled={!canRemoveSource}
                      aria-label={t("sources.remove.label")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
