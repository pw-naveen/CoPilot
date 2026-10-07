import { userActor } from "@/server/page-auth";
import { thread } from "@/server/services/whatsapp";
import { Card, PageHeader } from "@/components/ui";
import { Thread } from "@/components/thread";
import { Refresh } from "@/components/refresh";

export const dynamic = "force-dynamic";

export default async function WhatsAppHistory() {
  const actor = await userActor();
  const messages = await thread(actor, actor.id);
  return (
    <>
      <PageHeader eyebrow="WhatsApp" lead="Your conversation" accent="with the assistant." intro="Everything you've sent and received. Reply on WhatsApp; this page is a record." />
      <Card className="max-w-3xl bg-blush-50/40">
        <Thread messages={messages} />
      </Card>
      <Refresh every={5000} />
    </>
  );
}
