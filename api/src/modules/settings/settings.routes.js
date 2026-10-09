import { Router } from 'express';
import { ALL_ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import * as comm from './communication.service.js';
import * as devices from './devices.service.js';
import * as rules from './rules.service.js';
import * as s from './settings.schemas.js';
import * as settings from './settings.service.js';
import * as templates from './templates.service.js';

/**
 * School settings engine (mounted at /settings next to /settings/school and /settings/payments).
 *
 *   GET  /settings/overview                            the settings home: plan, channels, usage, counts
 *   GET  /settings/modules            PUT              switch optional modules on / off
 *   GET  /settings/sections/:section  PUT  DELETE      attendance | calendar | messaging (DELETE: branch back to school-wide)
 *   GET  /settings/communication                       WhatsApp / SMS / email accounts
 *   PUT  /settings/communication/:channel              save provider + credentials
 *   POST /settings/communication/:channel/verify       test connection (read-only)
 *   POST /settings/communication/:channel/test         send a test message { to }
 *   DELETE /settings/communication/:channel            remove own account (back to school-wide / platform)
 *   GET  /settings/templates                           every message x channel, default + school text
 *   PUT  /settings/templates/:event/:channel  DELETE   save / back to default
 *   POST /settings/templates/preview                   render with sample values
 *   POST /settings/templates/:event/whatsapp/submit    send to Meta for approval (WhatsApp Cloud API)
 *   POST /settings/templates/whatsapp/sync             approval status from Meta
 *   GET  /settings/notification-rules                  PUT /:event  DELETE /:event
 *   GET  /settings/devices  POST  PATCH /:id  POST /:id/rotate-key  DELETE /:id
 *   GET  /settings/devices/punches
 *   GET  /settings/devices/identifiers  PUT  DELETE /identifiers/:id
 *   GET  /settings/audit                               change log
 */
export const schoolSettingsRouter = Router();
const admins = [authenticate, authorize(ADMINS)];

const q = (schema) => validate({ query: schema });
const b = (schema, params) => validate(params ? { params, body: schema } : { body: schema });

schoolSettingsRouter.get('/overview', ...admins, q(s.tenantQuery), async (req, res) => {
  res.json({ data: await settings.overview(req.auth, req.valid.query) });
});

// ---- modules
schoolSettingsRouter.get('/modules', ...admins, q(s.tenantQuery), async (req, res) => {
  res.json({ data: await settings.getModules(req.auth, req.valid.query) });
});
schoolSettingsRouter.put('/modules', ...admins, b(s.modulesBody), async (req, res) => {
  res.json({ data: await settings.putModules(req.auth, req.valid.body) });
});

// ---- typed sections
schoolSettingsRouter.get('/sections/:section', ...admins, validate({ params: s.sectionParams, query: s.branchQuery }), async (req, res) => {
  res.json({ data: await settings.getSection(req.auth, req.valid.params.section, req.valid.query) });
});
schoolSettingsRouter.put('/sections/:section', ...admins, b(s.sectionBody, s.sectionParams), async (req, res) => {
  res.json({ data: await settings.putSectionValue(req.auth, req.valid.params.section, req.valid.body) });
});
schoolSettingsRouter.delete('/sections/:section', ...admins, validate({ params: s.sectionParams, query: s.branchQuery }), async (req, res) => {
  res.json({ data: await settings.resetSection(req.auth, req.valid.params.section, req.valid.query) });
});

// ---- communication
schoolSettingsRouter.get('/communication', ...admins, q(s.tenantQuery), async (req, res) => {
  res.json({ data: await comm.getCommunication(req.auth, req.valid.query) });
});
schoolSettingsRouter.put('/communication/:channel', ...admins, b(s.channelBody, s.channelParams), async (req, res) => {
  res.json({ data: await comm.saveChannel(req.auth, req.valid.params.channel, req.valid.body) });
});
schoolSettingsRouter.post('/communication/:channel/verify', ...admins, b(s.channelTargetBody, s.channelParams), async (req, res) => {
  res.json({ data: await comm.verifyChannel(req.auth, req.valid.params.channel, req.valid.body) });
});
schoolSettingsRouter.post('/communication/:channel/test', ...admins, b(s.testBody, s.channelParams), async (req, res) => {
  const result = await comm.sendTest(req.auth, req.valid.params.channel, req.valid.body);
  res.status(result.ok ? 200 : 502).json({ data: result });
});
schoolSettingsRouter.delete('/communication/:channel', ...admins, validate({ params: s.channelParams, query: s.branchQuery }), async (req, res) => {
  res.json({ data: await comm.deleteChannel(req.auth, req.valid.params.channel, req.valid.query) });
});

// ---- templates
schoolSettingsRouter.get('/templates', ...admins, q(s.tenantQuery), async (req, res) => {
  res.json({ data: await templates.listTemplates(req.auth, req.valid.query) });
});
schoolSettingsRouter.post('/templates/preview', ...admins, b(s.previewBody), (req, res) => {
  res.json({ data: templates.previewTemplate(req.valid.body) });
});
schoolSettingsRouter.post('/templates/whatsapp/sync', ...admins, b(s.channelTargetBody), async (req, res) => {
  res.json({ data: await templates.syncWhatsappTemplates(req.auth, req.valid.body) });
});
schoolSettingsRouter.post('/templates/:event/whatsapp/submit', ...admins, b(s.channelTargetBody, s.eventParams), async (req, res) => {
  res.json({ data: await templates.submitWhatsappTemplate(req.auth, req.valid.params.event, req.valid.body) });
});
schoolSettingsRouter.put('/templates/:event/:channel', ...admins, b(s.templateBody, s.templateParams), async (req, res) => {
  res.json({ data: await templates.saveTemplate(req.auth, req.valid.params.event, req.valid.params.channel, req.valid.body) });
});
schoolSettingsRouter.delete('/templates/:event/:channel', ...admins, validate({ params: s.templateParams, query: s.tenantQuery }), async (req, res) => {
  res.json({ data: await templates.resetTemplate(req.auth, req.valid.params.event, req.valid.params.channel, req.valid.query) });
});

// ---- notification rules
schoolSettingsRouter.get('/notification-rules', ...admins, q(s.tenantQuery), async (req, res) => {
  res.json({ data: await rules.listRules(req.auth, req.valid.query) });
});
schoolSettingsRouter.put('/notification-rules/:event', ...admins, b(rules.ruleBody, s.eventParams), async (req, res) => {
  res.json({ data: await rules.saveRule(req.auth, req.valid.params.event, req.valid.body) });
});
schoolSettingsRouter.delete('/notification-rules/:event', ...admins, validate({ params: s.eventParams, query: s.tenantQuery }), async (req, res) => {
  res.json({ data: await rules.resetRule(req.auth, req.valid.params.event, req.valid.query) });
});

// ---- devices (literal paths before /:id)
schoolSettingsRouter.get('/devices/punches', ...admins, q(s.punchesQuery), async (req, res) => {
  res.json(await devices.listPunches(req.auth, req.valid.query));
});
schoolSettingsRouter.get('/devices/identifiers', ...admins, q(s.identifiersQuery), async (req, res) => {
  res.json(await devices.listIdentifiers(req.auth, req.valid.query));
});
schoolSettingsRouter.put('/devices/identifiers', ...admins, b(s.identifiersBody), async (req, res) => {
  res.json({ data: await devices.saveIdentifiers(req.auth, req.valid.body) });
});
schoolSettingsRouter.delete('/devices/identifiers/:id', ...admins, validate({ params: s.idParams, query: s.tenantQuery }), async (req, res) => {
  res.json({ data: await devices.deleteIdentifier(req.auth, req.valid.params.id, req.valid.query) });
});
schoolSettingsRouter.get('/devices', ...admins, q(s.branchQuery), async (req, res) => {
  res.json({ data: await devices.listDevices(req.auth, req.valid.query) });
});
schoolSettingsRouter.post('/devices', ...admins, b(s.deviceBody), async (req, res) => {
  res.status(201).json({ data: await devices.createDevice(req.auth, req.valid.body) });
});
schoolSettingsRouter.patch('/devices/:id', ...admins, b(s.deviceUpdateBody, s.idParams), async (req, res) => {
  res.json({ data: await devices.updateDevice(req.auth, req.valid.params.id, req.valid.body) });
});
schoolSettingsRouter.post('/devices/:id/rotate-key', ...admins, b(s.channelTargetBody, s.idParams), async (req, res) => {
  res.json({ data: await devices.rotateKey(req.auth, req.valid.params.id, req.valid.body) });
});
schoolSettingsRouter.delete('/devices/:id', ...admins, validate({ params: s.idParams, query: s.tenantQuery }), async (req, res) => {
  res.json({ data: await devices.deleteDevice(req.auth, req.valid.params.id, req.valid.query) });
});

// ---- change log
schoolSettingsRouter.get('/audit', ...admins, q(s.auditQuery), async (req, res) => {
  res.json(await settings.auditLog(req.auth, req.valid.query));
});

// ---------------------------------------------------------------- /school/entitlements (every signed-in role)
export const entitlementsRouter = Router();
entitlementsRouter.get('/entitlements', authenticate, authorize(ALL_ROLES), async (req, res) => {
  res.set('Cache-Control', 'private, max-age=30').json({ data: await settings.myEntitlements(req.auth) });
});
