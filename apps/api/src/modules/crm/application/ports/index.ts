export { type ContactRepository, CONTACT_REPOSITORY } from './contact-repository.port.js';
export { type PipelineRepository, PIPELINE_REPOSITORY } from './pipeline-repository.port.js';
export { type DealRepository, DEAL_REPOSITORY } from './deal-repository.port.js';
export { type ActivityRepository, ACTIVITY_REPOSITORY } from './activity-repository.port.js';
export { type NoteRepository, type NoteData, NOTE_REPOSITORY } from './note-repository.port.js';
export { type AttachmentRepository, type AttachmentData, ATTACHMENT_REPOSITORY } from './attachment-repository.port.js';
export {
  type ActivityListFilter,
  type ActivitySortBy,
  type ContactListFilter,
  type ContactSortBy,
  type CompanyListFilter,
  type CompanySortBy,
  type CrmCompanyRecord,
  type CrmPipelineRecord,
  type CrmReadRepository,
  type DealListFilter,
  type DealListPage,
  type DealSortBy,
  type SortDirection,
  type PageResult,
  CRM_READ_REPOSITORY,
} from './crm-read-repository.port.js';
