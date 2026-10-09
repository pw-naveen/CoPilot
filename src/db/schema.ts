import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const staffRole = pgEnum("staff_role", ["admin", "subadmin"]);
export const userStatus = pgEnum("user_status", ["pending", "rejected", "invited", "onboarding", "active", "paused"]);
export const personaStatus = pgEnum("persona_status", ["draft", "active", "retired"]);
export const postStatus = pgEnum("post_status", [
  "awaiting_input",
  "drafting",
  "pending_approval",
  "changes_requested",
  "approved",
  "missed",
  "skipped",
]);
export const actorType = pgEnum("actor_type", ["staff", "user", "system"]);
export const waDirection = pgEnum("wa_direction", ["in", "out"]);
export const waStatus = pgEnum("wa_status", ["received", "queued", "sent", "failed", "emailed"]);
export const intent = pgEnum("intent", [
  "new_idea",
  "feedback",
  "approval",
  "persona_preference",
  "question",
  "other",
]);

// ── People ────────────────────────────────────────────────────────────────

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: staffRole("role").notNull(),
  passwordHash: text("password_hash"),
  totpSecret: text("totp_secret"), // encrypted; null = 2FA off
  totpPending: text("totp_pending"), // encrypted secret awaiting confirmation
  canInvite: boolean("can_invite").notNull().default(false), // sub-admins only
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  title: text("title"),
  org: text("org"),
  specialty: text("specialty"),
  linkedinUrl: text("linkedin_url"),
  photoUrl: text("photo_url"),
  phoneE164: text("phone_e164").notNull().unique(),
  timezone: text("timezone").notNull().default("Asia/Kuala_Lumpur"),
  languages: text("languages").array().notNull().default(["en"]),
  status: userStatus("status").notNull().default("invited"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  staffApprovalIsFinal: boolean("staff_approval_is_final").notNull().default(false),
  whatsappVerifiedAt: timestamp("whatsapp_verified_at", { withTimezone: true }),
  whatsappVerifyCode: text("whatsapp_verify_code"),
  invitedBy: uuid("invited_by"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  ...timestamps,
});

export const subadminAccounts = pgTable(
  "subadmin_accounts",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.staffId, t.userId] })],
);

// ── Auth ──────────────────────────────────────────────────────────────────

export const loginTokens = pgTable(
  "login_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(), // magic link
    otpHash: text("otp_hash").notNull(), // 6-digit code
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("login_tokens_actor_idx").on(t.actorType, t.actorId)],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie value
  actorType: actorType("actor_type").notNull(),
  actorId: uuid("actor_id").notNull(),
  needsTotp: boolean("needs_totp").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

// ── Onboarding & persona ──────────────────────────────────────────────────

export const onboardingAnswers = pgTable(
  "onboarding_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    text: text("text"),
    audioUrl: text("audio_url"), // storage key
    transcript: text("transcript"),
    ...timestamps,
  },
  (t) => [uniqueIndex("onboarding_answers_user_q").on(t.userId, t.questionKey)],
);

export const writingSamples = pgTable("writing_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // "paste" | file name
  text: text("text").notNull(),
  ...timestamps,
});

export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    json: jsonb("json").notNull(),
    status: personaStatus("status").notNull().default("draft"),
    createdBy: text("created_by").notNull(), // "user:<id>" | "staff:<id>" | "system:<reason>"
    changeNote: text("change_note"),
    ...timestamps,
  },
  (t) => [uniqueIndex("personas_user_version").on(t.userId, t.version)],
);

// Tone-check samples shown during onboarding step 5.
export const toneSamples = pgTable("tone_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // professional_insight | personal_reflection | event_milestone
  prompt: text("prompt").notNull(),
  text: text("text").notNull(),
  personaVersion: integer("persona_version").notNull(),
  verdict: text("verdict"), // sounds_like_me | close | not_me
  comment: text("comment"),
  rounds: integer("rounds").notNull().default(0),
  ...timestamps,
});

// Before/after pairs from edits and change requests; feed the persona refresh.
export const editPairs = pgTable("edit_pairs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id"),
  kind: text("kind").notNull(), // inline_edit | change_request
  before: text("before").notNull(),
  after: text("after"),
  feedback: text("feedback"),
  consumedInVersion: integer("consumed_in_version"),
  ...timestamps,
});

export const goldenCandidates = pgTable("golden_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id"),
  input: text("input").notNull(),
  post: text("post").notNull(),
  ...timestamps,
});

// ── Cadence & slots ───────────────────────────────────────────────────────

