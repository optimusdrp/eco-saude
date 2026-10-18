import type { Metadata } from "next";
import { requireCrm } from "@/lib/auth/dal";
import { Inbox } from "./Inbox";
import { inboxParams, type InboxSearchParams } from "./params";

export const metadata: Metadata = { title: "Conversas" };
export const dynamic = "force-dynamic";

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const ctx = await requireCrm("conversas.ver");
  return <Inbox ctx={ctx} {...inboxParams(await searchParams)} />;
}
