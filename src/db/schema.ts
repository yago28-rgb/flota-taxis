/**
 * Esquema relacional (PostgreSQL) — Flota.
 *
 * Principios:
 * - Los importes se guardan en céntimos (bigint) para evitar errores de coma flotante.
 * - Nada se sobrescribe en silencio: cada mutación genera un registro en `audit_events`
 *   con el estado anterior y el nuevo.
 * - Las asignaciones (conductor ↔ licencia, vehículo ↔ licencia) son históricas:
 *   se cierran con `ended_on`, nunca se borran.
 * - El documento original se conserva siempre (`documents`) y se vincula a la factura.
 * - La salida bruta de la IA se guarda inmutable en `extraction_runs`; la factura guarda
 *   los valores revisados por la persona.
 * - Las categorías y su naturaleza (ingreso / gasto / neutro) las define el usuario:
 *   el sistema no presupone cómo se calcula nada.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  date,
  timestamp,
  jsonb,
  numeric,
  uniqueIndex,
  index,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const cents = (name: string) => bigint(name, { mode: "number" });

/* ───────────────────────────── Usuarios ───────────────────────────── */

export const userRole = pgEnum("user_role", ["admin", "editor", "viewer"]);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("viewer"),
    active: boolean("active").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

/* ──────────────────────── Licencias y vehículos ─────────────────────── */

export const assetStatus = pgEnum("asset_status", ["active", "inactive", "suspended", "retired"]);

export const licenses = pgTable(
  "licenses",
  {
    id: id(),
    number: text("number").notNull(),
    status: assetStatus("status").notNull().default("active"),
    acquiredOn: date("acquired_on"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("licenses_number_uq").on(sql`upper(${t.number})`)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    plate: text("plate").notNull(), // normalizada: mayúsculas, sin espacios ni guiones
    make: text("make"),
    model: text("model"),
    status: assetStatus("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("vehicles_plate_uq").on(t.plate)],
);

/** Qué vehículo ha estado adscrito a cada licencia y cuándo. */
export const licenseVehicles = pgTable(
  "license_vehicles",
  {
    id: id(),
    licenseId: uuid("license_id").notNull().references(() => licenses.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "restrict" }),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("license_vehicles_license_idx").on(t.licenseId),
    index("license_vehicles_vehicle_idx").on(t.vehicleId),
    check("license_vehicles_dates_chk", sql`${t.endedOn} IS NULL OR ${t.endedOn} >= ${t.startedOn}`),
    // Una licencia no puede tener dos vehículos abiertos a la vez; un vehículo tampoco dos licencias.
    uniqueIndex("license_vehicles_open_license_uq").on(t.licenseId).where(sql`${t.endedOn} IS NULL`),
    uniqueIndex("license_vehicles_open_vehicle_uq").on(t.vehicleId).where(sql`${t.endedOn} IS NULL`),
  ],
);

/* ───────────────────────────── Conductores ──────────────────────────── */

export const drivers = pgTable(
  "drivers",
  {
    id: id(),
    code: text("code").notNull(), // identificador interno
    fullName: text("full_name").notNull(),
    phone: text("phone"), // opcional (minimización de datos, RGPD)
    status: assetStatus("status").notNull().default("active"),
    startedOn: date("started_on"),
    endedOn: date("ended_on"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("drivers_code_uq").on(sql`upper(${t.code})`),
    check("drivers_dates_chk", sql`${t.endedOn} IS NULL OR ${t.startedOn} IS NULL OR ${t.endedOn} >= ${t.startedOn}`),
  ],
);

/**
 * Asignación conductor ↔ licencia. No se presupone exclusividad: una licencia puede tener
 * varios conductores a la vez (p. ej. turnos) y el historial se conserva al cambiar.
 */
export const driverAssignments = pgTable(
  "driver_assignments",
  {
    id: id(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id, { onDelete: "restrict" }),
    licenseId: uuid("license_id").notNull().references(() => licenses.id, { onDelete: "restrict" }),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
    role: text("role"), // texto libre (p. ej. "turno de mañana"), definido por el usuario
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("driver_assignments_driver_idx").on(t.driverId),
    index("driver_assignments_license_idx").on(t.licenseId),
    check("driver_assignments_dates_chk", sql`${t.endedOn} IS NULL OR ${t.endedOn} >= ${t.startedOn}`),
    uniqueIndex("driver_assignments_open_uq").on(t.driverId, t.licenseId).where(sql`${t.endedOn} IS NULL`),
  ],
);

/* ───────────────────────── Categorías y terceros ─────────────────────── */

/**
 * Naturaleza económica, definida por el usuario para cada categoría:
 * - income: computa como ingreso
 * - expense: computa como gasto
 * - neutral: se registra pero no computa en el resultado (p. ej. traspasos, fianzas…)
 */
export const categoryKind = pgEnum("category_kind", ["income", "expense", "neutral"]);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    description: text("description"),
    /** Palabras clave para sugerir esta categoría al revisar líneas extraídas. */
    keywords: text("keywords").array().notNull().default(sql`ARRAY[]::text[]`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("categories_name_uq").on(sql`lower(${t.name})`)],
);

/** Emisores / receptores de facturas. */
export const counterparties = pgTable(
  "counterparties",
  {
    id: id(),
    name: text("name").notNull(),
    taxId: text("tax_id"), // NIF/CIF normalizado
    defaultCategoryId: uuid("default_category_id").references(() => categories.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("counterparties_tax_id_uq").on(t.taxId).where(sql`${t.taxId} IS NOT NULL`),
    index("counterparties_name_idx").on(sql`lower(${t.name})`),
  ],
);

/* ──────────────────────── Documentos y facturas ─────────────────────── */

export const documents = pgTable(
  "documents",
  {
    id: id(),
    sha256: text("sha256").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    storageKey: text("storage_key").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("documents_sha256_uq").on(t.sha256)],
);

export const invoiceStatus = pgEnum("invoice_status", [
  "uploaded", // documento guardado, sin procesar
  "processing", // reconocimiento en curso
  "needs_review", // datos extraídos pendientes de revisión
  "failed", // el reconocimiento falló o no hay proveedor configurado
  "confirmed", // revisada e importada
  "rejected", // descartada por el usuario (se conserva)
]);

/** received = factura recibida (de un proveedor); issued = emitida por el titular. */
export const invoiceDirection = pgEnum("invoice_direction", ["received", "issued", "unknown"]);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "restrict" }),
    status: invoiceStatus("status").notNull().default("uploaded"),
    direction: invoiceDirection("direction").notNull().default("unknown"),
    documentType: text("document_type"), // tal como aparece: factura, ticket, abono, liquidación…
    counterpartyId: uuid("counterparty_id").references(() => counterparties.id, { onDelete: "set null" }),
    counterpartyName: text("counterparty_name"),
    counterpartyTaxId: text("counterparty_tax_id"),
    invoiceNumber: text("invoice_number"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    currency: text("currency").notNull().default("EUR"),
    subtotalCents: cents("subtotal_cents"),
    taxCents: cents("tax_cents"),
    withholdingCents: cents("withholding_cents"),
    totalCents: cents("total_cents"),
    licenseId: uuid("license_id").references(() => licenses.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    /** Confianza por campo (0–1) tal como la devolvió la extracción. */
    fieldConfidence: jsonb("field_confidence").$type<Record<string, number>>(),
    /** Resultado de las validaciones automáticas. */
    issues: jsonb("issues").$type<ValidationIssue[]>().notNull().default(sql`'[]'::jsonb`),
    possibleDuplicateOf: uuid("possible_duplicate_of"),
    notes: text("notes"),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invoices_status_idx").on(t.status),
    index("invoices_issue_date_idx").on(t.issueDate),
    index("invoices_document_idx").on(t.documentId),
    index("invoices_number_idx").on(t.invoiceNumber),
  ],
);

export type ValidationIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  field?: string;
  message: string;
};

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description"),
    quantity: numeric("quantity", { precision: 14, scale: 4 }),
    unitPriceCents: cents("unit_price_cents"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 3 }),
    taxCents: cents("tax_cents"),
    amountCents: cents("amount_cents"),
    serviceDate: date("service_date"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    licenseId: uuid("license_id").references(() => licenses.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    detectedPlate: text("detected_plate"),
    detectedLicense: text("detected_license"),
    detectedDriver: text("detected_driver"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId)],
);

