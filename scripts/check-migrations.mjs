import {migrationPlan} from './lib/release-plan.mjs';
console.log(JSON.stringify({reviewed_migrations:Object.keys(migrationPlan()).length}));
