"use client";

type PlatformRootShellProps = {
  children: React.ReactNode;
};

export function PlatformRootShell({
  children,
}: PlatformRootShellProps): React.JSX.Element {
  return <>{children}</>;
}
