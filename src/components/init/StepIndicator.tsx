"use client";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  totalSteps: number;
  currentStep: number;
}

export default function StepIndicator({
  totalSteps,
  currentStep,
}: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 rounded-full transition-all duration-300",
            i === currentStep
              ? "w-6 bg-primary"
              : i < currentStep
                ? "w-2 bg-primary/40"
                : "w-2 bg-muted-foreground/20",
          )}
        />
      ))}
    </div>
  );
}
