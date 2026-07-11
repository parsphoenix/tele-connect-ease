/**
 * Local browser preferences persisted in localStorage.
 * Hotkeys, PTT, VAD, and selected devices live client-side because they're
 * per-device and don't need to sync across sessions.
 */

export interface Hotkeys {
  mic: string;
  cam: string;
  screen: string;
  ptt: string;
}

export interface UserPrefs {
  hotkeys: Hotkeys;
  pushToTalk: boolean;
  voiceActivation: "auto" | "manual";
  cameraDeviceId: string | null;
  microphoneDeviceId: string | null;
  speakerDeviceId: string | null;
}

export const DEFAULT_PREFS: UserPrefs = {
  hotkeys: { mic: "M", cam: "V", screen: "S", ptt: "Space" },
  pushToTalk: false,
  voiceActivation: "auto",
  cameraDeviceId: null,
  microphoneDeviceId: null,
  speakerDeviceId: null,
};

const KEY = "parstalk_prefs";

export function loadPrefs(): UserPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: UserPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
