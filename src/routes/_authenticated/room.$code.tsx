import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  getRoom,
  joinRoom,
  leaveRoom,
  listRoomMembers,
  banFromRoom,
  kickFromRoom,
} from "@/lib/rooms.functions";
import { pollSignals, sendSignal, listActiveUsers } from "@/lib/signaling.functions";
import { getIceServers } from "@/lib/ice.functions";
import { me } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";
import { MeshManager, QUALITY_PRESETS, type QualityConfig, type QualityPreset } from "@/lib/webrtc";
import {
  EMOJIS,
  linkify,
  CHAT_MAX_CHARS,
  CHAT_RATE_MS,
  POKE_COOLDOWN_MS,
  AFK_TIMEOUT_MS,
  CHAT_PAGE_SIZE,
} from "@/lib/chat-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  Monitor,
  MonitorOff,
  Phone,
  MessageSquare,
  Settings2,
  Send,
  Paperclip,
  Copy,
  Users,
  X,
  Crown,
  Ban,
  UserMinus,
  Bell,
  Maximize2,
  PictureInPicture2,
  Smile,
  Moon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/room/$code")({
  ssr: false,
  component: RoomPage,
});

interface RemotePeer {
  userId: number;
  username?: string;
  stream?: MediaStream;
  status?: string;
  ping?: number;
  speaking?: boolean;
  afk?: boolean;
  volume?: number; // 0..1
}
interface ChatMsg {
  from: string;
  fromId?: number;
  text: string;
  self?: boolean;
  ts: number;
  file?: { name: string; url: string; mime: string; size: number };
  poke?: boolean;
}

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Attach WebAudio analyser to a stream and call cb(speaking) via requestAnimationFrame loop */
function useSpeakingDetector(stream: MediaStream | null | undefined, onSpeaking: (v: boolean) => void) {
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    let raf = 0;
    let ac: AudioContext | null = null;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new AC();
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let above = 0;
      let last = false;
      const loop = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length;
        const speaking = avg > 18;
        above = speaking ? Math.min(above + 1, 5) : Math.max(above - 1, 0);
        const state = above > 2;
        if (state !== last) {
          last = state;
          onSpeaking(state);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } catch (e) {
      console.error("VAD", e);
    }
    return () => {
      cancelAnimationFrame(raf);
      ac?.close().catch(() => {});
    };
  }, [stream, onSpeaking]);
}

