import React from 'react';
import type {Member} from '../api';
import {KnowledgePage} from '../KnowledgePage';
import {CatalogPage} from '../CatalogPage';
import {StatisticsPage} from '../StatisticsPage';
import {NotificationCenter} from '../NotificationCenter';
import {ResourcePage} from '../ResourcePage';
import {AuxiliaryTools} from '../../ui/AuxiliaryTools';
import {ProfilePage} from '../AvatarEditor';
import {TagLibraryPage} from '../TagsSection';
import {AgentPage,ConnectionsPage} from '../ConnectionPages';
import {WorkTasksPage} from '../WorkTasksPage';
import {ArchivesPage,ArchiveTrashPage} from '../ArchivesPage';
import {MembersPage} from '../MembersPage';
import {CallsPage} from '../TaskReviewPage';
import {primaryNavigation,resolveRoute,type RouteId} from './routes';

type PageContext = {
  member: Member;
  path: string;
  navigate: (path: string) => void;
  refreshActor: (message?: string) => Promise<Member | null>;
  unreadCount: number;
  returnToTasks?: () => void;
};

function ArchivePage({member,path,navigate,unreadCount,returnToTasks}: PageContext) {
  const organization = path === '/organizations', members = path === '/members';
  return <ArchivesPage key={member.id+path} actor={member} type={organization?'org':'person'}
    personScope={organization?'all':members?'members':'external'}
    pageLabel={members?'社员':undefined} createStatus={members?'已入伙':undefined}
    onClose={returnToTasks} onNextUnread={unreadCount?()=>navigate('/messages?tab=updates'):undefined}/>;
}

const views: Record<RouteId,(context:PageContext)=>React.ReactNode> = {
  people: context => <ArchivePage {...context}/>,
  organizations: context => <ArchivePage {...context}/>,
  members: context => <ArchivePage {...context}/>,
  tasks: ({member,navigate}) => <WorkTasksPage actor={member} onOpenArchive={(archive,taskId,observationId,contentVersion)=>navigate(`${archive.type==='org'?'/organizations':archive.person_role==='member'?'/members':'/'}?archive=${archive.id}${taskId?`&from=tasks&task=${encodeURIComponent(taskId)}`:''}${observationId?`&observation=${encodeURIComponent(observationId)}`:''}${contentVersion?`&version=${contentVersion}`:''}`)}/>,
  statistics: ({member,navigate}) => <StatisticsPage key={member.id} navigate={navigate}/>,
  knowledge: ({member}) => <KnowledgePage key={member.id}/>,
  catalog: ({member}) => <CatalogPage key={member.id}/>,
  messages: ({member,navigate}) => <NotificationCenter actor={member} onNavigate={navigate}/>,
  resources: () => <ResourcePage/>,
  tools: () => <AuxiliaryTools/>,
  profile: ({member,refreshActor}) => <ProfilePage actor={member} refreshActor={refreshActor}/>,
  tags: ({member}) => <TagLibraryPage isAdmin={member.role==='admin'}/>,
  agent: () => <AgentPage/>,
  connections: () => <ConnectionsPage/>,
  admin: ({member,path,refreshActor}) => member.role==='admin'
    ? path==='/admin/trash'?<ArchiveTrashPage actor={member}/>:path==='/admin/members'?<MembersPage actor={member} refreshActor={refreshActor}/>:<CallsPage/>
    : <main className="account-content"><p role="alert">仅管理员可以进入。</p></main>,
};

export function PageRoutes(context:PageContext) {
  return views[resolveRoute(context.path)](context);
}

export function PrimaryNavigation({path,legacyArchiveLink,navigate}:{path:string;legacyArchiveLink:boolean;navigate:(path:string)=>void}) {
  return <>{primaryNavigation(path,legacyArchiveLink).map(item=><button key={item.path} className={item.active?'active':''} aria-current={item.active?'page':undefined} onClick={()=>navigate(item.path)}>{item.title}</button>)}</>;
}
