import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import {
  DialogHeader,
  DialogFooter,
  DialogClose,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { Textarea } from "../ui/textarea";
import { useState } from "react";
import { useSettingsStore } from "@/store/settings-store";

export type TextInputDialogProps = {
  trigger: React.ReactNode;
  initialValue?: string;
  title: string;
  description: string;
  placeholder: string;
  submitText: string;
  isSubmitting?: boolean;
  onSubmit: (value: string) => void;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  allowEmpty?: boolean;
};

export const TextInputDialog = ({
  trigger,
  initialValue,
  title,
  description,
  placeholder,
  submitText,
  isSubmitting,
  onSubmit,
  isOpen,
  onOpenChange,
  allowEmpty,
}: TextInputDialogProps) => {
  const [inputValue, setInputValue] = useState(initialValue ?? "");
  const clearDialogOnSubmit = useSettingsStore((s) => s.clearDialogOnSubmit);

  const handleSubmit = () => {
    onSubmit(inputValue.trim());
    if (clearDialogOnSubmit) {
      setInputValue("");
    }
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.ctrlKey && e.key === "Enter" && (allowEmpty || inputValue.trim())) {
      e.preventDefault();
      onOpenChange?.(false);
      handleSubmit();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-40"
          placeholder={placeholder}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="secondary"
              onClick={handleSubmit}
              disabled={!(inputValue.trim() || allowEmpty) || isSubmitting}
            >
              {isSubmitting && <Loader2 className="animate-spin mr-2" />}
              {submitText} <Kbd>Ctrl+Enter</Kbd>
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
