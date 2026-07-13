import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoom, listPublicRooms, joinRoom } from "@/lib/rooms.functions";
import { listFriends } from "@/lib/friends.functions";
import { pollInvites, sendInvite } from "@/lib/invites.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Users, Video, ArrowRight, Circle, Lock, Crown, Send, Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

interface Invite {
  id: number;
  from_user: number;
  roomCode: string;
  from: string;
  message: string;
}

function Dashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listPublicRooms);
  const friendsFn = useServerFn(listFriends);
  const createFn = useServerFn(createRoom);
  const joinFn = useServerFn(joinRoom);
  const inviteFn = useServerFn(sendInvite);
  const pollInvFn = useServerFn(pollInvites);

  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => listFn(),
    refetchInterval: 8000,
  });
  const { data: friends = [] } = useQuery({
    queryKey: ["friends"],
    queryFn: () => friendsFn(),
    refetchInterval: 15000,
  });

  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false); // private by default
  const [maxUsers, setMaxUsers] = useState(16);
  const [roomPassword, setRoomPassword] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinDlgOpen, setJoinDlgOpen] = useState(false);
  const [joinTargetCode, setJoinTargetCode] = useState("");
  const [inviteTarget, setInviteTarget] = useState<{ id: number; username: string } | null>(null);
  const [inviteRoomCode, setInviteRoomCode] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const sinceRef = useRef(0);

  // Simple math captcha for room creation
  const [captchaA, setCaptchaA] = useState(() => Math.floor(Math.random() * 8) + 1);
  const [captchaB, setCaptchaB] = useState(() => Math.floor(Math.random() * 8) + 1);
  const [captchaInput, setCaptchaInput] = useState("");
  const regenCaptcha = () => {
    setCaptchaA(Math.floor(Math.random() * 8) + 1);
    setCaptchaB(Math.floor(Math.random() * 8) + 1);
    setCaptchaInput("");
  };

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name.trim(),
          isPublic,
          maxUsers,
          password: roomPassword.trim() || undefined,
          captchaAnswer: Number(captchaInput),
          captchaExpected: captchaA + captchaB,
        },
      }),
    onSuccess: (res) => {
      setDialogOpen(false);
      setName("");
      setRoomPassword("");
      regenCaptcha();
      qc.invalidateQueries({ queryKey: ["rooms"] });
      navigate({ to: "/room/$code", params: { code: res.code } });
    },
    onError: (e) => {
      const msg = (e as Error).message || "";
      if (msg.includes("CAPTCHA_INVALID")) {
        toast.error(t("captcha_invalid") || "Captcha invalid");
        regenCaptcha();
      } else {
        toast.error(t("error_generic"));
      }
    },
  });

  // Poll invites
  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const rows = await pollInvFn({ data: { sinceId: sinceRef.current } });
        for (const r of rows) {
          sinceRef.current = Math.max(sinceRef.current, r.id);
          try {
            const p = JSON.parse(r.payload);
            if (p.type === "invite") {
              setInvites((v) => [
                ...v,
                {
                  id: r.id,
                  from_user: r.from_user,
                  roomCode: p.roomCode,
                  from: p.from,
                  message: p.message,
                },
              ]);
            }
          } catch {}
        }
      } catch {}
      if (!stopped) setTimeout(tick, 5000);
    }
    tick();
    return () => {
      stopped = true;
    };
  }, [pollInvFn]);

  async function attemptJoin(code: string, password?: string) {
    try {
      await joinFn({ data: { code, password } });
      navigate({ to: "/room/$code", params: { code: code.toUpperCase() } });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("PASSWORD_REQUIRED") || msg.includes("PASSWORD_INVALID")) {
        setJoinTargetCode(code);
        setJoinPassword("");
        setJoinDlgOpen(true);
        if (msg.includes("PASSWORD_INVALID")) toast.error(t("password_invalid"));
      } else if (msg.includes("BANNED")) toast.error(t("banned"));
      else if (msg.includes("ROOM_FULL")) toast.error(t("room_full"));
      else toast.error(t("error_generic"));
    }
  }

  async function onSendInvite() {
    if (!inviteTarget || !inviteRoomCode.trim()) return;
    try {
      await inviteFn({
        data: {
          toUser: inviteTarget.id,
          roomCode: inviteRoomCode.trim().toUpperCase(),
          message: inviteMsg.trim() || undefined,
        },
      });
      toast.success(t("invite_sent"));
      setInviteTarget(null);
      setInviteMsg("");
      setInviteRoomCode("");
    } catch {
      toast.error(t("error_generic"));
    }
  }

  const onlineFriends = friends.filter((f) => f.status === "accepted" && f.presence).slice(0, 10);
  const friendsList = friends.slice(0, 10);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Invites banner */}
      {invites.length > 0 && (
        <div className="space-y-2">
          {invites.map((inv) => (
            <Card
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-3 bg-primary/10 border-primary/40 p-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Bell className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">
                    {t("incoming_invite")} {inv.from}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {inv.message || `${t("room_code")}: ${inv.roomCode}`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setInvites((v) => v.filter((x) => x.id !== inv.id));
                    attemptJoin(inv.roomCode);
                  }}
                >
                  {t("join_invite")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setInvites((v) => v.filter((x) => x.id !== inv.id))}
                >
                  {t("dismiss")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">{t("dashboard")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("active_rooms")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder={t("room_code")}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={16}
            className="w-32 font-mono uppercase"
          />
          <Button
            onClick={() => joinCode && attemptJoin(joinCode)}
            disabled={!joinCode}
            variant="secondary"
          >
            {t("join_by_code")}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="font-bold gap-1.5">
                <Plus className="h-4 w-4" />
                {t("create_room")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("create_room")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t("room_name")}</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1"
                    maxLength={64}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <div className="text-sm font-medium">
                      {isPublic ? t("public_room") : t("private_room")}
                    </div>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>
                <div>
                  <Label>{t("room_password")}</Label>
                  <Input
                    type="password"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                    className="mt-1"
                    maxLength={64}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <Label>
                    {t("max_users")}:{" "}
                    <span className="text-primary font-bold">{maxUsers}</span>
                  </Label>
                  <input
                    type="range"
                    min={2}
                    max={16}
                    value={maxUsers}
                    onChange={(e) => setMaxUsers(Number(e.target.value))}
                    className="w-full mt-2 accent-primary"
                  />
                </div>
                <div>
                  <Label>
                    {t("captcha_label")}: <span className="font-bold">{captchaA} + {captchaB} = ?</span>
                  </Label>
                  <Input
                    value={captchaInput}
                    onChange={(e) => setCaptchaInput(e.target.value.replace(/[^0-9]/g, ""))}
                    className="mt-1 w-24"
                    inputMode="numeric"
                    maxLength={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  onClick={() => createMut.mutate()}
                  disabled={!name.trim() || !captchaInput || createMut.isPending}
                >
                  {t("create")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Rooms grid */}
        <section>
          {rooms.length === 0 ? (
            <Card className="bg-panel border-dashed border-border p-10 text-center">
              <Video className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-muted-foreground">{t("no_rooms")}</p>
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                {t("create_room")}
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rooms.map((r) => (
                <Card
                  key={r.id}
                  className="group bg-panel border-border p-4 hover:border-primary/60 transition cursor-pointer"
                  onClick={() => attemptJoin(r.code)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-bold truncate flex items-center gap-1.5">
                        {r.name}
                        {r.has_password ? <Lock className="h-3.5 w-3.5 text-warning" /> : null}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-1">
                        <Crown className="h-3 w-3 text-warning" />
                        {r.owner}
                      </p>
                    </div>
                    <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-mono font-bold text-primary shrink-0">
                      {r.code}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {r.member_count} / {r.max_users}
                    </span>
                    <ArrowRight className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition rtl:rotate-180" />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Friends sidebar */}
        <aside>
          <Card className="bg-panel border-border p-4">
            <h3 className="font-bold mb-3">
              {t("friends")}{" "}
              <span className="text-xs text-muted-foreground">
                ({onlineFriends.length} {t("online")})
              </span>
            </h3>
            {friendsList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("no_rooms")}</p>
            ) : (
              <ul className="space-y-2">
                {friendsList.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-secondary"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold">
                        {f.username[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{f.username}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Circle
                            className={`h-2 w-2 fill-current ${
                              f.presence === "in_call"
                                ? "text-warning"
                                : f.presence === "online"
                                  ? "text-success"
                                  : "text-muted-foreground"
                            }`}
                          />
                          {f.status === "pending"
                            ? f.direction === "incoming"
                              ? t("incoming")
                              : t("outgoing")
                            : f.presence === "in_call"
                              ? t("in_call")
                              : f.presence === "online"
                                ? t("online")
                                : t("offline")}
                        </div>
                      </div>
                    </div>
                    {f.status === "accepted" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setInviteTarget({ id: f.id, username: f.username })}
                        title={t("invite_to_room")}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      {/* Join with password dialog */}
      <Dialog open={joinDlgOpen} onOpenChange={setJoinDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("enter_room_password")}</DialogTitle>
          </DialogHeader>
          <Input
            type="password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            placeholder={t("password")}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setJoinDlgOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => {
                setJoinDlgOpen(false);
                attemptJoin(joinTargetCode, joinPassword);
              }}
            >
              {t("join")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={!!inviteTarget} onOpenChange={(o) => !o && setInviteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("invite_to_room")} — {inviteTarget?.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("room_code")}</Label>
              <Input
                value={inviteRoomCode}
                onChange={(e) => setInviteRoomCode(e.target.value.toUpperCase())}
                className="mt-1 font-mono uppercase"
                maxLength={16}
              />
            </div>
            <div>
              <Label>{t("type_message")}</Label>
              <Input
                value={inviteMsg}
                onChange={(e) => setInviteMsg(e.target.value)}
                className="mt-1"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={onSendInvite} disabled={!inviteRoomCode.trim()}>
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
