import { GovAssignment } from './GovAssignment.js';
import { GovConfig } from './GovConfig.js';
import { GovPersona } from './GovPersona.js';
import { GovRequest } from './GovRequest.js';
import { GovSchemaMigration } from './GovSchemaMigration.js';
import { GovTask } from './GovTask.js';
import { UmAudit } from './UmAudit.js';
import { UmBinding } from './UmBinding.js';
import { UmGroupContact } from './UmGroupContact.js';
import { UmManagedGroup } from './UmManagedGroup.js';
import { UmRequest } from './UmRequest.js';
import { UmReviewDate } from './UmReviewDate.js';

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
  UmAudit: UmAudit;
  UmBinding: UmBinding;
  UmGroupContact: UmGroupContact;
  UmManagedGroup: UmManagedGroup;
  UmRequest: UmRequest;
  UmReviewDate: UmReviewDate;
};

export const schema = [
  GovAssignment,
  GovConfig,
  GovPersona,
  GovRequest,
  GovSchemaMigration,
  GovTask,
  UmAudit,
  UmBinding,
  UmGroupContact,
  UmManagedGroup,
  UmRequest,
  UmReviewDate,
];
