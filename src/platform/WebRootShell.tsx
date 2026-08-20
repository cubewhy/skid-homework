"use client";

import {SerwistProvider} from "@/app/serwist";

type WebRootShellProps = {
  children: React.ReactNode;
};

export function WebRootShell({children}: WebRootShellProps): React.JSX.Element {
  return (
    <SerwistProvider
      swUrl="/sw.js"
      disable={process.env.NODE_ENV !== "production"}
      options={{updateViaCache: "none"}}
    >
      {children}
    </SerwistProvider>
  );
}
