"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type SourceModels } from "@/hooks/use-available-models";

export const CUSTOM_MODEL_VALUE = "__custom__";

export interface ModelSelectorProps {
  sourceModelsMap: SourceModels[];
  value: string | null;
  onChange: (model: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  allowCustom?: boolean;
  customLabel?: string;
  isCustomSelected?: boolean;
  excludeModel?: string;
  className?: string;
}

export default function ModelSelector({
  sourceModelsMap,
  value,
  onChange,
  open,
  onOpenChange,
  placeholder,
  allowNone = false,
  noneLabel,
  allowCustom = false,
  customLabel,
  isCustomSelected = false,
  excludeModel,
  className,
}: ModelSelectorProps) {
  const { t } = useTranslation("commons", { keyPrefix: "settings-page" });

  const displayValue = useMemo(() => {
    if (isCustomSelected) {
      const label = customLabel ?? t("model.manual.title");
      return value ? `${label}（${value}）` : label;
    }

    if (!value) {
      return allowNone
        ? (noneLabel ?? t("model.fallback.none"))
        : t("model.sel.none");
    }

    // Find the model in all sources
    for (const { source, models } of sourceModelsMap) {
      const match = models.find((model) => model.name === value);
      if (match) {
        return `${source.name}: ${match.displayName}`;
      }
    }
    return t("model.sel.unknown", { name: value });
  }, [
    value,
    sourceModelsMap,
    allowNone,
    noneLabel,
    isCustomSelected,
    customLabel,
    t,
  ]);

  const handleSelect = (model: string) => {
    onChange(model);
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
        >
          {displayValue}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
        <Command>
          <CommandInput placeholder={placeholder ?? t("model.sel.search")} />
          <CommandList>
            <CommandEmpty>{t("model.sel.empty")}</CommandEmpty>
            {(allowNone || allowCustom) && (
              <CommandGroup>
                {allowNone && (
                  <CommandItem
                    key="__none__"
                    value="__none__"
                    onSelect={() => handleSelect("")}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        !value && !isCustomSelected
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    {noneLabel ?? t("model.fallback.none")}
                  </CommandItem>
                )}
                {allowCustom && (
                  <CommandItem
                    key="__custom__"
                    value="__custom__"
                    onSelect={() => handleSelect(CUSTOM_MODEL_VALUE)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        isCustomSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {customLabel ?? t("model.manual.title")}
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            {sourceModelsMap.map(({ source, models }) => {
              const filteredModels = excludeModel
                ? models.filter((m) => m.name !== excludeModel)
                : models;

              if (filteredModels.length === 0) return null;

              return (
                <CommandGroup key={source.id} heading={source.name}>
                  {filteredModels.map((model) => (
                    <CommandItem
                      key={`${source.id}-${model.name}`}
                      value={`${source.name} ${model.name} ${model.displayName}`}
                      onSelect={() => handleSelect(model.name)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === model.name && !isCustomSelected
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {model.displayName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
