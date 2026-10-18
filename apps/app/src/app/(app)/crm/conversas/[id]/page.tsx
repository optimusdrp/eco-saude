import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCrm } from "@/lib/auth/dal";
import { Inbox } from "../Inbox";
import { inboxParams, type InboxSearchParams } from "../params";

export const metadata: Metadata = { title: "Conversa" };
export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<InboxSearchParams>;
}) {
  const ctx = await requireCrm("conversas.ver");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = inboxParams(await searchParams);
  return <Inbox ctx={ctx} selectedId={id} {...sp} />;
}
