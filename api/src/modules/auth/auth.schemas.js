import { z } from 'zod';

export const loginSchema = z
  .object({
    // Omit for platform-level super admins; required for everyone inside a school.
    tenantCode: z.string().trim().toLowerCase().min(2).max(63).optional(),
    identifier: z.string().trim().min(3).max(254),          // email or username
    password: z.string().min(1).max(128),                    // bcrypt only reads 72 bytes
    client: z.enum(['web', 'mobile']).default('web'),
  })
  .strict();

export const refreshSchema = z
  .object({
    // Mobile clients send it in the body; browsers send the httpOnly cookie instead.
    refreshToken: z.string().min(20).max(200).optional(),
    client: z.enum(['web', 'mobile']).default('web'),
  })
  .strict();

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(20).max(200).optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),   // the temporary password, on first sign-in
    newPassword: z.string().min(1).max(128),       // rules in login-id.js passwordProblems (422 WEAK_PASSWORD)
    client: z.enum(['web', 'mobile']).default('web'),
  })
  .strict();
