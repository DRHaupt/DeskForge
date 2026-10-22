import { notFound, redirect } from "next/navigation";
import { requireAgent } from "@/server/session";
import { listBoards } from "@/server/services/boards";

export default async function BoardsIndex() {
  const actor = await requireAgent("/agent/boards");
  const boards = listBoards(actor);
  if (!boards.length) notFound();
  redirect(`/agent/boards/${boards[0]!.key}`);
}
