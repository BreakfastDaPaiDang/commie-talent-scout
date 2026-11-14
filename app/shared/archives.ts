import type { PersonRole, MemberBasicState } from '../rules/archive-states';
import type { ArchiveReminder } from '../rules/archive-reminders';
import type { ContactReminder } from '../rules/contact-reminders';
import type { TagBinding, TagLabel } from './tags';
export type BoundMember = {
  id: string;
  name: string;
  frozen: boolean;
};
export type Archive = {
  linked_account_id: string | null;
  id: string;
  type: 'person' | 'org';
  name: string;
  current_need: string;
  status: string;
  person_role: PersonRole | null;
  member_status: MemberBasicState | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_snapshot_version: number | null;
  last_open_status: string | null;
  avatar_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
  tag_snapshot_version: number | null;
  contacts: {
    type: string;
    value: string;
    note: string;
  }[];
  links: {
    label: string;
    url: string;
  }[];
  closed: boolean;
  deleted: boolean;
  update_reminder: ArchiveReminder;
  contact_reminder: ContactReminder;
  observation_count: number;
  latest_observation: string | null;
  members: BoundMember[];
  bindings: Record<string, BoundMember[]>;
  tags: TagBinding[];
  tag_summary?: {
    tags: TagLabel[];
    total: number;
  };
};
