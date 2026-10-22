import { PageHeader } from "@/components/console/console-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAgent } from "@/server/session";
import { db } from "@/server/db";

export default async function AgentHome() {
  const actor = await requireAgent();
  const [users, teams] = await Promise.all([db.user.count({ where: { isActive: true } }), db.team.count({ where: { isActive: true } })]);
  return (
    <>
      <PageHeader title={`Welcome, ${actor.name.split(" ")[0]}`} description="Your work at a glance." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Active users</CardDescription>
            <CardTitle className="text-3xl">{users}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Teams</CardDescription>
            <CardTitle className="text-3xl">{teams}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card className="mt-6">
        <CardContent className="text-sm text-muted-foreground">Ticket queues arrive in the next phase.</CardContent>
      </Card>
    </>
  );
}
