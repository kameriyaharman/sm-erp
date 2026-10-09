import express, { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { localParts, safeZone, zonedToUtc } from '../../utils/time.js';
import { deviceBlockReason, deviceByKey, deviceBySerial, processPunch, touchDevice } from './punch.service.js';

/**
 * Endpoints called BY attendance devices (no user login).
 *
 * 1. JSON API for gate apps, QR scanners and RFID / biometric middleware:
 *      GET  /api/v1/devices/me                       who am I + the school's timings
 *      POST /api/v1/devices/punch                    { identifier, at? } or { punches: [{ identifier, at? }, ...] }
 *    Auth: header  X-Device-Key: smd_...   (or Authorization: Bearer smd_...)
 *    `at`: ISO 8601 with offset ("2026-10-09T08:05:12+05:30"), or the school's local time
 *    "2026-10-09 08:05:12"; omitted = now.
 *
 * 2. ZKTeco / eSSL "ADMS" push protocol (most biometric and face terminals sold in India):
 *      GET  /iclock/cdata?SN=...        handshake: the device asks for its options
 *      POST /iclock/cdata?SN=...&table=ATTLOG   tab-separated punch lines
 *      GET  /iclock/getrequest?SN=...   "any commands for me?" -> OK
 *      POST /iclock/devicecmd?SN=...    command results -> OK
 *    The device is identified by its serial number, registered under Settings -> Devices.
 *    Point the device's "Cloud server" setting at the school's SM ERP web address, port 443.
 */

const MAX_BATCH = 500;

function keyFrom(req) {
  const header = req.get('x-device-key');
  if (header) return header.trim();
  const auth = req.get('authorization');
  const m = auth && /^Bearer\s+(smd_\S+)$/i.exec(auth.trim());
  return m ? m[1] : null;
}

async function authDevice(req) {
  const device = await deviceByKey(keyFrom(req));
  if (!device || device.protocol !== 'http') throw AppError.unauthorized('Unknown or revoked device key', 'DEVICE_UNAUTHORIZED');
  const blocked = await deviceBlockReason(device);
  if (blocked) throw AppError.forbidden(`This device cannot record attendance: ${blocked}`, 'DEVICE_DISABLED');
  touchDevice(device.id, req.ip);
  return device;
}

/** ISO with offset, or "YYYY-MM-DD HH:MM[:SS]" in the school's zone. Rejects times far in the future. */
export function parsePunchTime(value, timeZone, now = new Date()) {
  if (value === undefined || value === null || value === '') return now;
  const s = String(value).trim();
  let at;
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (local) {
    at = new Date(zonedToUtc(local[1], `${local[2]}:${local[3]}`, timeZone).getTime() + Number(local[4] ?? 0) * 1000);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    at = new Date(s);
  } else {
    return null;
  }
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() > now.getTime() + 5 * 60_000) return null; // device clock running ahead
  return at;
}

const punchItem = z.object({ identifier: z.union([z.string(), z.number()]).transform(String), at: z.string().max(40).optional().nullable() }).strict();
const punchBody = z.union([
  punchItem,
  z.object({ punches: z.array(punchItem).min(1).max(MAX_BATCH) }).strict(),
]);

export const deviceApiRouter = Router();

deviceApiRouter.get('/me', async (req, res) => {
  const device = await authDevice(req);
  const zone = safeZone(device.timezone);
  res.json({
    data: {
      id: device.id,
      name: device.name,
      kind: device.kind,
      appliesTo: device.applies_to,
      schoolTime: localParts(new Date(), zone),
      timeZone: zone,
    },
  });
});

deviceApiRouter.post('/punch', async (req, res) => {
  const device = await authDevice(req);
  const parsed = punchBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Validation failed', { body: parsed.error.flatten().fieldErrors }, 'VALIDATION_ERROR');
  const items = 'punches' in parsed.data ? parsed.data.punches : [parsed.data];
  const zone = safeZone(device.timezone);
  const results = [];
  for (const item of items) {
    const at = parsePunchTime(item.at, zone);
    if (!at) {
      results.push({ identifier: item.identifier, result: 'invalid', detail: 'Unreadable or future time' });
      continue;
    }
    try {
      const out = await processPunch(device, { identifier: item.identifier, at });
      results.push({ identifier: item.identifier, result: out.result, detail: out.detail ?? null });
    } catch (err) {
      logger.error('Device punch failed', { deviceId: device.id, error: err.message });
      results.push({ identifier: item.identifier, result: 'error', detail: 'Could not be recorded; send it again' });
    }
  }
  res.json({ data: { device: device.name, results } });
});

// ------------------------------------------------------------------ ZKTeco / eSSL ADMS

export const admsRouter = Router();
admsRouter.use(express.text({ type: '*/*', limit: '2mb' }));

const plain = (res, text) => res.type('text/plain').send(text);

async function admsDevice(req) {
  const device = await deviceBySerial(String(req.query.SN ?? ''));
  if (!device) return null;
  touchDevice(device.id, req.ip);
  return device;
}

admsRouter.get('/cdata', async (req, res) => {
  const device = await admsDevice(req);
  if (!device) return plain(res.status(404), 'Unknown device');
  // Handshake: ask for new attendance logs in real time.
  return plain(res, [
    `GET OPTION FROM: ${device.serial_number}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog',
    'Realtime=1',
    'Encrypt=None',
  ].join('\n'));
});

/** "1001\t2026-10-09 08:05:12\t0\t1\t0\t0" lines -> [{ identifier, local }] */
export function parseAttlog(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const cols = line.split('\t');
    if (cols.length < 2) continue;
    const identifier = cols[0].trim();
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/.exec(cols[1].trim());
    if (!identifier || !m) continue;
    out.push({ identifier, local: `${m[1]} ${m[2]}` });
  }
  return out;
}

admsRouter.post('/cdata', async (req, res) => {
  const device = await admsDevice(req);
  if (!device) return plain(res.status(404), 'Unknown device');
  const table = String(req.query.table ?? '').toUpperCase();
  if (table !== 'ATTLOG') return plain(res, 'OK'); // user lists, operation logs, photos: not needed
  const blocked = await deviceBlockReason(device);
  const lines = parseAttlog(req.body);
  if (blocked) {
    logger.warn('ADMS punches refused', { deviceId: device.id, reason: blocked, count: lines.length });
    return plain(res, `OK: ${lines.length}`); // acknowledge, or the device re-sends forever
  }
  const zone = safeZone(device.timezone);
  let stored = 0;
  for (const line of lines.slice(0, 2000)) {
    const at = parsePunchTime(line.local, zone);
    if (!at) continue;
    try {
      await processPunch(device, { identifier: line.identifier, at });
      stored += 1;
    } catch (err) {
      logger.error('ADMS punch failed', { deviceId: device.id, error: err.message });
      // Not acknowledged: the device sends the batch again later.
      return plain(res.status(500), 'ERROR');
    }
  }
  return plain(res, `OK: ${stored}`);
});

admsRouter.get('/getrequest', async (req, res) => {
  await admsDevice(req);
  return plain(res, 'OK');
});

admsRouter.post('/devicecmd', async (req, res) => {
  await admsDevice(req);
  return plain(res, 'OK');
});
