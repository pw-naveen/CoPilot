import { DateTime } from "luxon";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const linkify = (t: string) =>
  t.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="link break-all">
        {part}
      </a>
    ) : (
      part
    ),
  );

export default async function DevMail() {
  const mails = await db.query.emails.findMany({ orderBy: desc(schema.emails.createdAt), limit: 50 });
  return (
    <>
      <PageHeader eyebrow="Dev mailbox" lead="Every email," accent="caught here." />
      {mails.length === 0 ? (
        <Card><EmptyState icon="envelope-simple" title="No emails yet" /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {mails.map((m) => (
            <Card key={m.id}>
              <div className="mb-3 flex flex-wrap justify-between gap-2 text-[13px] text-muted">
                <span>
                  To <strong className="text-ink">{m.to}</strong>
                </span>
                <span>{DateTime.fromJSDate(m.createdAt).toFormat("d LLL HH:mm:ss")}</span>
              </div>
              <p className="mb-2 font-semibold text-ink">{m.subject}</p>
              <pre className="font-sans text-[14px] whitespace-pre-wrap text-ink-soft">{linkify(m.text)}</pre>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
