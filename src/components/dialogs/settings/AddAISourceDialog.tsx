import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  useAiStore,
  type AiProvider,
} from "@/store/ai-store";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export type AddAISourceDialogProps = {
  onChange: (dialogOpen: boolean) => void;
  open: boolean;
};

export default function AddAISourceDialog({
  onChange,
  open,
}: AddAISourceDialogProps) {
  const { t } = useTranslation("commons", { keyPrefix: "settings-page" });

  const sources = useAiStore((s) => s.sources);
  const addSource = useAiStore((s) => s.addSource);
  const setActiveSource = useAiStore((s) => s.setActiveSource);

  const [newProvider, setNewProvider] = useState<AiProvider>("gemini");
  const [newSourceName, setNewSourceName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiAddress, setApiAddress] = useState("");

  const resetAddDialog = () => {
    setNewSourceName("");
    setNewProvider("gemini");
  };

  const handleAddDialogChange = (open: boolean) => {
    onChange(open);
    if (!open) {
      resetAddDialog();
    }
  };

  const handleAddSource = () => {
    const provider = newProvider;
    const counter =
      sources.filter((source) => source.provider === provider).length + 1;
    
    let defaultName = "";
    if (provider === "gemini") {
      defaultName = t("sources.providers.gemini") + ` #${counter}`;
    } else if (provider === "openai") {
      defaultName = t("sources.providers.openai") + ` #${counter}`;
    } else {
      defaultName = t("sources.providers.openrouter") + ` #${counter}`;
    }

    const name = newSourceName.trim() || defaultName;

    let defaultBaseUrl = "";
    if (provider === "gemini") {
      defaultBaseUrl = DEFAULT_GEMINI_BASE_URL;
    } else if (provider === "openai") {
      defaultBaseUrl = DEFAULT_OPENAI_BASE_URL;
    } else {
      defaultBaseUrl = DEFAULT_OPENROUTER_BASE_URL;
    }

    let defaultModel = "";
    if (provider === "gemini") {
      defaultModel = DEFAULT_GEMINI_MODEL;
    } else if (provider === "openai") {
      defaultModel = DEFAULT_OPENAI_MODEL;
    } else {
      defaultModel = DEFAULT_OPENROUTER_MODEL;
    }

    const newId = addSource({
      name,
      provider,
      apiKey: apiKey ?? null,
      baseUrl: apiAddress ?? defaultBaseUrl,
      model: defaultModel,
      traits: undefined,
      thinkingBudget: provider === "gemini" ? 8192 : undefined,
      enabled: true,
    });

    setActiveSource(newId);
    onChange(false);
    resetAddDialog();
    toast.success(
      t("sources.add.success", {
        name,
      }),
    );
  };

  const getPlaceholderUrl = () => {
    if (newProvider === "gemini") return DEFAULT_GEMINI_BASE_URL;
    if (newProvider === "openai") return DEFAULT_OPENAI_BASE_URL;
    return DEFAULT_OPENROUTER_BASE_URL;
  };

  return (
    <Dialog open={open} onOpenChange={handleAddDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sources.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-provider">{t("sources.add.provider")}</Label>
            <select
              id="new-provider"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={newProvider}
              onChange={(event) =>
                setNewProvider(event.target.value as AiProvider)
              }
            >
              <option value="gemini">{t("sources.providers.gemini")}</option>
              <option value="openai">{t("sources.providers.openai")}</option>
              <option value="openrouter">{t("sources.providers.openrouter")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-name">{t("sources.add.name")}</Label>
            <Input
              id="new-name"
              value={newSourceName}
              onChange={(event) => setNewSourceName(event.target.value)}
              placeholder={t("sources.add.name-placeholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">{t("sources.add.key")}</Label>
            <Input
              id="api-key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t("sources.add.key-placeholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">{t("sources.add.address")}</Label>
            <Input
              id="api-address"
              value={apiAddress}
              type="url"
              onChange={(event) => setApiAddress(event.target.value)}
              placeholder={getPlaceholderUrl()}
            />
          </div>
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => handleAddDialogChange(false)}
          >
            {t("sources.add.cancel")}
          </Button>
          <Button onClick={handleAddSource}>{t("sources.add.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
