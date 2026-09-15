"use client";

import {useEffect} from "react";
import {openExternalUrl} from "./platform";

type PlatformRootShellProps = {
  children: React.ReactNode;
};

export function PlatformRootShell({
  children,
}: PlatformRootShellProps): React.JSX.Element {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href");

      if (!href?.startsWith("http://") && !href?.startsWith("https://")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void openExternalUrl(href).catch((error) => {
        console.error("Failed to open external URL", error);
      });
    };

    const preventDropNavigation = (event: DragEvent) => {
      event.preventDefault();
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("dragover", preventDropNavigation);
    document.addEventListener("drop", preventDropNavigation);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("dragover", preventDropNavigation);
      document.removeEventListener("drop", preventDropNavigation);
    };
  }, []);

  return <>{children}</>;
}
