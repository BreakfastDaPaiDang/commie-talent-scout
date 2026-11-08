import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {Observations} from '../app/server/observations.ts';
import {WorkOverview} from '../app/server/work-overview.ts';

export async function verifyObservationContainers({page,f,base,archiveId}){
 const out='tmp/verification/observation-containers';mkdirSync(out,{recursive:true});
 const obs=new Observations(f.env,f.actor,'web'),overview=new WorkOverview(f.env,f.actor);
 const person=(await overview.read({})).people.find(p=>p.id===archiveId);
 const state=person.segments.filter(s=>s.source==='state').at(-1);
 const records=[];
 for(const [i,body] of ['第一次联系：确认希望参与写作。','第二次联系：已经说明接待安排。'].entries())records.push(await obs.create({archive_id:archiveId,body,occurred_at:new Date(Date.parse(state.start)+(i+1)*86400000).toISOString(),request_id:randomUUID()}));
 await page.goto(base+'/statistics');await page.getByRole('button',{name:person.name,exact:true}).waitFor();
 await page.getByPlaceholder('搜索名称',{exact:true}).fill(person.name);
 const row=page.locator('.wo-row').filter({has:page.getByRole('button',{name:person.name,exact:true})});
 const cells=records.map(r=>row.locator(`[data-observation-id="${r.id}"]`));
 for(const cell of cells){await cell.waitFor();assert.equal(await cell.count(),1);assert.ok((await cell.boundingBox()).width>0);}
 assert.equal(await cells[0].evaluate(el=>getComputedStyle(el).backgroundColor),await cells[1].evaluate(el=>getComputedStyle(el).backgroundColor));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1080});await page.locator('.wo-main').screenshot({path:`${out}/timeline-${width}.png`});
  for(let i=0;i<cells.length;i++){
   await cells[i].click();const drawer=page.locator('.wo-drawer');assert.equal(await drawer.locator('.wo-observations article').count(),1);await drawer.getByText(i===0?'第一次联系：确认希望参与写作。':'第二次联系：已经说明接待安排。',{exact:true}).waitFor();assert.equal(await drawer.locator('.wo-linked-resources').innerText(),'本段关联资源\n\n未登记');
   if(i===1)await drawer.screenshot({path:`${out}/record-${width}.png`});await page.keyboard.press('Escape');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.reload();await page.locator(`[data-observation-id="${records[0].id}"]`).waitFor();
 // The shared preview must also create a new container, rather than append to the current one.
 await page.goto('http://127.0.0.1:5196/?work-overview');await page.getByRole('button',{name:'林晓',exact:true}).waitFor();
 const previewRow=page.locator('.wo-row').filter({has:page.getByRole('button',{name:'林晓',exact:true})});
 const before=await previewRow.locator('[data-source="observation"]').count();await previewRow.locator('.wo-segment').last().click();
 await page.getByRole('button',{name:'＋ 新增观察',exact:true}).click();await page.getByLabel('新增观察',{exact:true}).fill('原型中本轮新增观察');await page.getByRole('button',{name:'保存观察',exact:true}).click();await page.locator('.wo-observations').getByText('原型中本轮新增观察',{exact:true}).waitFor();assert.equal(await previewRow.locator('[data-source="observation"]').count(),before+1);await page.keyboard.press('Escape');
 console.log('observation-containers: distinct same-stage records, desktop/mobile selection, refresh and shared preview passed');
}
