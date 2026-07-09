import { createFileRoute, Outlet, redirect, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { me, logout } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { LayoutDashboard, Users, Settings, LogOut, Globe, Video, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthedLayout,
});

function AuthedLayout() {
  const { t, lang, setLang, dir } = useI18n();
  const meFn = useServerFn(me);
  const logoutFn = useServerFn(logout);
  const router = useRouter();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: user, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => meFn(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        {t("connecting")}
      </div>
    );
  }
  if (!user) {
    navigate({ to: "/" });
    return null;
  }

  async function onLogout() {
    await logoutFn();
    await router.invalidate();
    navigate({ to: "/" });
  }

  const nav = [
    { to: "/dashboard", icon: LayoutDashboard, label: t("dashboard") },
    { to: "/friends", icon: Users, label: t("friends") },
    { to: "/settings", icon: Settings, label: t("settings") },
  ];

  return (
    <div dir={dir} className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 z-40 w-64 flex-col border-e border-sidebar-border bg-sidebar transition-transform lg:static lg:flex lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : dir === "rtl" ? "translate-x-full lg:translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${dir === "rtl" ? "right-0" : "left-0"} flex`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-black">پ</div>
          <span className="font-black tracking-tight">{t("app_name")}</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition"
              activeProps={{ className: "bg-primary/15 text-primary font-semibold" }}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3 space-y-2">
          <div className="rounded-md bg-sidebar-accent px-3 py-2 text-xs text-sidebar-foreground">
            <div className="text-muted-foreground">{t("username")}</div>
            <div className="mt-0.5 font-bold truncate">{user.username}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLang(lang === "fa" ? "en" : "fa")}
            className="w-full justify-start gap-2"
          >
            <Globe className="h-4 w-4" /> {lang === "fa" ? "English" : "فارسی"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="w-full justify-start gap-2 text-destructive">
            <LogOut className="h-4 w-4" /> {t("logout")}
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card/50 px-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-md border border-border p-1.5"
            aria-label="menu"
          >
            <Video className="h-4 w-4" />
          </button>
          <div className="font-bold">{t("app_name")}</div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </div>
  );
}
