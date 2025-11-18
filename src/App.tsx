import { HashRouter, Route, Routes } from "react-router-dom";
import RequireAiKey from "./components/guards/RequireAiKey";
import ScanPage from "./components/pages/ScanPage";
import InitPage from "./components/pages/InitPage";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import SettingsPage from "./components/pages/SettingsPage";
import ChatPage from "./components/pages/ChatPage";
import { useEffect } from "react";
import { useSettingsStore } from "./store/settings-store";
import i18n from "./i18n";

function App() {
  const language = useSettingsStore((s) => s.language);

  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  return (
    <ThemeProvider defaultTheme="system" storageKey="theme">
      <div className="safe-area">
        <HashRouter>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAiKey fallback="/init">
                  <ScanPage />
                </RequireAiKey>
              }
            />

            <Route
              path="/chat"
              element={
                <RequireAiKey fallback="/init">
                  <ChatPage />
                </RequireAiKey>
              }
            />
            <Route path="/init" element={<InitPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </HashRouter>

        <Toaster />
      </div>
    </ThemeProvider>
  );
}

export default App;
