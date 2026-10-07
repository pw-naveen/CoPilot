import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

let transport: nodemailer.Transporter | null = null;

/** Every email is recorded; with no SMTP configured it stays in the dev mailbox (/dev/mail). */
export async function sendEmail(to: string, subject: string, text: string) {
  const [row] = await db.insert(schema.emails).values({ to, subject, text }).returning();
  const url = process.env.EMAIL_SMTP_URL;
  if (!url) {
    if (process.env.NODE_ENV !== "test") console.log(`[email] to=${to} subject=${subject}\n${text}\n`);
    return row;
  }
  try {
    transport ??= nodemailer.createTransport(url);
    await transport.sendMail({ from: process.env.EMAIL_FROM || "no-reply@example.com", to, subject, text });
    await db.update(schema.emails).set({ sent: true }).where(eq(schema.emails.id, row.id));
  } catch (err) {
    await db.update(schema.emails).set({ error: String(err) }).where(eq(schema.emails.id, row.id));
  }
  return row;
}
