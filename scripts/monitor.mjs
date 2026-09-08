import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {cf,d1Query,projectConfig} from './lib/cloudflare-admin.mjs';
const args=process.argv.slice(2);if(!args.includes('--env'))throw new Error('Use --env staging|production');
const environment=args[args.indexOf('--env')+1],{config,release}=projectConfig(),target=config.env[environment];if(!release.environments[environment]||!target)throw new Error('Unknown monitoring environment');
const db=target.d1_databases[0],since=new Date(Date.now()-86400000).toISOString();
try{
 const result=(await d1Query(db.database_id,`SELECT
 (SELECT count(*) FROM mcp_calls WHERE started_at>=?) mcp_calls,
 (SELECT coalesce(sum(byte_size),0) FROM attachments WHERE created_at>=?) new_image_bytes,
 (SELECT coalesce(sum(byte_size),0) FROM attachments WHERE state='ready') total_image_bytes,
 (SELECT count(*) FROM mcp_calls WHERE started_at>=? AND outcome IN ('failed','unknown')) failed_or_unknown_calls`,[since,since,since]))[0].results[0];
 const info=await cf(`/accounts/${config.account_id}/d1/database/${db.database_id}`);result.d1_bytes=info.file_size;
 const alerts=[];for(const [name,limit] of Object.entries(release.daily_limits)){if(!Number.isFinite(result[name]))throw new Error('A required usage metric is unavailable');if(result[name]>=limit)alerts.push(name);}
 const report={at:new Date().toISOString(),environment,window_hours:24,usage:result,thresholds:release.daily_limits,alerts,billing_measurement:false};
 mkdirSync('tmp/verification',{recursive:true});writeFileSync(`tmp/verification/monitor-${environment}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nUsage check: ${environment}\n\n| Metric | Observed | Alert threshold |\n|---|---:|---:|\n`+Object.entries(release.daily_limits).map(([name,limit])=>`| ${name} | ${result[name]} | ${limit} |`).join('\n')+'\n\nImage sizes reflect indexed application objects. These are operational thresholds, not a Cloudflare bill or spending cap.\n');
 if(alerts.length){console.error('::error::Usage threshold exceeded: '+alerts.join(', '));process.exitCode=1;}
}catch{console.error('::error::Usage collection failed; no private response logged');process.exitCode=1;}
