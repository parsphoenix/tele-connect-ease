import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, Upload, Trash2, Save } from "lucide-react";
import { getMySettings, saveAvatar, saveDisplayName } from "@/lib/settings.functions";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type UserPrefs } from "@/lib/user-prefs";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

interface MediaDevice {
  deviceId: string;
  label: string;
  kind: "audioinput" | "videoinput" | "audiooutput";
}

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const getSettings = useServerFn(getMySettings);
  const saveAvFn = useServerFn(saveAvatar);
  const saveNameFn = useServerFn(saveDisplayName);

  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);
  const [devices, setDevices] = useState<MediaDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
    getSettings().then((s) => {
      setDisplayName(s.displayName ?? "");
      setAvatar(s.avatar);
    });
    // Request permission implicitly to expose device labels
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        setDevices(
          list.map((d) => ({
            deviceId: d.deviceId,
            label: d.label || d.kind,
            kind: d.kind as MediaDevice["kind"],
          })),
        );
      })
      .catch(() => {});
  }, [getSettings]);

  function updatePrefs(patch: Partial<UserPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  }
  function updateHotkey(key: keyof UserPrefs["hotkeys"], value: string) {
    const next = { ...prefs, hotkeys: { ...prefs.hotkeys, [key]: value } };
    setPrefs(next);
    savePrefs(next);
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast.error(t("avatar_too_large"));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const data = reader.result as string;
      setBusy(true);
      try {
        await saveAvFn({ data: { avatar: data } });
        setAvatar(data);
        toast.success(t("save"));
      } catch {
        toast.error(t("error_generic"));
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeAvatar() {
    setBusy(true);
    try {
      await saveAvFn({ data: { avatar: null } });
      setAvatar(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      await saveNameFn({ data: { displayName: displayName.trim() } });
      toast.success(t("save"));
    } catch {
      toast.error(t("error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const cams = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");
  const spks = devices.filter((d) => d.kind === "audiooutput");

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-black">{t("settings")}</h1>

      {/* Profile */}
      <Card className="bg-panel border-border p-5 space-y-4">
        <h2 className="font-bold">{t("my_avatar")}</h2>
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-full overflow-hidden bg-secondary grid place-items-center border border-border">
            {avatar ? (
              <img src={avatar} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl font-black text-muted-foreground">
                {(displayName || "?").slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => fileRef.current?.click()} disabled={busy} className="gap-1.5">
              <Upload className="h-4 w-4" /> {t("upload_avatar")}
            </Button>
            {avatar && (
              <Button variant="secondary" onClick={removeAvatar} disabled={busy}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onAvatarPick}
            />
          </div>
        </div>
        <div>
          <Label>{t("display_name")}</Label>
          <div className="mt-1 flex gap-2">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
            />
            <Button onClick={saveName} disabled={busy} className="gap-1.5">
              <Save className="h-4 w-4" /> {t("save")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Devices */}
      <Card className="bg-panel border-border p-5 space-y-4">
        <h2 className="font-bold">{t("devices")}</h2>
        {devices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {lang === "fa"
              ? "برای مشاهده دستگاه‌ها ابتدا در یک اتاق دسترسی میکروفون/دوربین بدهید."
              : "Grant mic/camera access from a room to list devices."}
          </p>
        )}
        <DeviceSelect
          label={t("camera_device")}
          value={prefs.cameraDeviceId}
          onChange={(v) => updatePrefs({ cameraDeviceId: v })}
          options={cams}
        />
        <DeviceSelect
          label={t("microphone_device")}
          value={prefs.microphoneDeviceId}
          onChange={(v) => updatePrefs({ microphoneDeviceId: v })}
          options={mics}
        />
        <DeviceSelect
          label={t("speaker_device")}
          value={prefs.speakerDeviceId}
          onChange={(v) => updatePrefs({ speakerDeviceId: v })}
          options={spks}
        />
      </Card>

      {/* Voice */}
      <Card className="bg-panel border-border p-5 space-y-4">
        <h2 className="font-bold">{t("voice_activation")}</h2>
        <div className="flex gap-2">
          <Button
            variant={prefs.voiceActivation === "auto" ? "default" : "secondary"}
            onClick={() => updatePrefs({ voiceActivation: "auto" })}
          >
            {t("quality_auto")}
          </Button>
          <Button
            variant={prefs.voiceActivation === "manual" ? "default" : "secondary"}
            onClick={() => updatePrefs({ voiceActivation: "manual" })}
          >
            {t("quality_custom")}
          </Button>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={prefs.pushToTalk}
            onChange={(e) => updatePrefs({ pushToTalk: e.target.checked })}
            className="h-4 w-4"
          />
          <span>{t("push_to_talk")}</span>
        </label>
      </Card>

      {/* Hotkeys */}
      <Card className="bg-panel border-border p-5 space-y-4">
        <h2 className="font-bold">{t("hotkeys")}</h2>
        <HotkeyRow label={t("hotkey_mic")} value={prefs.hotkeys.mic} onChange={(v) => updateHotkey("mic", v)} />
        <HotkeyRow label={t("hotkey_cam")} value={prefs.hotkeys.cam} onChange={(v) => updateHotkey("cam", v)} />
        <HotkeyRow label={t("hotkey_screen")} value={prefs.hotkeys.screen} onChange={(v) => updateHotkey("screen", v)} />
        <HotkeyRow label={t("hotkey_ptt")} value={prefs.hotkeys.ptt} onChange={(v) => updateHotkey("ptt", v)} />
      </Card>

      {/* Language */}
      <Card className="bg-panel border-border p-5 space-y-4">
        <Label className="text-base">{t("language")}</Label>
        <div className="mt-2 flex gap-2">
          <Button
            variant={lang === "fa" ? "default" : "secondary"}
            onClick={() => setLang("fa")}
            className="gap-1.5"
          >
            <Globe className="h-4 w-4" /> فارسی
          </Button>
          <Button
            variant={lang === "en" ? "default" : "secondary"}
            onClick={() => setLang("en")}
            className="gap-1.5"
          >
            <Globe className="h-4 w-4" /> English
          </Button>
        </div>
      </Card>

      {/* TURN */}
      <Card className="bg-panel border-border p-5">
        <h2 className="font-bold mb-2">TURN Server</h2>
        <p className="text-sm text-muted-foreground">
          {lang === "fa"
            ? "برای عبور از NAT، سرور TURN داخلی را در فایل .env تنظیم کنید (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL)."
            : "For NAT traversal, configure your internal TURN server via .env (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL)."}
        </p>
      </Card>
    </div>
  );
}

function DeviceSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: MediaDevice[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.deviceId} value={o.deviceId}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function HotkeyRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <button
        onClick={() => setCapturing(true)}
        onKeyDown={(e) => {
          if (!capturing) return;
          e.preventDefault();
          const key = e.code === "Space" ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
          onChange(key);
          setCapturing(false);
        }}
        onBlur={() => setCapturing(false)}
        className="min-w-[80px] rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
      >
        {capturing ? "..." : value}
      </button>
    </div>
  );
}
