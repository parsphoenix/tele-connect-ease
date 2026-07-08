import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getRoom,
  joinRoom,
  leaveRoom,
  listRoomMembers,
} from "@/lib/rooms.functions";
import {
  pollSignals,
  sendSignal,
  listActiveUsers,
} from "@/lib/signaling.functions";
import { getIceServers } from "@/lib/ice.functions";
import { me } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";
import { MeshManager, QUALITY_PRESETS, type QualityConfig, type QualityPreset } from "@/lib/webrtc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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
}
interface ChatMsg {
  from: string;
  text: string;
  self?: boolean;
  ts: number;
  file?: { name: string; url: string };
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

  const [ready, setReady] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [peers, setPeers] = useState<Record<number, RemotePeer>>({});
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [preset, setPreset] = useState<QualityPreset>("medium");
  const [customQ, setCustomQ] = useState<QualityConfig>(QUALITY_PRESETS.medium);

  const managerRef = useRef<MeshManager | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sinceIdRef = useRef(0);
  const usernamesRef = useRef<Record<number, string>>({});
  const meRef = useRef<{ id: number; username: string } | null>(null);

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
        void room;
        await joinFn({ data: { code: upperCode } });
        const iceServers = await iceFn();

        const manager = new MeshManager({
          myId: user.id,
          roomCode: upperCode,
          iceServers,
          send: async (toUser, payload) => {
            await sendFn({
              data: {
                roomCode: upperCode,
                toUser,
                payload: JSON.stringify(payload),
              },
            });
          },
          events: {
            onRemoteStream(userId, stream) {
              setPeers((p) => ({
                ...p,
                [userId]: { ...(p[userId] ?? { userId }), stream },
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
                { from: usernamesRef.current[userId] ?? `#${userId}`, text, ts: Date.now() },
              ]);
            },
            onFile(userId, name, blob) {
              const url = URL.createObjectURL(blob);
              setChat((c) => [
                ...c,
                {
                  from: usernamesRef.current[userId] ?? `#${userId}`,
                  text: `📎 ${name}`,
                  ts: Date.now(),
                  file: { name, url },
                },
              ]);
            },
            onStatus(userId, state) {
              setPeers((p) => ({
                ...p,
                [userId]: { ...(p[userId] ?? { userId }), status: state },
              }));
            },
          },
        });
        managerRef.current = manager;

        await manager.initMedia(QUALITY_PRESETS.medium, true, true);
        if (localVideoRef.current && manager.getLocalStream()) {
          localVideoRef.current.srcObject = manager.getLocalStream();
        }

        // Discovery: every 4s check active users; connect to new peers
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
            // remove peers not active
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

        // Poll signals
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

        // Members refresh
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

  // Auto quality: rough network probing via PC stats
  useEffect(() => {
    if (preset !== "auto") return;
    const interval = setInterval(async () => {
      const manager = managerRef.current;
      if (!manager) return;
      // Use first peer's stats as proxy
      const ids = manager.getPeerIds();
      if (ids.length === 0) return;
      // pick from map - internal not exposed, use setParameters info only
      // Fall back to browser downlink hint
      const nav = navigator as unknown as { connection?: { downlink?: number } };
      const dl = nav.connection?.downlink ?? 5;
      const target: QualityPreset =
        dl < 0.5 ? "low" : dl < 2 ? "medium" : dl < 5 ? "high" : "hd";
      const q = QUALITY_PRESETS[target as Exclude<QualityPreset, "custom" | "auto">];
      manager.updateQuality(q);
    }, 5000);
    return () => clearInterval(interval);
  }, [preset]);

  function onToggleMic() {
    const n = !micOn;
    setMicOn(n);
    managerRef.current?.toggleMic(n);
  }
  function onToggleCam() {
    const n = !camOn;
    setCamOn(n);
    managerRef.current?.toggleCam(n);
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
  function sendChatMsg() {
    if (!msgInput.trim() || !managerRef.current) return;
    managerRef.current.sendChat(msgInput);
    setChat((c) => [
      ...c,
      { from: meRef.current?.username ?? "me", text: msgInput, self: true, ts: Date.now() },
    ]);
    setMsgInput("");
  }
  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !managerRef.current) return;
    managerRef.current.sendFile(f);
    setChat((c) => [
      ...c,
      {
        from: meRef.current?.username ?? "me",
        text: `📎 ${f.name} (sending...)`,
        self: true,
        ts: Date.now(),
      },
    ]);
    e.target.value = "";
  }

