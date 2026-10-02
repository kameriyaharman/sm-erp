import { resolveBranchScope } from '../../middleware/scope.js';
import * as financeService from './finance.service.js';

export async function getDefaulters(req, res) {
  const { tenantId, branchId, ...filters } = req.valid.query;
  const scope = await resolveBranchScope(req.auth, { tenantId, branchId });
  const result = await financeService.listDefaulters({ scope, filters });
  res.json(result);
}