export const cadences = pgTable("cadences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  postsPerWeek: integer("posts_per_week").notNull(),
  weekdays: integer("weekdays").array().notNull(), // ISO 1=Mon … 7=Sun
  times: text("times").array().notNull(), // "HH:mm", one per weekday, same order
  monthlyCap: integer("monthly_cap").notNull().default(20),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

export const slots = pgTable(
  "slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    approvalDeadline: timestamp("approval_deadline", { withTimezone: true }).notNull(),
    status: postStatus("status").notNull().default("awaiting_input"),
    postId: uuid("post_id"),
    isExtra: boolean("is_extra").notNull().default(false),
    // scheduler bookkeeping — each step fires once
    topicPromptSentAt: timestamp("topic_prompt_sent_at", { withTimezone: true }),
    autoDraftAt: timestamp("auto_draft_at", { withTimezone: true }),
    reminder1At: timestamp("reminder1_at", { withTimezone: true }),
    reminder2At: timestamp("reminder2_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("slots_user_publish").on(t.userId, t.publishAt),
    index("slots_status_deadline").on(t.status, t.approvalDeadline),
  ],
);

// ── WhatsApp ──────────────────────────────────────────────────────────────

export const inputBundles = pgTable(
  "input_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    intent: intent("intent"),
    extractedJson: jsonb("extracted_json"),
    slotId: uuid("slot_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  // At most one open bundle per user, even when messages arrive at the same instant.
  (t) => [uniqueIndex("input_bundles_one_open").on(t.userId).where(sql`closed_at is null`)],
);

export const waMessages = pgTable(
  "wa_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }), // null = unknown sender
    phoneE164: text("phone_e164").notNull(),
    direction: waDirection("direction").notNull(),
    status: waStatus("status").notNull(),
    waMessageId: text("wa_message_id"),
    type: text("type").notNull(), // text | audio | image | document | link
    body: text("body"),
    mediaUrl: text("media_url"), // storage key
    transcript: text("transcript"),
    bundleId: uuid("bundle_id"),
    rawJson: jsonb("raw_json"),
    // outbound queue
    kind: text("kind"), // reply | draft | reminder | welcome | verify | system
    sendAfter: timestamp("send_after", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    emailFallback: jsonb("email_fallback"), // {subject, text} for drafts and reminders
    ...timestamps,
  },
  (t) => [
    index("wa_messages_user_created").on(t.userId, t.createdAt),
    uniqueIndex("wa_messages_wa_id").on(t.waMessageId),
    index("wa_messages_outbox").on(t.direction, t.status, t.sendAfter),
  ],
);

// ── Posts ─────────────────────────────────────────────────────────────────

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slotId: uuid("slot_id"),
    bundleId: uuid("bundle_id"),
    status: postStatus("status").notNull().default("drafting"),
    currentVersionId: uuid("current_version_id"),
    suggestedTopic: boolean("suggested_topic").notNull().default(false),
    topic: text("topic"),
    summary: text("summary"),
    firstComment: text("first_comment"),
    reviewIssues: jsonb("review_issues"), // string[] from the last failed review
    flaggedForStaff: boolean("flagged_for_staff").notNull().default(false),
    staffApprovedBy: uuid("staff_approved_by"),
    staffApprovedAt: timestamp("staff_approved_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"), // "user:<id>" | "staff:<id>"
    publishAt: timestamp("publish_at", { withTimezone: true }), // ready for PublisherAdapter
    publishStatus: text("publish_status"), // null | logged | published | failed
    ...timestamps,
  },
  (t) => [index("posts_user_status").on(t.userId, t.status)],
);

export const postVersions = pgTable("post_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  text: text("text").notNull(),
  media: uuid("media").array().notNull().default([]), // media ids, max 4
  personaVersion: integer("persona_version"),
  promptVersion: text("prompt_version"),
  model: text("model"),
  createdBy: text("created_by").notNull(), // "ai" | "user:<id>" | "staff:<id>"
  feedback: text("feedback"),
  ...timestamps,
});

export const previewTokens = pgTable("preview_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  visionDescription: text("vision_description"),
  consentFlag: boolean("consent_flag").notNull().default(false), // patient consent recorded
  ...timestamps,
});

// ── Ops ───────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    userId: uuid("user_id"), // the account this concerns, for scoping
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ...timestamps,
  },
  (t) => [index("audit_user_created").on(t.userId, t.createdAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // encrypted when the key is secret
  encrypted: boolean("encrypted").notNull().default(false),
  ...timestamps,
});

export const aiGenerations = pgTable("ai_generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  kind: text("kind").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  ok: boolean("ok").notNull(),
  error: text("error"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: doublePrecision("latency_ms"),
  ...timestamps,
});

export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  text: text("text").notNull(),
  sent: boolean("sent").notNull().default(false),
  error: text("error"),
  ...timestamps,
});

// Async work requested by the web app and run by the worker; the browser polls it.
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  input: jsonb("input"),
  result: jsonb("result"),
  error: text("error"), // safe to show anyone
  errorDetail: text("error_detail"), // real message and stack; only served when DEV_TOOLS is on
  attempts: integer("attempts").notNull().default(0),
  ...timestamps,
});
