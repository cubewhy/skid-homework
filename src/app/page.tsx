import { PlatformInitGuard } from "@/platform";
import ScanPage from "@/components/pages/ScanPage";

export default function HomePage() {
  return (
    <PlatformInitGuard>
      <ScanPage />
    </PlatformInitGuard>
  );
}
