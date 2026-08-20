import ChatPage from "@/components/chat/page";
import { PlatformInitGuard } from "@/platform";

export default function ChatRoute() {
  return (
    <PlatformInitGuard>
      <ChatPage />
    </PlatformInitGuard>
  );
}
