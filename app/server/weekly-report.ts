import {z} from 'zod';
import {statistics} from './statistics.ts';
import {WorkOverview} from './work-overview.ts';
import {weeklyReportQuery,type WeeklyReportData} from '../shared/weekly-report.ts';
import {now,type Env,type Actor} from './types.ts';

export async function weeklyReport(env:Env,actor:Actor,input:unknown):Promise<WeeklyReportData>{
 const scope=z.object({group:z.enum(['user','tag','type']).default('user'),archive_type:z.enum(['all','person','org']).default('all')}).strict().parse(input);
 const generated_at=now(),query=weeklyReportQuery(new Date(generated_at),scope);
 const [summary,overview]=await Promise.all([statistics(env,actor,query,{asOf:generated_at}),new WorkOverview(env,actor).read({type:scope.archive_type},generated_at)]);
 return {generated_at,from:query.from,to:query.to,statistics:summary,overview};
}
