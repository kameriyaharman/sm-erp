import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './accounts.schemas.js';
import * as controller from './accounts.controller.js';

/**
 * Accounts and the day book (ADMINS; branch_admin = own branch, super_admin = ?branchId or head office).
 * Mounted at /accounts, /daybook and /ledger.
 */
const guard = [authenticate, authorize(ADMINS)];

export const accountsRouter = Router();
accountsRouter.use(guard);
accountsRouter.get('/', validate({ query: schemas.branchQuery }), controller.listAccounts);
accountsRouter.post('/', validate({ body: schemas.createAccountBody }), controller.createAccount);
accountsRouter.get('/summary', validate({ query: schemas.summaryQuery }), controller.summary);
accountsRouter.post('/transfer', validate({ body: schemas.transferBody }), controller.transfer);
accountsRouter.patch('/:id', validate({ params: idParams, body: schemas.updateAccountBody }), controller.updateAccount);

export const daybookRouter = Router();
daybookRouter.use(guard);
daybookRouter.get('/', validate({ query: schemas.daybookQuery }), controller.dayBook);
daybookRouter.get('/range', validate({ query: schemas.rangeQuery }), controller.dayBookRange);

export const ledgerRouter = Router();
ledgerRouter.use(guard);
ledgerRouter.get('/', validate({ query: schemas.ledgerQuery }), controller.listLedger);
ledgerRouter.get('/export.csv', validate({ query: schemas.exportQuery }), controller.exportCsv);
ledgerRouter.get('/entries.csv', validate({ query: schemas.ledgerExportQuery }), controller.exportLedgerCsv);
ledgerRouter.post('/', validate({ body: schemas.createEntryBody }), controller.createEntry);
ledgerRouter.delete('/:id', validate({ params: idParams, body: schemas.deleteEntryBody }), controller.deleteEntry);
