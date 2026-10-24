import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MigrationPage } from "@/components/casebook/migration-page";
import { Casebook } from "@/components/casebook/shell";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [migration, setMigration] = useState<{ mode: "source" | "restore"; port: number } | null>(
    null,
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("migration");
    const port = Number(params.get("port"));
    if (
      (mode === "source" || mode === "restore") &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535
    ) {
      setMigration({ mode, port });
    }
  }, []);
  if (migration) return <MigrationPage mode={migration.mode} port={migration.port} />;
  return <Casebook />;
}
