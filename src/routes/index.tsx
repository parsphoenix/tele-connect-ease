import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { loginOrRegister, me } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Mic, Video, MessageCircle, ShieldCheck, Globe, Sun, Moon } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "پارس‌تاک | ورود" },
      { name: "description", content: "ورود به پارس‌تاک — پلتفرم تماس و چت بومی" },
    ],
  }),
  component: LandingPage,
});

function useCaptcha() {
  const [captcha, setCaptcha] = useState({ a: 0, b: 0 });
  const regen = () =>
    setCaptcha({ a: Math.floor(Math.random() * 9) + 1, b: Math.floor(Math.random() * 9) + 1 });
  useEffect(regen, []);
  return { captcha, regen, expected: captcha.a + captcha.b };
}

function LandingPage() {
  const { t, lang, setLang, dir } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const router = useRouter();
  const meFn = useServerFn(me);
  const authFn = useServerFn(loginOrRegister);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const { captcha, regen, expected } = useCaptcha();

  useEffect(() => {
    meFn().then((u) => {
      if (u) navigate({ to: "/dashboard" });
    });
  }, [meFn, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authFn({
        data: {
          username: username.trim(),
          password,
          captchaAnswer: Number(captchaAnswer),
          captchaExpected: expected,
        },
      });
      toast.success(t("connected"));
      await router.invalidate();
      navigate({ to: "/dashboard" });
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("CAPTCHA")) toast.error(t("invalid_captcha"));
      else if (msg.includes("INVALID_CREDENTIALS")) toast.error(t("invalid_credentials"));
      else toast.error(msg ? `${t("error_generic")}: ${msg}` : t("error_generic"));
      regen();
      setCaptchaAnswer("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      {/* Top nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground font-black">
              پ
            </div>
            <span className="text-lg font-black tracking-tight">{t("app_name")}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label="toggle theme"
              title={theme === "dark" ? t("theme_light") : t("theme_dark")}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline">
                {theme === "dark" ? t("theme_light") : t("theme_dark")}
              </span>
            </button>
            <button
              onClick={() => setLang(lang === "fa" ? "en" : "fa")}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            >
              <Globe className="h-4 w-4" />
              {lang === "fa" ? "EN" : "FA"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-2 lg:py-16">
        {/* Hero */}
        <section className="flex flex-col justify-center">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("app_tagline")}
          </div>
          <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
            {t("hero_title")}
          </h1>
          <p className="mt-4 max-w-lg text-muted-foreground">{t("hero_sub")}</p>

          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              { icon: Mic, label: t("mic_on") },
              { icon: Video, label: t("cam_on") },
              { icon: MessageCircle, label: t("chat") },
            ].map((f, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card/60 p-4 text-center"
              >
                <f.icon className="mx-auto h-6 w-6 text-primary" />
                <div className="mt-2 text-xs text-muted-foreground">{f.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Auth */}
        <section className="flex items-center">
          <Card className="w-full bg-panel border-border p-6 shadow-2xl">
            <h2 className="text-xl font-bold">{t("enter")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {lang === "fa"
                ? "با وارد کردن نام کاربری، در صورت نبود، حساب خودکار ساخته می‌شود."
                : "If the username doesn't exist, an account will be created automatically."}
            </p>
            <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              {lang === "fa" ? (
                <>
                  حساب آزمایشی: <span className="font-mono text-primary">demo</span> /{" "}
                  <span className="font-mono text-primary">demo1234</span>
                  <br />
                  یا یک نام کاربری جدید وارد کنید تا حساب ساخته شود.
                </>
              ) : (
                <>
                  Demo: <span className="font-mono text-primary">demo</span> /{" "}
                  <span className="font-mono text-primary">demo1234</span>
                </>
              )}
            </div>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="u">{t("username")}</Label>
                <Input
                  id="u"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={32}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="p">{t("password")}</Label>
                <Input
                  id="p"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={4}
                  maxLength={128}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="c">
                  {t("captcha")}: <span className="font-mono text-primary">{captcha.a} + {captcha.b} = ?</span>
                </Label>
                <Input
                  id="c"
                  type="number"
                  inputMode="numeric"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full font-bold" size="lg">
                {loading ? t("connecting") : t("enter")}
              </Button>
            </form>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {t("app_name")}
      </footer>
    </div>
  );
}
