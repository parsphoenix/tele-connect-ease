import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-black">{t("settings")}</h1>
      <Card className="bg-panel border-border p-5 space-y-4">
        <div>
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
        </div>
      </Card>
      <Card className="bg-panel border-border p-5">
        <h2 className="font-bold mb-2">TURN Server</h2>
        <p className="text-sm text-muted-foreground">
          {lang === "fa"
            ? "برای عبور از NAT، سرور TURN داخلی را در فایل .env تنظیم کنید (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL). راهنمای نصب در README-INSTALL.md."
            : "For NAT traversal, configure your internal TURN server via .env (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL)."}
        </p>
      </Card>
    </div>
  );
}
