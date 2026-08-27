import { authenticated, date, entity, text, uuid } from '@microsoft/rayfin-core';

// Operator-authored pre-departure / in-service checklist results. One row per
// checked item lets an operator log only what matters and flag issues per
// vessel. Filter status='issue' to surface open problems. Written by signed-in
// operators (create/update), unlike the read-only Ferry projection. Vessels are
// keyed by ferry_name to match the rest of the app's business key.
@entity()
@authenticated()
export class VesselCheck {
  @uuid() id!: string;
  @text({ max: 120 }) ferry_name!: string;
  // category: vessel, navigation, safety, crew, passenger, compliance
  @text({ max: 40 }) category!: string;
  @text({ max: 200 }) item!: string;
  // status: ok | issue | na
  @text({ max: 16 }) status!: string;
  @text({ max: 500, optional: true }) notes?: string;
  @text({ max: 120, optional: true }) inspector?: string;
  @date() timestamp!: Date;
}
