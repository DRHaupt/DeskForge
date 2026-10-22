import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold text-muted-foreground">403</p>
      <h1 className="text-2xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-muted-foreground">Ask an administrator if you think you should.</p>
      <Button asChild variant="outline">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