function RoomPage() {
  const { code } = Route.useParams();
  const upperCode = code.toUpperCase();
  const { t, dir } = useI18n();
  const navigate = useNavigate();

  const meFn = useServerFn(me);
  const getRoomFn = useServerFn(getRoom);
  const joinFn = useServerFn(joinRoom);
  const leaveFn = useServerFn(leaveRoom);
  const membersFn = useServerFn(listRoomMembers);
  const iceFn = useServerFn(getIceServers);
  const sendFn = useServerFn(sendSignal);
  const pollFn = useServerFn(pollSignals);
  const activeFn = useServerFn(listActiveUsers);
  const banFn = useServerFn(banFromRoom);
  const kickFn = useServerFn(kickFromRoom);

  const [ready, setReady] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false); // camera OFF by default
  const [screenOn, setScreenOn] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [peers, setPeers] = useState<Record<number, RemotePeer>>({});
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [visibleCount, setVisibleCount] = useState(CHAT_PAGE_SIZE);
  const [msgInput, setMsgInput] = useState("");
  const [preset, setPreset] = useState<QualityPreset>("auto"); // auto by default
  const [customQ, setCustomQ] = useState<QualityConfig>(QUALITY_PRESETS.medium);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [afk, setAfk] = useState(false);
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number>(0);
  const lastActivityRef = useRef<number>(Date.now());
  const lastMsgAtRef = useRef<number>(0);
  const lastPokeAtRef = useRef<Record<number, number>>({});

  const managerRef = useRef<MeshManager | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sinceIdRef = useRef(0);
  const usernamesRef = useRef<Record<number, string>>({});
  const meRef = useRef<{ id: number; username: string } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const iAmOwner = ownerId !== null && meRef.current?.id === ownerId;

  // AFK activity tracking
  useEffect(() => {
    const mark = () => {
      lastActivityRef.current = Date.now();
      if (afk) {
        setAfk(false);
        managerRef.current?.sendControl({ type: "afk", value: false });
      }
    };
    window.addEventListener("mousemove", mark);
    window.addEventListener("keydown", mark);
    window.addEventListener("touchstart", mark);
    const iv = setInterval(() => {
      if (Date.now() - lastActivityRef.current > AFK_TIMEOUT_MS && !afk) {
        setAfk(true);
        managerRef.current?.sendControl({ type: "afk", value: true });
      }
    }, 10_000);
    return () => {
      window.removeEventListener("mousemove", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("touchstart", mark);
      clearInterval(iv);
    };
  }, [afk]);

  // Call duration
  useEffect(() => {
    if (!ready) return;
    startedAtRef.current = Date.now();
    const iv = setInterval(() => setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [ready]);

  // Ping polling
  useEffect(() => {
    if (!ready) return;
    const iv = setInterval(async () => {
      const m = managerRef.current;
      if (!m) return;
      const updates: Record<number, number> = {};
      for (const id of m.getPeerIds()) updates[id] = await m.getPeerPing(id);
      setPeers((p) => {
        const c = { ...p };
        for (const [id, ping] of Object.entries(updates)) {
          const nid = Number(id);
          if (c[nid]) c[nid] = { ...c[nid], ping };
        }
        return c;
      });
    }, 3000);
    return () => clearInterval(iv);
  }, [ready]);

  // Init
  useEffect(() => {
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let discoveryTimer: ReturnType<typeof setInterval> | null = null;
    let membersTimer: ReturnType<typeof setInterval> | null = null;

    async function init() {
      try {
        const user = await meFn();
        if (!user) {
          navigate({ to: "/" });
          return;
        }
        meRef.current = user;
        const room = await getRoomFn({ data: { code: upperCode } });
        setOwnerId(room.owner_id);
        await joinFn({ data: { code: upperCode } });
        const iceServers = await iceFn();

        const manager = new MeshManager({
          myId: user.id,
          roomCode: upperCode,
          iceServers,
          send: async (toUser, payload) => {
            await sendFn({
              data: { roomCode: upperCode, toUser, payload: JSON.stringify(payload) },
            });
          },
          events: {
            onRemoteStream(userId, stream) {
              setPeers((p) => ({
                ...p,
                [userId]: { ...(p[userId] ?? { userId, volume: 1 }), stream },
              }));
            },
            onPeerLeft(userId) {
              setPeers((p) => {
                const c = { ...p };
                delete c[userId];
                return c;
              });
            },
            onChatMessage(userId, text) {
              setChat((c) => [
                ...c,
                { from: usernamesRef.current[userId] ?? `#${userId}`, fromId: userId, text, ts: Date.now() },
              ]);
            },
            onFile(userId, name, mime, blob) {
              const url = URL.createObjectURL(blob);
              setChat((c) => [
                ...c,
                {
                  from: usernamesRef.current[userId] ?? `#${userId}`,
                  fromId: userId,
                  text: name,
                  ts: Date.now(),
                  file: { name, url, mime, size: blob.size },
                },
              ]);
            },
            onStatus(userId, state) {
              setPeers((p) => ({
                ...p,
                [userId]: { ...(p[userId] ?? { userId, volume: 1 }), status: state },
              }));
            },
            onControl(userId, msg) {
              if (msg.type === "poke" && (msg.to as number) === meRef.current?.id) {
                playPokeSound();
                const from = usernamesRef.current[userId] ?? `#${userId}`;
                toast(`👉 ${from} ${t("poked_you")}`, { description: (msg.text as string) || "" });
                setChat((c) => [
                  ...c,
                  { from, fromId: userId, text: (msg.text as string) || "👉", ts: Date.now(), poke: true },
                ]);
              } else if (msg.type === "afk") {
                setPeers((p) => ({
                  ...p,
                  [userId]: { ...(p[userId] ?? { userId, volume: 1 }), afk: Boolean(msg.value) },
                }));
              } else if (msg.type === "kicked" && (msg.to as number) === meRef.current?.id) {
                toast.error("You have been removed from the room");
                navigate({ to: "/dashboard" });
              }
            },
          },
        });
        managerRef.current = manager;

        // Start media with camera off (audio only initially)
        await manager.initMedia(QUALITY_PRESETS.medium, false, true);
        if (localVideoRef.current && manager.getLocalStream()) {
          localVideoRef.current.srcObject = manager.getLocalStream();
        }

        const discover = async () => {
          if (stopped) return;
          try {
            const active = await activeFn({ data: { roomCode: upperCode } });
            for (const u of active) {
              usernamesRef.current[u.user_id] = u.username;
              if (u.user_id !== user.id && !manager.hasPeer(u.user_id)) {
                manager.connectTo(u.user_id);
              }
            }
            const activeIds = new Set(active.map((a) => a.user_id));
            for (const pid of manager.getPeerIds()) {
              if (!activeIds.has(pid)) manager.removePeer(pid);
            }
          } catch (e) {
            console.error("discover", e);
          }
        };
        await discover();
        discoveryTimer = setInterval(discover, 4000);

        const poll = async () => {
          if (stopped) return;
          try {
            const sigs = await pollFn({
              data: { roomCode: upperCode, sinceId: sinceIdRef.current },
            });
            for (const s of sigs) {
              sinceIdRef.current = Math.max(sinceIdRef.current, s.id);
              try {
                const parsed = JSON.parse(s.payload);
                await manager.handleSignal(s.from_user, parsed);
              } catch {}
            }
          } catch (e) {
            console.error("poll", e);
          }
          if (!stopped) pollTimer = setTimeout(poll, 1200);
        };
        poll();

        membersTimer = setInterval(async () => {
          try {
            const m = await membersFn({ data: { code: upperCode } });
            m.forEach((mm) => (usernamesRef.current[mm.id] = mm.username));
          } catch {}
        }, 10000);

        setReady(true);
      } catch (e) {
        toast.error((e as Error).message || t("error_generic"));
        navigate({ to: "/dashboard" });
      }
    }
    init();

    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (discoveryTimer) clearInterval(discoveryTimer);
      if (membersTimer) clearInterval(membersTimer);
      managerRef.current?.destroy();
      managerRef.current = null;
      leaveFn({ data: { code: upperCode } }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upperCode]);

  const activeQuality = useMemo(() => {
    if (preset === "custom") return customQ;
    if (preset === "auto") return QUALITY_PRESETS.medium;
    return QUALITY_PRESETS[preset];
  }, [preset, customQ]);

  useEffect(() => {
    managerRef.current?.updateQuality(activeQuality);
  }, [activeQuality]);

  useEffect(() => {
    if (preset !== "auto") return;
    const interval = setInterval(() => {
      const manager = managerRef.current;
      if (!manager) return;
      const nav = navigator as unknown as { connection?: { downlink?: number } };
      const dl = nav.connection?.downlink ?? 5;
      const target: "low" | "medium" | "high" | "hd" =
        dl < 0.5 ? "low" : dl < 2 ? "medium" : dl < 5 ? "high" : "hd";
      manager.updateQuality(QUALITY_PRESETS[target]);
    }, 5000);
    return () => clearInterval(interval);
  }, [preset]);

  function onToggleMic() {
    const n = !micOn;
    setMicOn(n);
    managerRef.current?.toggleMic(n);
  }
  async function onToggleCam() {
    const n = !camOn;
    setCamOn(n);
    if (n && managerRef.current) {
      // Request video track on-demand
      const stream = managerRef.current.getLocalStream();
      const hasVideo = stream && stream.getVideoTracks().length > 0;
      if (!hasVideo) {
        try {
          await managerRef.current.initMedia(activeQuality, true, true);
          if (localVideoRef.current && managerRef.current.getLocalStream()) {
            localVideoRef.current.srcObject = managerRef.current.getLocalStream();
          }
        } catch (e) {
          setCamOn(false);
          toast.error((e as Error).message);
          return;
        }
      }
      managerRef.current.toggleCam(true);
    } else {
      managerRef.current?.toggleCam(false);
    }
  }
  async function onToggleScreen() {
    if (!managerRef.current) return;
    try {
      if (screenOn) {
        await managerRef.current.stopScreenShare();
        setScreenOn(false);
      } else {
        await managerRef.current.startScreenShare();
        setScreenOn(true);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function onLeave() {
    await leaveFn({ data: { code: upperCode } }).catch(() => {});
    navigate({ to: "/dashboard" });
  }
  function sendChatMsg(textOverride?: string) {
    const raw = (textOverride ?? msgInput).trim();
    if (!raw || !managerRef.current) return;
    if (raw.length > CHAT_MAX_CHARS) {
      toast.error(t("msg_too_long"));
      return;
    }
    const now = Date.now();
    if (now - lastMsgAtRef.current < CHAT_RATE_MS) {
      toast.warning(t("msg_too_fast"));
      return;
    }
    lastMsgAtRef.current = now;
    managerRef.current.sendChat(raw);
    setChat((c) => [
      ...c,
      { from: meRef.current?.username ?? "me", text: raw, self: true, ts: now },
    ]);
    if (!textOverride) setMsgInput("");
  }
  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !managerRef.current) return;
    managerRef.current.sendFile(f);
    const url = URL.createObjectURL(f);
    setChat((c) => [
      ...c,
      {
        from: meRef.current?.username ?? "me",
        text: f.name,
        self: true,
        ts: Date.now(),
        file: { name: f.name, url, mime: f.type || "application/octet-stream", size: f.size },
      },
    ]);
    e.target.value = "";
  }

  function doPoke(peerId: number) {
    const now = Date.now();
    const last = lastPokeAtRef.current[peerId] ?? 0;
    if (now - last < POKE_COOLDOWN_MS) {
      toast.warning(t("poke_cooldown"));
      return;
    }
    lastPokeAtRef.current[peerId] = now;
    managerRef.current?.sendControl({ type: "poke", to: peerId, text: "👉" }, peerId);
    toast.success(`👉 ${usernamesRef.current[peerId] ?? "#" + peerId}`);
  }

  async function doKick(peerId: number) {
    try {
      managerRef.current?.sendControl({ type: "kicked", to: peerId }, peerId);
      await kickFn({ data: { code: upperCode, userId: peerId } });
      managerRef.current?.removePeer(peerId);
      toast.success("Kicked");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function doBan(peerId: number) {
    try {
      managerRef.current?.sendControl({ type: "kicked", to: peerId }, peerId);
      await banFn({ data: { code: upperCode, userId: peerId } });
      managerRef.current?.removePeer(peerId);
      toast.success("Banned");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const setPeerVolume = useCallback((id: number, v: number) => {
    setPeers((p) => (p[id] ? { ...p, [id]: { ...p[id], volume: v } } : p));
  }, []);
  const setPeerSpeaking = useCallback((id: number, v: boolean) => {
    setPeers((p) => (p[id] ? { ...p, [id]: { ...p[id], speaking: v } } : p));
  }, []);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  useSpeakingDetector(managerRef.current?.getLocalStream() ?? null, setSelfSpeaking);

  const remoteCount = Object.keys(peers).length;
  const totalTiles = remoteCount + 1;
  const gridCols =
    totalTiles === 1 ? "grid-cols-1" :
    totalTiles === 2 ? "grid-cols-1 sm:grid-cols-2" :
    totalTiles <= 4 ? "grid-cols-2" :
    totalTiles <= 9 ? "grid-cols-2 md:grid-cols-3" :
    "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

  const visible = chat.slice(Math.max(0, chat.length - visibleCount));

  return (
    <div dir={dir} className="flex h-[calc(100dvh-3.5rem)] lg:h-dvh flex-col bg-background">
      {/* Room header */}
      <div className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground font-black">
            پ
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{t("room_code")}</div>
            <div className="flex items-center gap-1 font-mono text-xs text-primary">
              {upperCode}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(upperCode);
                  toast.success(t("copied"));
                }}
                className="opacity-70 hover:opacity-100"
                aria-label="copy"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{totalTiles}</span>
          <span className="tabular-nums font-mono">{fmtDuration(duration)}</span>
        </div>
      </div>

      {/* Main split */}
      <div className="flex flex-1 min-h-0">
        {/* Video area */}
        <div className="flex flex-1 flex-col min-w-0">
          <div className={`grid flex-1 gap-2 overflow-y-auto p-2 md:p-3 ${gridCols}`}>
            {/* self */}
            <VideoTile
              label={meRef.current?.username ?? "you"}
              videoRef={localVideoRef}
              muted
              self
              micOn={micOn}
              camOn={camOn}
              speaking={selfSpeaking && micOn}
              isOwner={ownerId === meRef.current?.id}
              afk={afk}
            />
            {Object.values(peers).map((p) => (
              <RemoteTile
                key={p.userId}
                peer={p}
                username={usernamesRef.current[p.userId] ?? `#${p.userId}`}
                onSpeakingChange={(v) => setPeerSpeaking(p.userId, v)}
                onVolumeChange={(v) => setPeerVolume(p.userId, v)}
                isOwnerOfRoom={ownerId === p.userId}
                iAmOwner={iAmOwner}
                onKick={() => doKick(p.userId)}
                onBan={() => doBan(p.userId)}
                onPoke={() => doPoke(p.userId)}
                pingLabel={t("ping")}
                afkLabel={t("afk")}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border bg-card/50 p-3">
            <ControlBtn on={micOn} onIcon={<Mic className="h-5 w-5" />} offIcon={<MicOff className="h-5 w-5" />} onClick={onToggleMic} label={micOn ? t("mic_on") : t("mic_off")} />
            <ControlBtn on={camOn} onIcon={<VideoIcon className="h-5 w-5" />} offIcon={<VideoOff className="h-5 w-5" />} onClick={onToggleCam} label={camOn ? t("cam_on") : t("cam_off")} />
            <ControlBtn on={!screenOn} onIcon={<Monitor className="h-5 w-5" />} offIcon={<MonitorOff className="h-5 w-5" />} onClick={onToggleScreen} label={screenOn ? t("stop_share") : t("share_screen")} activeColor={screenOn ? "bg-primary text-primary-foreground" : ""} />
            <button onClick={() => setSettingsOpen(!settingsOpen)} className={`grid h-11 w-11 place-items-center rounded-full border border-border ${settingsOpen ? "bg-primary text-primary-foreground" : "bg-secondary"} hover:brightness-110`} aria-label={t("quality")}>
              <Settings2 className="h-5 w-5" />
            </button>
            <button onClick={() => setChatOpen(!chatOpen)} className={`grid h-11 w-11 place-items-center rounded-full border border-border ${chatOpen ? "bg-primary text-primary-foreground" : "bg-secondary"} hover:brightness-110 lg:hidden`} aria-label={t("chat")}>
              <MessageSquare className="h-5 w-5" />
            </button>
            <button onClick={onLeave} className="grid h-11 w-11 place-items-center rounded-full bg-destructive text-destructive-foreground hover:brightness-110" aria-label={t("leave_room")}>
              <Phone className="h-5 w-5 rotate-[135deg]" />
            </button>
          </div>

          {/* Quality panel */}
          {settingsOpen && (
            <div className="border-t border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold me-2">{t("quality")}:</span>
                {(["auto", "low", "medium", "high", "hd", "custom"] as QualityPreset[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={`rounded-md border border-border px-3 py-1.5 text-xs font-medium transition ${
                      preset === p ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/70"
                    }`}
                  >
                    {p === "auto" ? t("quality_auto") :
                     p === "custom" ? t("quality_custom") :
                     p === "low" ? t("quality_low") :
                     p === "medium" ? t("quality_medium") :
                     p === "high" ? t("quality_high") : t("quality_hd")}
                  </button>
                ))}
              </div>
              {preset === "custom" && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <NumField label={`${t("resolution")} W`} value={customQ.width} onChange={(v) => setCustomQ({ ...customQ, width: v })} />
                  <NumField label={`${t("resolution")} H`} value={customQ.height} onChange={(v) => setCustomQ({ ...customQ, height: v })} />
                  <NumField label={t("framerate")} value={customQ.frameRate} onChange={(v) => setCustomQ({ ...customQ, frameRate: v })} />
                  <NumField label={t("video_bitrate")} value={customQ.videoBitrateKbps} onChange={(v) => setCustomQ({ ...customQ, videoBitrateKbps: v })} />
                  <NumField label={t("audio_bitrate")} value={customQ.audioBitrateKbps} onChange={(v) => setCustomQ({ ...customQ, audioBitrateKbps: v })} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat side */}
        <aside
          className={`${chatOpen ? "flex" : "hidden lg:flex"} w-full max-w-sm flex-col border-s border-border bg-card lg:w-80 fixed lg:static inset-0 z-40 lg:z-auto`}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="font-bold text-sm">{t("chat")}</span>
            </div>
            <button className="lg:hidden rounded p-1 hover:bg-secondary" onClick={() => setChatOpen(false)} aria-label="close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
            {chat.length > visibleCount && (
              <button
                onClick={() => setVisibleCount((v) => v + CHAT_PAGE_SIZE)}
                className="w-full rounded-md bg-secondary py-1.5 text-xs text-muted-foreground hover:bg-secondary/70"
              >
                ↑ {chat.length - visibleCount}+
              </button>
            )}
            {visible.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">—</p>
            )}
            {visible.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.self ? "items-end" : "items-start"}`}>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  {m.poke && <Bell className="h-2.5 w-2.5 text-warning" />}
                  {m.from}
                </span>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm break-words whitespace-pre-wrap overflow-hidden ${
                    m.poke
                      ? "bg-warning/20 border border-warning/60 text-foreground"
                      : m.self
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {m.file ? (
                    <FileMessage file={m.file} self={m.self} />
                  ) : (
                    linkify(m.text).map((tok, j) =>
                      tok.type === "link" ? (
                        <a
                          key={j}
                          href={tok.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline break-all"
                        >
                          {tok.value}
                        </a>
                      ) : (
                        <span key={j}>{tok.value}</span>
                      ),
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Emoji picker */}
          {emojiOpen && (
            <div className="grid grid-cols-8 gap-1 border-t border-border p-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setMsgInput((v) => (v + e).slice(0, CHAT_MAX_CHARS));
                    setEmojiOpen(false);
                  }}
                  className="text-xl rounded hover:bg-secondary p-1"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          <div className="border-t border-border p-2 flex items-center gap-1">
            <label className="cursor-pointer rounded-md p-2 hover:bg-secondary">
              <Paperclip className="h-4 w-4" />
              <input type="file" className="hidden" onChange={onFilePick} />
            </label>
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              className="rounded-md p-2 hover:bg-secondary"
              aria-label="emoji"
            >
              <Smile className="h-4 w-4" />
            </button>
            <Input
              placeholder={t("type_message")}
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value.slice(0, CHAT_MAX_CHARS))}
              maxLength={CHAT_MAX_CHARS}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMsg();
                }
              }}
              className="flex-1"
            />
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {msgInput.length}/{CHAT_MAX_CHARS}
            </span>
            <Button size="sm" onClick={() => sendChatMsg()} disabled={!msgInput.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </aside>
      </div>
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-background/80 backdrop-blur">
          <div className="text-center">
            <div className="h-10 w-10 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <p className="mt-3 text-sm text-muted-foreground">{t("connecting")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function playPokeSound() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.start();
    osc.frequency.exponentialRampToValueAtTime(440, ac.currentTime + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.2);
    osc.stop(ac.currentTime + 0.25);
    setTimeout(() => ac.close(), 500);
  } catch {}
}

function ControlBtn({
  on, onIcon, offIcon, onClick, label, activeColor,
}: {
  on: boolean; onIcon: React.ReactNode; offIcon: React.ReactNode; onClick: () => void; label: string; activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 place-items-center rounded-full border border-border transition hover:brightness-110 ${
        on ? "bg-secondary" : "bg-destructive text-destructive-foreground"
      } ${activeColor ?? ""}`}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

function VideoTile({
  label, videoRef, stream, muted, self, micOn, camOn, speaking, isOwner, afk, ping, volume = 1, onVolumeChange, extras,
}: {
  label: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  stream?: MediaStream;
  muted?: boolean;
  self?: boolean;
  micOn?: boolean;
  camOn?: boolean;
  speaking?: boolean;
  isOwner?: boolean;
  afk?: boolean;
  ping?: number;
  volume?: number;
  onVolumeChange?: (v: number) => void;
  extras?: React.ReactNode;
}) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? localRef;
  const [tileRef, setTileRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (stream && ref.current) ref.current.srcObject = stream;
  }, [stream, ref]);
  useEffect(() => {
    if (ref.current && !self) ref.current.volume = volume;
  }, [volume, ref, self]);

  async function goFullscreen() {
    if (!tileRef) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await tileRef.requestFullscreen();
  }
  async function goPip() {
    const v = ref.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {}
  }

  return (
    <div
      ref={setTileRef}
      className={`relative overflow-hidden rounded-lg border-2 bg-black aspect-video transition ${
        speaking ? "border-success shadow-[0_0_0_2px_hsl(var(--success)/0.5)]" : "border-border"
      }`}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${self ? "-scale-x-100" : ""} ${
          camOn === false ? "hidden" : ""
        }`}
      />
      {camOn === false && (
        <div className="absolute inset-0 grid place-items-center bg-black">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-secondary text-2xl font-black">
            {label[0]?.toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute top-2 end-2 flex items-center gap-1">
        {ping != null && ping > 0 && (
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-white backdrop-blur">
            {ping}ms
          </span>
        )}
        {afk && (
          <span className="rounded bg-warning/80 p-1 text-warning-foreground" title="AFK">
            <Moon className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="absolute bottom-2 start-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur max-w-[calc(100%-1rem)]">
        {isOwner && <Crown className="h-3 w-3 text-warning shrink-0" />}
        <span className="max-w-[100px] truncate">{label}</span>
        {micOn === false && <MicOff className="h-3 w-3 text-destructive" />}
      </div>
      <div className="absolute bottom-2 end-2 flex items-center gap-1">
        {!self && onVolumeChange && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="w-16 accent-primary opacity-70 hover:opacity-100"
            title="Volume"
          />
        )}
        <button onClick={goFullscreen} className="rounded bg-black/60 p-1 text-white hover:bg-black/80" aria-label="fullscreen">
          <Maximize2 className="h-3 w-3" />
        </button>
        {!self && (
          <button onClick={goPip} className="rounded bg-black/60 p-1 text-white hover:bg-black/80" aria-label="pip">
            <PictureInPicture2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {extras && <div className="absolute top-2 start-2 flex gap-1">{extras}</div>}
    </div>
  );
}

function RemoteTile({
  peer, username, onSpeakingChange, onVolumeChange, isOwnerOfRoom, iAmOwner, onKick, onBan, onPoke, pingLabel, afkLabel,
}: {
  peer: RemotePeer;
  username: string;
  onSpeakingChange: (v: boolean) => void;
  onVolumeChange: (v: number) => void;
  isOwnerOfRoom: boolean;
  iAmOwner: boolean;
  onKick: () => void;
  onBan: () => void;
  onPoke: () => void;
  pingLabel: string;
  afkLabel: string;
}) {
  useSpeakingDetector(peer.stream ?? null, onSpeakingChange);
  void pingLabel;
  void afkLabel;
  const extras = (
    <>
      <button onClick={onPoke} className="rounded bg-black/60 p-1 text-white hover:bg-warning" aria-label="poke" title="Poke">
        <Bell className="h-3 w-3" />
      </button>
      {iAmOwner && !isOwnerOfRoom && (
        <>
          <button onClick={onKick} className="rounded bg-black/60 p-1 text-white hover:bg-destructive" aria-label="kick" title="Kick">
            <UserMinus className="h-3 w-3" />
          </button>
          <button onClick={onBan} className="rounded bg-black/60 p-1 text-white hover:bg-destructive" aria-label="ban" title="Ban">
            <Ban className="h-3 w-3" />
          </button>
        </>
      )}
    </>
  );
  return (
    <VideoTile
      label={username}
      stream={peer.stream}
      camOn={peer.stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live") ?? false}
      speaking={peer.speaking}
      isOwner={isOwnerOfRoom}
      afk={peer.afk}
      ping={peer.ping}
      volume={peer.volume ?? 1}
      onVolumeChange={onVolumeChange}
      extras={extras}
    />
  );
}

function FileMessage({ file, self }: { file: { name: string; url: string; mime: string; size: number }; self?: boolean }) {
  const isAudio = file.mime.startsWith("audio/");
  const isImage = file.mime.startsWith("image/");
  const isVideo = file.mime.startsWith("video/");
  const size = file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  void self;
  return (
    <div className="space-y-1.5">
      {isAudio && <audio src={file.url} controls className="max-w-full" />}
      {isImage && <img src={file.url} alt={file.name} className="max-w-full max-h-48 rounded" />}
      {isVideo && <video src={file.url} controls className="max-w-full max-h-48 rounded" />}
      <a href={file.url} download={file.name} className="text-xs underline block truncate">
        📎 {file.name} <span className="opacity-70">({size})</span>
      </a>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1" />
    </div>
  );
}