  const remoteCount = Object.keys(peers).length;
  const totalTiles = remoteCount + 1;
  const gridCols =
    totalTiles === 1 ? "grid-cols-1" :
    totalTiles === 2 ? "grid-cols-1 sm:grid-cols-2" :
    totalTiles <= 4 ? "grid-cols-2" :
    totalTiles <= 9 ? "grid-cols-2 md:grid-cols-3" :
    "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

  return (
    <div dir={dir} className="flex h-[calc(100dvh-3.5rem)] lg:h-dvh flex-col bg-background">
      {/* Room header */}
      <div className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-2">
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-4 w-4" />
          {totalTiles}
        </div>
      </div>

      {/* Main split */}
      <div className="flex flex-1 min-h-0">
        {/* Video area */}
        <div className="flex flex-1 flex-col min-w-0">
          <div className={`grid flex-1 gap-2 overflow-y-auto p-2 md:p-3 ${gridCols}`}>
            {/* self */}
            <VideoTile
              label={`${meRef.current?.username ?? "you"} (${t("username")})`}
              videoRef={localVideoRef}
              muted
              self
              micOn={micOn}
              camOn={camOn}
            />
            {Object.values(peers).map((p) => (
              <RemoteTile
                key={p.userId}
                peer={p}
                username={usernamesRef.current[p.userId] ?? `#${p.userId}`}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border bg-card/50 p-3">
            <ControlBtn
              on={micOn}
              onIcon={<Mic className="h-5 w-5" />}
              offIcon={<MicOff className="h-5 w-5" />}
              onClick={onToggleMic}
              label={micOn ? t("mic_on") : t("mic_off")}
            />
            <ControlBtn
              on={camOn}
              onIcon={<VideoIcon className="h-5 w-5" />}
              offIcon={<VideoOff className="h-5 w-5" />}
              onClick={onToggleCam}
              label={camOn ? t("cam_on") : t("cam_off")}
            />
            <ControlBtn
              on={!screenOn}
              onIcon={<Monitor className="h-5 w-5" />}
              offIcon={<MonitorOff className="h-5 w-5" />}
              onClick={onToggleScreen}
              label={screenOn ? t("stop_share") : t("share_screen")}
              activeColor={screenOn ? "bg-primary text-primary-foreground" : ""}
            />
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`grid h-11 w-11 place-items-center rounded-full border border-border ${settingsOpen ? "bg-primary text-primary-foreground" : "bg-secondary"} hover:brightness-110`}
              aria-label={t("quality")}
            >
              <Settings2 className="h-5 w-5" />
            </button>
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`grid h-11 w-11 place-items-center rounded-full border border-border ${chatOpen ? "bg-primary text-primary-foreground" : "bg-secondary"} hover:brightness-110 lg:hidden`}
              aria-label={t("chat")}
            >
              <MessageSquare className="h-5 w-5" />
            </button>
            <button
              onClick={onLeave}
              className="grid h-11 w-11 place-items-center rounded-full bg-destructive text-destructive-foreground hover:brightness-110"
              aria-label={t("leave_room")}
            >
              <Phone className="h-5 w-5 rotate-[135deg]" />
            </button>
          </div>

          {/* Quality panel */}
          {settingsOpen && (
            <div className="border-t border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold me-2">{t("quality")}:</span>
                {(["auto", "low", "medium", "high", "hd", "custom"] as QualityPreset[]).map(
                  (p) => (
                    <button
                      key={p}
                      onClick={() => setPreset(p)}
                      className={`rounded-md border border-border px-3 py-1.5 text-xs font-medium transition ${
                        preset === p
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary hover:bg-secondary/70"
                      }`}
                    >
                      {p === "auto" ? t("quality_auto") :
                       p === "custom" ? t("quality_custom") :
                       p === "low" ? t("quality_low") :
                       p === "medium" ? t("quality_medium") :
                       p === "high" ? t("quality_high") :
                       t("quality_hd")}
                    </button>
                  ),
                )}
              </div>
              {preset === "custom" && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <NumField
                    label={`${t("resolution")} W`}
                    value={customQ.width}
                    onChange={(v) => setCustomQ({ ...customQ, width: v })}
                  />
                  <NumField
                    label={`${t("resolution")} H`}
                    value={customQ.height}
                    onChange={(v) => setCustomQ({ ...customQ, height: v })}
                  />
                  <NumField
                    label={t("framerate")}
                    value={customQ.frameRate}
                    onChange={(v) => setCustomQ({ ...customQ, frameRate: v })}
                  />
                  <NumField
                    label={t("video_bitrate")}
                    value={customQ.videoBitrateKbps}
                    onChange={(v) => setCustomQ({ ...customQ, videoBitrateKbps: v })}
                  />
                  <NumField
                    label={t("audio_bitrate")}
                    value={customQ.audioBitrateKbps}
                    onChange={(v) => setCustomQ({ ...customQ, audioBitrateKbps: v })}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat side */}
        <aside
          className={`${
            chatOpen ? "flex" : "hidden lg:flex"
          } w-full max-w-sm flex-col border-s border-border bg-card lg:w-80 fixed lg:static inset-0 z-40 lg:z-auto`}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="font-bold text-sm">{t("chat")}</span>
            </div>
            <button
              className="lg:hidden rounded p-1 hover:bg-secondary"
              onClick={() => setChatOpen(false)}
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
            {chat.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">—</p>
            )}
            {chat.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col ${m.self ? "items-end" : "items-start"}`}
              >
                <span className="text-[10px] text-muted-foreground">{m.from}</span>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${
                    m.self
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {m.file ? (
                    <a
                      href={m.file.url}
                      download={m.file.name}
                      className="underline"
                    >
                      {m.text}
                    </a>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2 flex items-center gap-1">
            <label className="cursor-pointer rounded-md p-2 hover:bg-secondary">
              <Paperclip className="h-4 w-4" />
              <input type="file" className="hidden" onChange={onFilePick} />
            </label>
            <Input
              placeholder={t("type_message")}
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMsg();
                }
              }}
              className="flex-1"
            />
            <Button size="sm" onClick={sendChatMsg} disabled={!msgInput.trim()}>
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

function ControlBtn({
  on,
  onIcon,
  offIcon,
  onClick,
  label,
  activeColor,
}: {
  on: boolean;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  onClick: () => void;
  label: string;
  activeColor?: string;
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
  label,
  videoRef,
  stream,
  muted,
  self,
  micOn,
  camOn,
}: {
  label: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  stream?: MediaStream;
  muted?: boolean;
  self?: boolean;
  micOn?: boolean;
  camOn?: boolean;
}) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? localRef;
  useEffect(() => {
    if (stream && ref.current) ref.current.srcObject = stream;
  }, [stream, ref]);
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-black aspect-video">
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
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-secondary text-2xl font-black">
            {label[0]?.toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 start-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur">
        <span className="max-w-[120px] truncate">{label}</span>
        {micOn === false && <MicOff className="h-3 w-3 text-destructive" />}
      </div>
    </div>
  );
}

function RemoteTile({ peer, username }: { peer: RemotePeer; username: string }) {
  return (
    <VideoTile
      label={username}
      stream={peer.stream}
    />
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1"
      />
    </div>
  );
}
