import { GovAssignment } from './GovAssignment.js';
import { GovConfig } from './GovConfig.js';
import { GovPersona } from './GovPersona.js';
import { GovRequest } from './GovRequest.js';
import { GovSchemaMigration } from './GovSchemaMigration.js';
import { GovTask } from './GovTask.js';

/**
 * Schema type definition for the Governance Hub app.
 *
 * Transactional, customer-edited state lives here; everything collected from a
 * control plane lives as Delta in the `governance_lh` lakehouse and is read
 * through the Governance Model (PLAN.md §12).
 */
export type DataAppSchema = {
  GovAssignment: GovAssignment;
  GovConfig: GovConfig;
  GovPersona: GovPersona;
  GovRequest: GovRequest;
  GovSchemaMigration: GovSchemaMigration;
  GovTask: GovTask;
};

export const schema = [
  GovAssignment,
  GovConfig,
  GovPersona,
  GovRequest,
  GovSchemaMigration,
  GovTask,
];
