"use client";

import { useState } from "react";
import { useAiStore } from "@/store/ai-store";
import { useAvailableModels } from "@/hooks/use-available-models";
import ModelSelector, {
  CUSTOM_MODEL_VALUE,
} from "@/components/ui/model-selector.tsx";

export default function ModelSelectorPopover() {
  const currentModel = useAiStore((s) => s.currentModel);
  const setCurrentModel = useAiStore((s) => s.setCurrentModel);
  const isCustomModel = useAiStore((s) => s.isCustomModel);
  const setIsCustomModel = useAiStore((s) => s.setIsCustomModel);

  const { sourceModelsMap } = useAvailableModels();
  const [open, setOpen] = useState(false);

  const handleModelSelect = (model: string) => {
    if (model === CUSTOM_MODEL_VALUE) {
      setIsCustomModel(true);
    } else {
      setIsCustomModel(false);
      setCurrentModel(model);
    }
  };

  return (
    <ModelSelector
      sourceModelsMap={sourceModelsMap}
      value={currentModel}
      onChange={handleModelSelect}
      open={open}
      onOpenChange={setOpen}
      allowCustom={true}
      isCustomSelected={isCustomModel}
      className="w-full"
    />
  );
}
