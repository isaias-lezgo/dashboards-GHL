// app/page.tsx
// Server shell. Decides between the project picker and the dashboard based on the
// dash_project cookie. The middleware gate has already run, so anyone reaching
// here holds a valid dash_access.
import { cookies } from "next/headers";
import { PROJECT_COOKIE, verifyToken } from "@/lib/auth";
import { getClientById, getClients } from "@/lib/clients";
import { DashboardApp } from "@/components/dashboard/dashboard-app";
import { ProjectPicker } from "@/components/dashboard/project-picker";

export default async function Page() {
  const token = (await cookies()).get(PROJECT_COOKIE)?.value;
  const projectId = await verifyToken(token);
  const selected = projectId ? safeLookup(projectId) : null;

  if (selected) return <DashboardApp />;

  // Only id and name cross into the browser bundle — never ghlToken or locationId.
  const projects = safeRoster().map((c) => ({ id: c.id, name: c.name }));
  return <ProjectPicker projects={projects} />;
}

function safeLookup(id: string) {
  try {
    return getClientById(id);
  } catch (err) {
    console.error("[page] Could not load project roster:", err);
    return null;
  }
}

function safeRoster() {
  try {
    return getClients();
  } catch (err) {
    // A broken roster shows an empty picker rather than a Next.js error overlay.
    console.error("[page] Could not load project roster:", err);
    return [];
  }
}
