import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "fa" | "en";

const translations = {
  fa: {
    app_name: "پارس‌تاک",
    app_tagline: "پلتفرم تماس و چت بومی",
    username: "نام کاربری",
    password: "رمز عبور",
    captcha: "کپچا",
    enter: "ورود / ثبت‌نام",
    logout: "خروج",
    dashboard: "داشبورد",
    rooms: "اتاق‌ها",
    friends: "دوستان",
    settings: "تنظیمات",
    create_room: "ایجاد اتاق جدید",
    room_name: "نام اتاق",
    public_room: "عمومی",
    private_room: "خصوصی",
    max_users: "حداکثر افراد",
    create: "ایجاد",
    cancel: "انصراف",
    join: "پیوستن",
    join_by_code: "پیوستن با کد",
    room_code: "کد اتاق",
    active_rooms: "اتاق‌های فعال",
    no_rooms: "اتاقی وجود ندارد",
    online: "آنلاین",
    offline: "آفلاین",
    in_call: "در تماس",
    members: "اعضا",
    leave_room: "خروج از اتاق",
    mic_on: "میکروفون روشن",
    mic_off: "میکروفون خاموش",
    cam_on: "دوربین روشن",
    cam_off: "دوربین خاموش",
    share_screen: "اشتراک صفحه",
    stop_share: "توقف اشتراک",
    chat: "چت",
    send: "ارسال",
    type_message: "پیام خود را بنویسید...",
    quality: "کیفیت",
    quality_low: "پایین (240p)",
    quality_medium: "متوسط (480p)",
    quality_high: "بالا (720p)",
    quality_hd: "اچ‌دی (1080p)",
    quality_auto: "خودکار",
    quality_custom: "دستی",
    resolution: "رزولوشن",
    framerate: "فریم‌ریت",
    video_bitrate: "بیت‌ریت ویدیو (kbps)",
    audio_bitrate: "بیت‌ریت صدا (kbps)",
    apply: "اعمال",
    add_friend: "افزودن دوست",
    invite_call: "دعوت به تماس",
    accept: "قبول",
    reject: "رد",
    remove: "حذف",
    theme: "تم",
    language: "زبان",
    save: "ذخیره",
    incoming: "درخواست ورودی",
    outgoing: "درخواست ارسال شده",
    accepted: "دوست",
    invalid_captcha: "کپچا اشتباه است",
    invalid_credentials: "نام کاربری یا رمز اشتباه است",
    connecting: "در حال اتصال...",
    connected: "متصل",
    disconnected: "قطع شده",
    error_generic: "خطایی رخ داد",
    copy_code: "کپی کد",
    copied: "کپی شد",
    display_name: "نام نمایشی",
    hero_title: "پلتفرم ارتباطی بومی ایران",
    hero_sub: "تماس صوتی و تصویری و چت با پردازش کامل سمت کاربر، بدون نیاز به اینترنت بین‌الملل.",
    theme_dark: "تم تیره",
    theme_light: "تم روشن",
  },
  en: {
    app_name: "ParsTalk",
    app_tagline: "National communication platform",
    username: "Username",
    password: "Password",
    captcha: "Captcha",
    enter: "Sign in / Register",
    logout: "Sign out",
    dashboard: "Dashboard",
    rooms: "Rooms",
    friends: "Friends",
    settings: "Settings",
    create_room: "Create new room",
    room_name: "Room name",
    public_room: "Public",
    private_room: "Private",
    max_users: "Max users",
    create: "Create",
    cancel: "Cancel",
    join: "Join",
    join_by_code: "Join by code",
    room_code: "Room code",
    active_rooms: "Active rooms",
    no_rooms: "No rooms yet",
    online: "Online",
    offline: "Offline",
    in_call: "In call",
    members: "Members",
    leave_room: "Leave room",
    mic_on: "Mic on",
    mic_off: "Mic off",
    cam_on: "Camera on",
    cam_off: "Camera off",
    share_screen: "Share screen",
    stop_share: "Stop sharing",
    chat: "Chat",
    send: "Send",
    type_message: "Type your message...",
    quality: "Quality",
    quality_low: "Low (240p)",
    quality_medium: "Medium (480p)",
    quality_high: "High (720p)",
    quality_hd: "HD (1080p)",
    quality_auto: "Auto",
    quality_custom: "Custom",
    resolution: "Resolution",
    framerate: "Framerate",
    video_bitrate: "Video bitrate (kbps)",
    audio_bitrate: "Audio bitrate (kbps)",
    apply: "Apply",
    add_friend: "Add friend",
    invite_call: "Invite to call",
    accept: "Accept",
    reject: "Reject",
    remove: "Remove",
    theme: "Theme",
    language: "Language",
    save: "Save",
    incoming: "Incoming request",
    outgoing: "Sent request",
    accepted: "Friend",
    invalid_captcha: "Wrong captcha",
    invalid_credentials: "Wrong username or password",
    connecting: "Connecting...",
    connected: "Connected",
    disconnected: "Disconnected",
    error_generic: "Something went wrong",
    copy_code: "Copy code",
    copied: "Copied",
    display_name: "Display name",
    hero_title: "Iran's native communication platform",
    hero_sub: "Voice, video and chat with fully client-side processing. No international internet required.",
    theme_dark: "Dark",
    theme_light: "Light",
  },
} as const;

export type TKey = keyof (typeof translations)["fa"];

interface I18nCtx {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (k: TKey) => string;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fa");
  useEffect(() => {
    const saved = (typeof window !== "undefined" ? localStorage.getItem("lang") : null) as
      | Lang
      | null;
    if (saved === "fa" || saved === "en") setLangState(saved);
  }, []);
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    }
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem("lang", l);
  };
  const t = (k: TKey) => translations[lang][k];
  const dir: "rtl" | "ltr" = lang === "fa" ? "rtl" : "ltr";
  return <Ctx.Provider value={{ lang, dir, t, setLang }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}
