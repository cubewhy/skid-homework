import { Kbd } from "./ui/kbd";
import { formatShortcutLabel } from "@/utils/shortcuts";
import { useMediaQuery } from "@/hooks/use-media-query";

export interface ShortcutHintProps {
  shortcut?: string | null;
  hideOnMobile?: boolean;
}

export function ShortcutHint({ shortcut, hideOnMobile = true }: ShortcutHintProps) {
  const isCompact = useMediaQuery("(max-width: 640px)");
  const label = formatShortcutLabel(shortcut);
  
  if (!shortcut || !label) return null;
  if (hideOnMobile && isCompact) return null;
  
  return <Kbd>{label}</Kbd>;
}