export const extractionStatus = pgEnum("extraction_status", ["running", "succeeded", "failed"]);

/** Cada ejecución del reconocimiento. Inmutable: es la evidencia de lo que leyó la IA. */
export const extractionRuns = pgTable(
  "extraction_runs",
  {
    id: id(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model"),
    status: extractionStatus("status").notNull().default("running"),
    output: jsonb("output"),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("extraction_runs_invoice_idx").on(t.invoiceId)],
);

/* ───────────────────────── Movimientos económicos ────────────────────── */

export const movementSource = pgEnum("movement_source", ["manual", "invoice"]);

/**
 * Apunte económico. Su naturaleza (ingreso/gasto/neutro) proviene de la categoría.
 * `amount_cents` es positivo en operaciones normales y negativo en abonos/rectificaciones;
 * si suma o resta en el resultado lo decide la naturaleza de la categoría.
 * Los movimientos no se borran: se anulan (`voided_at`) dejando constancia.
 */
export const movements = pgTable(
  "movements",
  {
    id: id(),
    occurredOn: date("occurred_on").notNull(),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
    amountCents: cents("amount_cents").notNull(),
    description: text("description"),
    licenseId: uuid("license_id").references(() => licenses.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    counterpartyId: uuid("counterparty_id").references(() => counterparties.id, { onDelete: "set null" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "restrict" }),
    invoiceLineId: uuid("invoice_line_id").references(() => invoiceLines.id, { onDelete: "set null" }),
    source: movementSource("source").notNull().default("manual"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("movements_date_idx").on(t.occurredOn),
    index("movements_category_idx").on(t.categoryId),
    index("movements_license_idx").on(t.licenseId),
    index("movements_driver_idx").on(t.driverId),
    index("movements_invoice_idx").on(t.invoiceId),
  ],
);

/** Cierre de periodos: un mes cerrado no admite cambios en sus movimientos. */
export const periodLocks = pgTable(
  "period_locks",
  {
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    primaryKey({ columns: [t.year, t.month] }),
    check("period_locks_month_chk", sql`${t.month} BETWEEN 1 AND 12`),
  ],
);

/* ─────────────────────────── Exportación Excel ───────────────────────── */

export type ExportColumn = {
  header: string;
  field: string; // clave de campo disponible (ver lib/export/fields.ts)
  width?: number;
};

export const exportTemplates = pgTable("export_templates", {
  id: id(),
  name: text("name").notNull(),
  dataset: text("dataset").notNull(), // movements | invoices | invoice_lines | drivers | licenses
  columns: jsonb("columns").$type<ExportColumn[]>().notNull(),
  sheetName: text("sheet_name"),
  includeTotals: boolean("include_totals").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────────────────────── Configuración ─────────────────────────── */

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

/* ───────────────────────────── Trazabilidad ─────────────────────────── */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    before: jsonb("before"),
    after: jsonb("after"),
    summary: text("summary"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entity, t.entityId),
    index("audit_created_idx").on(t.createdAt),
  ],
);
