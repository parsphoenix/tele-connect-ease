import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listFriends, addFriend, acceptFriend, removeFriend } from "@/lib/friends.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Check, X, UserPlus, Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/friends")({
  component: FriendsPage,
});

function FriendsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listFriends);
  const addFn = useServerFn(addFriend);
  const acceptFn = useServerFn(acceptFriend);
  const removeFn = useServerFn(removeFriend);
  const [username, setUsername] = useState("");

  const { data: friends = [] } = useQuery({
    queryKey: ["friends"],
    queryFn: () => listFn(),
    refetchInterval: 10000,
  });

  const addMut = useMutation({
    mutationFn: () => addFn({ data: { username: username.trim() } }),
    onSuccess: () => {
      setUsername("");
      toast.success("ok");
      qc.invalidateQueries({ queryKey: ["friends"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const acceptMut = useMutation({
    mutationFn: (id: number) => acceptFn({ data: { friendId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["friends"] }),
  });
  const removeMut = useMutation({
    mutationFn: (id: number) => removeFn({ data: { friendId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["friends"] }),
  });

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-black">{t("friends")}</h1>

      <Card className="bg-panel border-border p-4">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={t("username")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <Button
            onClick={() => addMut.mutate()}
            disabled={!username.trim() || addMut.isPending}
            className="gap-1.5"
          >
            <UserPlus className="h-4 w-4" />
            {t("add_friend")}
          </Button>
        </div>
      </Card>

      <Card className="bg-panel border-border p-2">
        {friends.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">—</p>
        ) : (
          <ul className="divide-y divide-border">
            {friends.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary font-bold">
                    {f.username[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{f.username}</div>
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
                <div className="flex gap-1">
                  {f.status === "pending" && f.direction === "incoming" && (
                    <Button size="sm" variant="secondary" onClick={() => acceptMut.mutate(f.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeMut.mutate(f.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
