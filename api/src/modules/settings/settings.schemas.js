import { z } from 'zod';
import { OPTIONAL_MODULES } from '../../config/modules.js';
import { CHANNELS, EVENT_KEYS } from '../notifications/catalog.js';

const uuid = z.string().uuid();
const optionalUuid = uuid.optional();

export const tenantQuery = z.object({ tenantId: optionalUuid }).strict();
export const branchQuery = z.object({ tenantId: optionalUuid, branchId: optionalUuid }).strict();
export const idParams = z.object({ id: uuid }).strict();
export const channelParams = z.object({ channel: z.enum(['whatsapp', 'sms', 'email']) }).strict();
export const sectionParams = z.object({ section: z.enum(['attendance', 'calendar', 'messaging']) }).strict();
export const eventParams = z.object({ event: z.enum(EVENT_KEYS) }).strict();
export const templateParams = z.object({ event: z.enum(EVENT_KEYS), channel: z.enum(CHANNELS) }).strict();

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const limit = (max = 100, def = 50) => z.coerce.number().int().min(1).max(max).default(def);

export const modulesBody = z
  .object({
    tenantId: optionalUuid,
    disabled: z.array(z.enum(OPTIONAL_MODULES)).max(OPTIONAL_MODULES.length),
    version: z.number().int().min(0),
  })
  .strict();

export const sectionBody = z
  .object({
    tenantId: optionalUuid,
    branchId: uuid.nullable().optional(),
    value: z.record(z.unknown()),
    version: z.number().int().min(0),
  })
  .strict();

export const channelBody = z
  .object({
    tenantId: optionalUuid,
    branchId: uuid.nullable().optional(),
    provider: z.string().min(2).max(30),
    config: z.record(z.unknown()).default({}),
    secrets: z.record(z.string().max(2000)).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const channelTargetBody = z.object({ tenantId: optionalUuid, branchId: uuid.nullable().optional() }).strict();

export const testBody = z
  .object({
    tenantId: optionalUuid,
    branchId: uuid.nullable().optional(),
    to: z.string().trim().min(5).max(150),
  })
  .strict();

export const templateBody = z
  .object({
    tenantId: optionalUuid,
    name: z.string().trim().max(512).optional().nullable(),
    subject: z.string().trim().max(200).optional().nullable(),
    body: z.string().min(1).max(4000),
    params: z.array(z.string().regex(/^[a-z_]+$/)).max(20).optional(),
    language: z.enum(['en', 'hi', 'en_US', 'en_GB']).optional(),
    approvalStatus: z.enum(['approved', 'pending', 'rejected', 'paused']).optional(),
  })
  .strict();

export const previewBody = z
  .object({
    eventType: z.enum(EVENT_KEYS),
    channel: z.enum(CHANNELS),
    body: z.string().max(4000),
    subject: z.string().max(200).optional().nullable(),
    params: z.array(z.string().regex(/^[a-z_]+$/)).max(20).optional(),
    name: z.string().max(512).optional().nullable(),
  })
  .strict();

export const auditQuery = z
  .object({
    tenantId: optionalUuid,
    area: z.enum(['modules', 'communication', 'templates', 'rules', 'attendance', 'calendar', 'messaging', 'devices', 'subscription']).optional(),
    page,
    limit: limit(100, 50),
  })
  .strict();

export const deviceBody = z
  .object({
    tenantId: optionalUuid,
    branchId: optionalUuid,
    name: z.string().trim().min(2).max(100),
    kind: z.enum(['rfid', 'biometric', 'face', 'qr', 'gate_app']),
    protocol: z.enum(['http', 'adms']).default('http'),
    serialNumber: z.string().trim().regex(/^[A-Za-z0-9_-]{3,64}$/, 'Serial number as shown on the device (letters and digits)').optional(),
    location: z.string().trim().max(100).optional().nullable(),
    appliesTo: z.enum(['students', 'staff', 'both']).default('both'),
  })
  .strict()
  .refine((d) => d.protocol !== 'adms' || d.serialNumber, { message: 'Required for ADMS devices', path: ['serialNumber'] });

export const deviceUpdateBody = z
  .object({
    tenantId: optionalUuid,
    name: z.string().trim().min(2).max(100).optional(),
    location: z.string().trim().max(100).nullable().optional(),
    appliesTo: z.enum(['students', 'staff', 'both']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();

export const punchesQuery = z
  .object({
    tenantId: optionalUuid,
    branchId: optionalUuid,
    deviceId: optionalUuid,
    result: z.string().max(30).optional(),
    page,
    limit: limit(200, 50),
  })
  .strict();

export const identifiersQuery = z
  .object({ tenantId: optionalUuid, branchId: optionalUuid, search: z.string().trim().max(60).optional(), page, limit: limit(200, 50) })
  .strict();

export const identifiersBody = z
  .object({
    tenantId: optionalUuid,
    branchId: optionalUuid,
    kind: z.enum(['rfid', 'biometric', 'face', 'qr']),
    rows: z
      .array(z.object({ number: z.string().trim().min(1).max(30), value: z.string().trim().min(1).max(64) }).strict())
      .min(1)
      .max(2000),
  })
  .strict();
