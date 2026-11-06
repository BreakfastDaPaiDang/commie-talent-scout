import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutPersonnelFlow} from '../app/shared/personnel-layout.ts';
const cell=(id,people=[])=>({id,key:id,stage:id.split('|')[0],title:id,type:'群聊',archive_id:null,people,planned:[],sources:[],resources:[],historical:false,resource_id:id});
const layer=(id,cells)=>({id,title:id,people:0,unplaced:0,attention:0,resources:cells.length,materials:0,observations:0,cells});
const edge=(from,to,n,kind='transfer')=>({id:from+'>'+to,from,to,kind,people:Array.from({length:n},(_,i)=>String(i)),sources:[]});
test('flow layout uses horizontal stages, actual links only and proportional historical weights independent of current stock',()=>{
 const layers=[layer('a',[cell('a|1',['current'])]),layer('b',[cell('b|1'),cell('b|2')]),layer('c',[cell('c|1')])],links=[edge('a|1','b|1',6),edge('a|1','b|2',3),edge('b|1','c|1',4),edge('b|2','c|1',2)],l=layoutPersonnelFlow(layers,links);
 assert.ok(l.nodes.get('a|1').x<l.nodes.get('b|1').x);assert.ok(l.nodes.get('b|1').x<l.nodes.get('c|1').x);assert.ok(l.nodes.get('b|1').y<l.nodes.get('b|2').y);assert.equal(l.ribbons.length,4);assert.equal(l.ribbons[0].width/l.ribbons[1].width,2);assert.equal(l.nodes.get('a|1').cell.people.length,1);assert.ok(l.ribbons.every(r=>!r.path.includes('NaN')));
});
test('rank diagram excludes all same-rank references and static affiliations but keeps recorded cross-rank returns',()=>{
 const layers=[layer('a',[cell('a|1'),cell('a|2')]),layer('b',[cell('b|1')])],links=[edge('a|1','a|2',200,'resource_transfer'),edge('b|1','a|1',1),edge('a|2','b|1',12,'shared'),edge('a|1','a|2',5,'shared'),edge('a|2','a|1',3,'organization_contact'),edge('missing','b|1',1)],l=layoutPersonnelFlow(layers,links);
 assert.equal(l.ribbons.length,1);assert.equal(l.ribbons[0].returning,true);assert.equal(l.ribbons[0].edge,links[1]);assert.equal(l.ribbons[0].width,32,'same-rank traffic must not distort cross-rank widths');assert.equal(l.nodes.get('a|2').height,76,'local transfers must not inflate node heights');assert.equal(links.length,6,'detail/history facts are preserved');assert.equal(layoutPersonnelFlow(layers,links.filter(e=>e!==links[1])).ribbons.length,0);assert.ok(l.height>400);
});

test('working levels use source-defined IDs without assuming archive statuses or mandatory transitions',()=>{
 const layers=[layer('level:alpha',[cell('level:alpha|group')]),layer('level:beta',[cell('level:beta|project')])],result=layoutPersonnelFlow(layers,[]);
 assert.equal(result.columns[0].layer.id,'level:alpha');assert.equal(result.columns[1].layer.id,'level:beta');assert.equal(result.ribbons.length,0);
});
