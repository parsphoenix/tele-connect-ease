import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoom, listPublicRooms, joinRoom } from "@/lib/rooms.functions";
import { listFriends } from "@/lib/friends.functions";
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
import { Plus, Users, Video, ArrowRight, Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listPublicRooms);
  const friendsFn = useServerFn(listFriends);
  const createFn = useServerFn(createRoom);
  const joinFn = useServerFn(joinRoom);

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
  const [isPublic, setIsPublic] = useState(true);
  const [maxUsers, setMaxUsers] = useState(16);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      createFn({ data: { name: name.trim(), isPublic, maxUsers } }),
    onSuccess: (res) => {
      setDialogOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["rooms"] });
      navigate({ to: "/room/$code", params: { code: res.code } });
    },
    onError: () => toast.error(t("error_generic")),
  });

  async function onJoin(code: string) {
    try {
      await joinFn({ data: { code } });
      navigate({ to: "/room/$code", params: { code: code.toUpperCase() } });
    } catch {
      toast.error(t("error_generic"));
    }
  }

  const onlineFriends = friends.filter((f) => f.status === "accepted" && f.presence);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">{t("dashboard")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("active_rooms")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder={t("room_code")}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={16}
              className="w-32 font-mono uppercase"
            />
            <Button
              onClick={() => joinCode && onJoin(joinCode)}
              disabled={!joinCode}
              variant="secondary"
            >
              {t("join_by_code")}
            </Button>
          </div>
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
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {isPublic
                        ? "قابل مشاهده در لیست عمومی"
                        : "فقط با کد دعوت"}
                    </div>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>
                <div>
                  <Label>
                    {t("max_users")}: <span className="text-primary font-bold">{maxUsers}</span>
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
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  onClick={() => createMut.mutate()}
                  disabled={!name.trim() || createMut.isPending}
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
                  onClick={() => onJoin(r.code)}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="font-bold truncate">{r.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {r.owner}
                      </p>
                    </div>
                    <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-mono font-bold text-primary">
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
            {friends.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("no_rooms")}
              </p>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {friends.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-md p-2 hover:bg-secondary"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold">
                        {f.username[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {f.username}
                        </div>
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
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
