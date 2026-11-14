export type RouteId = 'people' | 'organizations' | 'members' | 'tasks' | 'statistics' | 'knowledge' | 'catalog' | 'messages' | 'resources' | 'tools' | 'profile' | 'tags' | 'agent' | 'connections' | 'admin';
type RouteDefinition = {
  id: RouteId;
  path: string;
  aliases?: readonly string[];
  navigation?: string;
  prefix?: boolean;
  navigationPrefix?: string;
};

// The same definitions select a page and provide its primary navigation entry.
export const routes: readonly RouteDefinition[] = [
  {id: 'people', path: '/people', navigation: '外部人物'},
  {id: 'organizations', path: '/organizations', navigation: '组织'},
  {id: 'members', path: '/members', navigation: '社员'},
  {id: 'tasks', path: '/tasks', navigation: '任务'},
  {id: 'statistics', path: '/statistics', aliases: ['/statistics/work'], navigation: '统计', navigationPrefix: '/statistics/'},
  {id: 'knowledge', path: '/knowledge', navigation: '知识库'},
  {id: 'catalog', path: '/catalog'},
  {id: 'messages', path: '/messages', aliases: ['/unread']},
  {id: 'resources', path: '/tools/resources'},
  {id: 'tools', path: '/tools'},
  {id: 'profile', path: '/account/profile'},
  {id: 'tags', path: '/tags'},
  {id: 'agent', path: '/agent'},
  {id: 'connections', path: '/account/connections'},
  {id: 'admin', path: '/admin/', prefix: true},
];

export function resolveRoute(path: string): RouteId {
  return routes.find(route => path === route.path || route.aliases?.includes(path) || route.prefix && path.startsWith(route.path))?.id ?? 'people';
}

export function primaryNavigation(path: string, legacyArchiveLink = false) {
  return routes.filter(route => route.navigation).map(route => ({
    id: route.id,
    path: route.path,
    title: route.navigation!,
    active: path === route.path || route.id === 'people' && path === '/' && legacyArchiveLink || !!route.navigationPrefix && path.startsWith(route.navigationPrefix),
  }));
}
