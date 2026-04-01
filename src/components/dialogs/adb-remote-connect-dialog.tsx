import {Loader2, RefreshCw} from "lucide-react";
import {useCallback, useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {listTauriAdbDevices, type TauriAdbDevice} from "@/lib/tauri/adb";
import {cn} from "@/lib/utils";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";

export interface AdbRemoteConnectDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  onConnect: (address: string) => Promise<void> | void;
  onOpenChange: (isOpen: boolean) => void;
  onPair: (request: {
    pairingAddress: string;
    pairingCode: string;
  }) => Promise<void> | void;
  onSelectDevice: (serial: string) => Promise<void> | void;
  selectedSerial?: string | null;
}

export const AdbRemoteConnectDialog = ({
  isOpen,
  isSubmitting,
  onConnect,
  onOpenChange,
  onPair,
  onSelectDevice,
  selectedSerial,
}: AdbRemoteConnectDialogProps) => {
  const { t } = useTranslation("commons", {
    keyPrefix: "upload-area.adb.remote-dialog",
  });
  const [activeTab, setActiveTab] = useState<"devices" | "connect" | "pair">(
    "devices",
  );
  const [connectAddress, setConnectAddress] = useState("");
  const [pairingAddress, setPairingAddress] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [devices, setDevices] = useState<TauriAdbDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      setDevices(await listTauriAdbDevices());
    } catch (error) {
      console.error("Failed to load desktop ADB devices", error);
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void loadDevices();
  }, [isOpen, loadDevices]);

  const canSubmitConnect = connectAddress.trim().length > 0 && !isSubmitting;
  const canSubmitPair =
    pairingAddress.trim().length > 0 &&
    pairingCode.trim().length > 0 &&
    !isSubmitting;

  const handleConnect = async () => {
    await onConnect(connectAddress.trim());
  };

  const handlePair = async () => {
    await onPair({
      pairingAddress: pairingAddress.trim(),
      pairingCode: pairingCode.trim(),
    });
    setActiveTab("connect");
  };

  const handleSelectDevice = async (serial: string) => {
    await onSelectDevice(serial);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as "devices" | "connect" | "pair")
          }
          className="gap-4"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="devices">{t("tabs.devices")}</TabsTrigger>
            <TabsTrigger value="connect">{t("tabs.connect")}</TabsTrigger>
            <TabsTrigger value="pair">{t("tabs.pair")}</TabsTrigger>
          </TabsList>

          <TabsContent value="devices" className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("devices.description")}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={devicesLoading || isSubmitting}
                onClick={() => void loadDevices()}
              >
                {devicesLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t("devices.refresh")}
              </Button>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {devicesLoading && !devices.length ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("devices.loading")}
                </div>
              ) : !devices.length ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  {t("devices.empty")}
                </div>
              ) : (
                devices.map((device) => {
                  const isSelected = selectedSerial === device.serial;
                  const isReady = device.state === "device";

                  return (
                    <div
                      key={device.serial}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md border p-3",
                        isSelected && "border-primary bg-primary/5",
                      )}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">
                            {device.name}
                          </span>
                          <Badge variant={isReady ? "secondary" : "outline"}>
                            {device.state}
                          </Badge>
                          {isSelected && (
                            <Badge variant="default">
                              {t("devices.selected-badge")}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {device.serial}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={isSelected ? "secondary" : "outline"}
                        disabled={!isReady || isSubmitting}
                        onClick={() => void handleSelectDevice(device.serial)}
                      >
                        {isSelected
                          ? t("devices.selected")
                          : t("devices.select")}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="connect" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("connect.description")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="adb-connect-address">
                {t("connect.address")}
              </Label>
              <Input
                id="adb-connect-address"
                autoComplete="off"
                disabled={isSubmitting}
                placeholder={t("connect.placeholder")}
                value={connectAddress}
                onChange={(event) => setConnectAddress(event.target.value)}
              />
            </div>
          </TabsContent>

          <TabsContent value="pair" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("pair.description")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="adb-pair-address">
                {t("pair.pair-address")}
              </Label>
              <Input
                id="adb-pair-address"
                autoComplete="off"
                disabled={isSubmitting}
                placeholder={t("pair.pair-address-placeholder")}
                value={pairingAddress}
                onChange={(event) => setPairingAddress(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adb-pair-code">{t("pair.pairing-code")}</Label>
              <Input
                id="adb-pair-code"
                autoComplete="off"
                disabled={isSubmitting}
                placeholder={t("pair.pairing-code-placeholder")}
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value)}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          {activeTab === "connect" && (
            <Button
              disabled={!canSubmitConnect}
              onClick={() => void handleConnect()}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("connect.submit")}
            </Button>
          )}
          {activeTab === "pair" && (
            <Button disabled={!canSubmitPair} onClick={() => void handlePair()}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("pair.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
