"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

type Member = { userId: string; name: string; email: string; isLead: boolean; isAvailable: boolean };
type Props = {
  team: {
    id: string;
    name: string;
    description: string | null;
    email: string | null;
    assignmentStrategy: string;
    escalationTeamId: string | null;
    escalationUserId: string | null;
    isActive: boolean;
    members: Member[];
  };
  teams: { id: string; name: string }[];
  agents: { id: string; name: string; email: string }[];
};

const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

export function TeamEditor({ team, teams, agents }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [isActive, setIsActive] = useState(team.isActive);
  const [members, setMembers] = useState<Member[]>(team.members);
  const [toAdd, setToAdd] = useState("");

  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    try {
      await api(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        body: {
          name: f.get("name"),
          description: f.get("description") || null,
          email: f.get("email") || null,
          assignmentStrategy: f.get("assignmentStrategy"),
          escalationTeamId: f.get("escalationTeamId") || null,
          escalationUserId: f.get("escalationUserId") || null,
          isActive,
        },
      });
      toast.success("Team saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function saveMembers(next: Member[]) {
    setPending(true);
    try {
      await api(`/api/v1/teams/${team.id}/members`, { method: "PUT", body: { members: next.map(({ userId, isLead, isAvailable }) => ({ userId, isLead, isAvailable })) } });
      setMembers(next);
      toast.success("Members updated");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const candidates = agents.filter((a) => !members.some((m) => m.userId === a.id));

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form onSubmit={saveSettings} className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="te-name">Name</Label>
              <Input id="te-name" name="name" defaultValue={team.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="te-desc">Description</Label>
              <Input id="te-desc" name="description" defaultValue={team.description ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="te-email">Team email</Label>
              <Input id="te-email" name="email" type="email" defaultValue={team.email ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="te-strategy">Assignment</Label>
              <select id="te-strategy" name="assignmentStrategy" defaultValue={team.assignmentStrategy} className={selectCls}>
                <option value="MANUAL">Manual</option>
                <option value="ROUND_ROBIN">Round-robin</option>
                <option value="LOAD_BALANCED">Load-balanced (fewest open tickets)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="te-esc-team">Escalate to team</Label>
              <select id="te-esc-team" name="escalationTeamId" defaultValue={team.escalationTeamId ?? ""} className={selectCls}>
                <option value="">None</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="te-esc-user">Escalation contact</Label>
              <select id="te-esc-user" name="escalationUserId" defaultValue={team.escalationUserId ?? ""} className={selectCls}>
                <option value="">None</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={isActive} onCheckedChange={setIsActive} /> Team active
            </label>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={pending}>
              Save settings
            </Button>
          </CardFooter>
        </Card>
      </form>
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>Unavailable members are skipped by automatic assignment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <select aria-label="Agent to add" value={toAdd} onChange={(e) => setToAdd(e.target.value)} className={selectCls}>
              <option value="">Add an agent…</option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.email})
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={!toAdd || pending}
              onClick={() => {
                const a = agents.find((x) => x.id === toAdd)!;
                setToAdd("");
                void saveMembers([...members, { userId: a.id, name: a.name, email: a.email, isLead: false, isAvailable: true }]);
              }}
            >
              Add
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${m.name} is team lead`}
                      checked={m.isLead}
                      disabled={pending}
                      onCheckedChange={(v) => saveMembers(members.map((x) => (x.userId === m.userId ? { ...x, isLead: v } : x)))}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${m.name} is available for assignment`}
                      checked={m.isAvailable}
                      disabled={pending}
                      onCheckedChange={(v) => saveMembers(members.map((x) => (x.userId === m.userId ? { ...x, isAvailable: v } : x)))}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} disabled={pending} onClick={() => saveMembers(members.filter((x) => x.userId !== m.userId))}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
