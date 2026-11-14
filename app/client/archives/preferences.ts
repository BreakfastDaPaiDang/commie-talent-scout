import { type Preference } from './types';
export const defaults: Preference = {
  query: '',
  selected: null,
  scope: 'all',
  status: '',
  member_id: '',
  closed: 'all',
  closed_history: '30',
  tag_ids: []
};
export function preferences(key: string): Preference {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem(key) ?? '{}')
    };
  } catch {
    return {
      ...defaults
    };
  }
}
