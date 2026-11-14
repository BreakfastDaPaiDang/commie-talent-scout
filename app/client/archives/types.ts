import { type ClosedHistoryRange } from "../../ui/Workspace";
import { type PersonScope } from "../../rules/archive-states";
import type { ObservationFocus } from "../ObservationSection";
import { type Member } from "../api";
import type { Archive } from "../../shared/archives";
export type Kind = 'person' | 'org';
export type ArchiveWithTasks = Archive & {
  open_task_count?: number;
};
export type Preference = {
  query: string;
  selected: string | null;
  scope: 'all' | 'mine' | 'unread';
  status: string;
  member_id: string;
  closed: 'all' | 'open' | 'closed';
  closed_history: ClosedHistoryRange;
  tag_ids: string[];
};
export type ListArchive = Archive & {
  unread_count?: number;
  search_match?: {
    observation_id: string;
    excerpt: string;
  } | null;
};
export type ArchivePageProps = {
  personScope?: PersonScope;
  trash?: boolean;
  onTypeChange?: (type: Kind) => void;
  actor: Member;
  type: Kind;
  linked?: {
    archiveId: string;
    focus: ObservationFocus;
  };
  detailOnly?: boolean;
  onNextUnread?: () => void;
  onClose?: () => void;
  pageLabel?: string;
  initialStatus?: string;
  createStatus?: string;
};
