import { env } from '../../config/env.js';
import { NS, invalidate } from '../../cache/cache.js';
import { sendImage } from './upload.js';
import * as service from './setup.service.js';
import * as account from './account.service.js';

// Class / section / year names appear in the fee ledger and attendance screens (cached per tenant).
async function bust(req) {
  if (req.auth.tenantId) await Promise.all([invalidate(NS.FEES, req.auth.tenantId), invalidate(NS.ATTENDANCE, req.auth.tenantId)]);
}

const q = (req) => req.valid.query ?? {};
const id = (req) => req.valid.params.id;

const write = (fn, status = 200) => async (req, res) => {
  const result = await fn(req);
  await bust(req);
  if (result === undefined) return res.status(204).end();
  return res.status(status).json({ data: result });
};

// ---------------------------------------------------------------- years + terms
export const listYears = async (req, res) => res.json(await service.listYears(req.auth, q(req)));
export const createYear = write((req) => service.createYear(req.auth, q(req), req.valid.body), 201);
export const updateYear = write((req) => service.updateYear(req.auth, id(req), req.valid.body));
export const makeCurrentYear = write((req) => service.makeCurrentYear(req.auth, id(req)));
export const deleteYear = write((req) => service.deleteYear(req.auth, id(req)));
export const createTerm = write((req) => service.createTerm(req.auth, req.valid.body), 201);
export const updateTerm = write((req) => service.updateTerm(req.auth, id(req), req.valid.body));
export const deleteTerm = write((req) => service.deleteTerm(req.auth, id(req)));

// ---------------------------------------------------------------- classes + sections
export const listClasses = async (req, res) => res.json(await service.listClasses(req.auth, q(req)));
export const createClass = write((req) => service.createClass(req.auth, q(req), req.valid.body), 201);
export const updateClass = write((req) => service.updateClass(req.auth, id(req), req.valid.body));
export const deleteClass = write((req) => service.deleteClass(req.auth, id(req)));
export const createSection = write((req) => service.createSection(req.auth, req.valid.body), 201);
export const updateSection = write((req) => service.updateSection(req.auth, id(req), req.valid.body));
export const deleteSection = write((req) => service.deleteSection(req.auth, id(req)));

// ---------------------------------------------------------------- subjects
export const listSubjects = async (req, res) => res.json(await service.listSubjects(req.auth, q(req)));
export const createSubject = write((req) => service.createSubject(req.auth, q(req), req.valid.body), 201);
export const updateSubject = write((req) => service.updateSubject(req.auth, id(req), req.valid.body));
export const deleteSubject = write((req) => service.deleteSubject(req.auth, id(req)));

// ---------------------------------------------------------------- school profile
export const getSchool = async (req, res) => res.json({ data: await service.getSchoolProfile(req.auth, q(req)) });
export const putSchool = write((req) => service.updateSchoolProfile(req.auth, q(req), req.valid.body));
export const putLogo = async (req, res) => res.json({ data: await service.putLogo(req.auth, q(req), req.file) });
export const getLogo = async (req, res) => sendImage(req, res, await service.getLogo(req.auth, q(req)));
export const deleteLogo = async (req, res) => {
  await service.deleteLogo(req.auth, q(req));
  res.status(204).end();
};

// ---------------------------------------------------------------- my account
export const getMe = async (req, res) => res.json({ data: await account.getMe(req.auth) });
export const updateMe = async (req, res) => res.json({ data: await account.updateMe(req.auth, req.valid.body) });

// Same cookie as /auth/login (httpOnly, only sent to the auth endpoints).
const REFRESH_COOKIE = 'sm_rt';
const refreshCookieOptions = { httpOnly: true, secure: env.isProduction, sameSite: 'strict', path: '/api/v1/auth' };

export async function changePassword(req, res) {
  const { client, ...body } = req.valid.body;
  const { tokens, endedSessions } = await account.changePassword(req.auth, body, { ip: req.ip, userAgent: req.get('user-agent') ?? null });
  const { refreshToken, refreshExpiresIn, ...session } = tokens;
  res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: refreshExpiresIn * 1000 });
  res.set('Cache-Control', 'no-store').json({
    data: { ...session, ...(client === 'mobile' && { refreshToken, refreshExpiresIn }), endedSessions },
  });
}
