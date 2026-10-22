import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/server/session";
import { listTeams } from "@/server/services/admin";
import { NewTeamDialog } from "./new-team-dialog";

export const metadata: Metadata = { title: "Teams" };

const STRATEGY: Record<string, string> = { ROUND_ROBIN: "Round-robin", LOAD_BALANCED: "Load-balanced", MANUAL: "Manual" };

export default async function TeamsPage() {
  const actor = await requirePagePermission("team.manage", "/admin/teams");
  const teams = await listTeams(actor);
  return (
    <>
      <PageHeader title="Teams" description="Teams are the queues tickets are routed to." actions={<NewTeamDialog />} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Assignment</TableHead>
              <TableHead>Members</TableHead>
              <TableHead className="hidden md:table-cell">Escalates to</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((t) => (
              <TableRow key={t.id} className={t.isActive ? "" : "opacity-60"}>
                <TableCell>
                  <Link href={`/admin/teams/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>{" "}
                  {!t.isActive && <Badge variant="outline">Inactive</Badge>}
                  <div className="text-xs text-muted-foreground">{t.email ?? t.key}</div>
                </TableCell>
                <TableCell className="text-sm">{STRATEGY[t.assignmentStrategy]}</TableCell>
                <TableCell className="text-sm">{t._count.members}</TableCell>
                <TableCell className="hidden md:table-cell text-sm">{t.escalationTeam?.name ?? t.escalationUser?.name ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
