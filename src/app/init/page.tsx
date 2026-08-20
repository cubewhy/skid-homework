import { Suspense } from "react";
import { PlatformInitPage } from "@/platform";

export default function InitRoute() {
  return (
    <Suspense>
      <PlatformInitPage />
    </Suspense>
  );
}
