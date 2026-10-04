import { z } from 'zod';
import { hhmm, limit, optionalText, page, text, uuid } from '../shared/schemas.js';

export const listQuery = z.object({ branchId: uuid.optional() }).strict();

/** Riders filters (student's current class / section). */
const riderFilters = {
  stopId: uuid.optional(),
  classId: uuid.optional(),
  sectionId: uuid.optional(),
  search: z.string().trim().min(1).max(100).optional(),   // student name, admission no., parent phone
};
export const routeStudentsQuery = z.object(riderFilters).strict();
export const ridersQuery = z
  .object({ ...riderFilters, routeId: uuid.optional(), branchId: uuid.optional(), page, limit: limit(50, 200) })
  .strict();

const stop = z.object({ name: text(2, 100), pickupTime: hhmm, dropTime: hhmm }).strict();
const stops = z
  .array(stop)
  .min(1)
  .max(40)
  .superRefine((list, ctx) => {
    const seen = new Set();
    list.forEach((s, i) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'name'], message: 'Stop listed twice' });
      seen.add(key);
    });
  });

const routeFields = {
  name: text(2, 100),
  vehicleNumber: text(4, 20),
  driverName: text(2, 100),
  driverPhone: text(10, 20),
  attendantName: optionalText(100),
  capacity: z.number().int().min(1).max(200).nullable().optional(),
};

export const createRouteBody = z.object({ ...routeFields, stops, branchId: uuid.optional() }).strict();

export const updateRouteBody = z
  .object({
    name: routeFields.name.optional(),
    vehicleNumber: routeFields.vehicleNumber.optional(),
    driverName: routeFields.driverName.optional(),
    driverPhone: routeFields.driverPhone.optional(),
    attendantName: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(100).nullable()).optional(),
    capacity: routeFields.capacity,
    status: z.enum(['active', 'inactive']).optional(),
    stops: stops.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

export const assignmentBody = z
  .object({ studentId: uuid, routeId: uuid.nullable(), stopId: uuid.optional() })
  .strict();
