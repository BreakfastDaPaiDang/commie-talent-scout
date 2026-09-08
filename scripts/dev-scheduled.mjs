import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
config.main=resolve(config.main);config.assets.directory=resolve(config.assets.directory);
// The dev scheduled middleware must run before the SPA static-assets fallback.
config.assets.run_worker_first=true;
config.dev={...config.dev,host:'127.0.0.1:8792'};
mkdirSync('tmp/verification',{recursive:true});
writeFileSync('tmp/verification/wrangler-schedule.json',JSON.stringify(config,null,2));
const worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','tmp/verification/wrangler-schedule.json','--env','staging','--port','8792','--test-scheduled','--persist-to','.wrangler/state'],{stdio:'inherit'});
worker.on('exit',code=>process.exit(code??1));
