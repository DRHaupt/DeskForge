import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/console/console-shell";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { getTeam, listTeams } from "@/server/services/admin";
import { TeamEditor } from "./team-editor";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePagePermission("team.manage", `/admin/teams/${id}`);
  const [team, teams, agents] = await Promise.all([
    getTeam(actor, id),
    listTeams(actor),
    db.user.findMany({
      where: { isActive: true, roles: { some: { role: { OR: [{ permissions: { has: "ticket.view_team" } }, { permissions: { has: "*" } }] } } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/teams" className="text-muted-foreground hover:underline">
          ← Teams
        </Link>
      </p>
      <PageHeader title={team.name} description={`Key: ${team.key}`} />
      <TeamEditor
        team={{
          id: team.id,
          name: team.name,
          description: team.description,
          email: team.email,
          assignmentStrategy: team.assignmentStrategy,
          escalationTeamId: team.escalationTeamId,
          escalationUserId: team.escalationUserId,
          isActive: team.isActive,
          members: team.members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, isLead: m.isLead, isAvailable: m.isAvailable })),
        }}
        teams={teams.filter((t) => t.id !== id).map((t) => ({ id: t.id, name: t.name }))}
        agents={agents}
      />
    </>
  );
}
