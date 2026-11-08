import {ScrollRegion} from './ScrollRegion';
import type {WeeklyReportFormat} from '../shared/weekly-report';
import React,{useEffect,useMemo,useState,type ReactNode} from 'react';
import {defaultComparison,ownFirst,defaultStatisticsQuery,type StatisticsQuery,type StatisticsResult} from '../shared/statistics';
import './statistics.css';
import './share-link.css';

const groupLabels={user:'成员',tag:'标签',type:'人物／组织'};
const colors = ['#9b482f','#326a83','#58834c','#8662a1','#b38025','#287f79','#c0507a','#4c6fb0','#d07a30','#6f9b46','#7b5ba6','#b05555'];
type Props = {load:(query:StatisticsQuery)=>Promise<StatisticsResult>;getLink?:()=>Promise<string>;renderCharts?:(trend:ReactNode,state:{archiveType:StatisticsQuery['archive_type'];revision:number;refresh:()=>void})=>ReactNode;initialData?:StatisticsResult;initialQuery?:StatisticsQuery;report?:boolean;exportWeekly?:(query:StatisticsQuery,format:WeeklyReportFormat,target:Window|null)=>Promise<void>};

export function StatisticsDashboard({load,getLink,renderCharts,initialData,initialQuery,report=false,exportWeekly}:Props) {
  const [query]=useState(initialQuery??defaultStatisticsQuery);
  const [data,setData]=useState<StatisticsResult|null>(initialData??null),[loading,setLoading]=useState(!initialData),[error,setError]=useState('');
  const [revision,setRevision]=useState(0),[selected,setSelected]=useState<string[]>(initialData?defaultComparison(initialData):[]),[cumulative,setCumulative]=useState(false),[hover,setHover]=useState<number|null>(null),[lineHover,setLineHover]=useState<string|null>(null),[copied,setCopied]=useState(false);
  const [exportFormat,setExportFormat]=useState<WeeklyReportFormat>('pdf');
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  useEffect(()=>{
    if(report)return;
    let active=true;setLoading(true);setData(null);setError('');setHover(null);setLineHover(null);
    load(query).then(result=>{if(active){setData(result);setSelected(defaultComparison(result));}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'统计加载失败');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[query,revision,load,report]);
  async function copyLink(){if(!getLink)return;try{const link=new URL(await getLink());Object.entries(query).forEach(([key,value])=>link.searchParams.set(key,value));await navigator.clipboard.writeText(link.toString());setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{/* clipboard unavailable */}}
  const lines=useMemo(()=>data&&ownFirst(data).filter(s=>selected.includes(s.id)).map(s=>{
    let sum=0;return {...s,points:s.points.map(n=>cumulative?(sum+=n):n)};
  })||[],[data,selected,cumulative]);
  const maximum=Math.max(1,...lines.flatMap(s=>s.points));
  const ceiling=Math.ceil(maximum/4)*4;
  const x=(i:number)=>60+(data!.dates.length===1?410:i*820/(data!.dates.length-1));
  const y=(n:number)=>270-n/ceiling*220;
  const focusDay=hover===null?null:data?.dates[hover];
  function toggle(id:string){setLineHover(null);setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);}
  const memberName=(s:StatisticsResult['series'][number])=>!report&&s.archive_path?<a className="statistics-archive-link" href={s.archive_path}>{s.name}</a>:s.name;
  const detailTables=data?<section className="statistics-all-members" aria-label="统计明细"><section className="statistics-details">

        <ScrollRegion className="statistics-table-scroll" label="成员明细" rows="tbody tr" report={report}><table><thead><tr><th>对比</th><th>{groupLabels[query.group]}</th><th>记录数</th><th>占去重总数</th></tr></thead><tbody>{ownFirst(data).map(s=><tr key={s.id} className={s.id===data.viewer_id?'statistics-self':undefined}><td><input type="checkbox" aria-label={`对比 ${s.name}`} checked={selected.includes(s.id)} onChange={()=>toggle(s.id)}/></td><th scope="row">{memberName(s)}{s.id===data.viewer_id&&<small>我</small>}</th><td>{s.total}</td><td>{data.total?(100*s.total/data.total).toFixed(1):'0.0'}%</td></tr>)}</tbody></table></ScrollRegion>
        {!data.series.length&&<p className="statistics-empty">没有匹配的分组</p>}
      </section>
      {!!lines.length&&<details className="statistics-periods" open={report||undefined}><summary>查看逐期数据</summary><ScrollRegion className="statistics-table-scroll" label="逐期数据" rows="tbody tr" report={report}><table><thead><tr><th>周期起始日</th>{lines.map(s=><th key={s.id}>{memberName(s)}</th>)}</tr></thead><tbody>{data.dates.map((date,i)=><tr key={date}><th scope="row">{date}</th>{lines.map(s=><td key={s.id}>{s.points[i]}</td>)}</tr>)}</tbody></table></ScrollRegion></details>}
</section>:null;
  const trend=data?<section className="statistics-trend" aria-label="提交趋势与明细">
      <section className="statistics-chart-card" aria-label="提交趋势">
        <header><div><h2>提交趋势</h2><p>{query.from} — {query.to}</p></div><div className="statistics-cumulative" role="group" aria-label="折线模式"><button type="button" aria-pressed={!cumulative} onClick={()=>setCumulative(false)}>新增</button><button type="button" aria-pressed={cumulative} onClick={()=>setCumulative(true)}>累计</button></div></header>
        {!data.total?<p className="statistics-empty">暂无观察记录</p>:<>
          {!lines.length?<p className="statistics-empty">请选择对比成员</p>:<>
            <div className="statistics-chart-scroll"><svg className="statistics-chart" viewBox="0 0 920 320" role="img" aria-label={`${cumulative?'累计':'新增'}观察记录折线图`} onMouseLeave={()=>{setHover(null);setLineHover(null);}} onMouseMove={e=>{const svg=e.currentTarget;const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const local=point.matrixTransform(svg.getScreenCTM()!.inverse());setHover(Math.max(0,Math.min(data.dates.length-1,Math.round((local.x-60)/820*(data.dates.length-1)))));}}>
              {[0,1,2,3,4].map(i=><g key={i}><line x1="60" x2="880" y1={y(i*ceiling/4)} y2={y(i*ceiling/4)} stroke="#e6e5df"/><text x="45" y={y(i*ceiling/4)+4} textAnchor="end">{i*ceiling/4}</text></g>)}
              <text x="60" y="25">记录数（条）</text>
              {data.dates.map((date,i)=>(i===0||i===data.dates.length-1||i%Math.max(1,Math.ceil(data.dates.length/6))===0)&&<text key={date} x={x(i)} y="302" textAnchor="middle">{date.slice(5)}</text>)}
              {lines.map((line,index)=>{const active=lineHover===line.id,dim=lineHover!==null&&!active,color=colors[index % colors.length],pts=line.points.map((n,i)=>`${x(i)},${y(n)}`).join(' ');return <g key={line.id} onMouseEnter={()=>setLineHover(line.id)} onMouseLeave={()=>setLineHover(null)}><polyline fill="none" stroke="transparent" strokeWidth="16" points={pts} style={{pointerEvents:'stroke'}}/><polyline fill="none" stroke={color} strokeWidth={active?4.5:2.5} points={pts} className="statistics-line" style={{opacity:dim?0.2:1,pointerEvents:'none'}}/>{line.points.map((n,i)=><circle key={i} cx={x(i)} cy={y(n)} r={(data.dates.length>90?1.5:3)+(active?1.6:0)} fill={color} style={{opacity:dim?0.2:1,pointerEvents:'none'}}/>)}</g>;})}
              {hover!==null&&<line x1={x(hover)} x2={x(hover)} y1="42" y2="270" stroke="#888" strokeDasharray="4 4"/>}
            </svg></div>
            <div className="statistics-legend" aria-live="polite">{focusDay&&<strong>{focusDay}</strong>}{lines.map((line,i)=>{const active=lineHover===line.id,dim=lineHover!==null&&!active;return <span key={line.id} className={active?'statistics-legend-active':dim?'statistics-legend-dim':undefined}><i style={{background:colors[i % colors.length]}}/>{memberName(line)}{hover!==null&&<b>{line.points[hover]} 条</b>}</span>;})}</div>
          </>}
        </>}
      </section>
{detailTables}</section>:<section className="statistics-trend" aria-label="提交趋势与明细"><h2>提交趋势</h2><p className="statistics-empty">{loading?'正在汇总…':'提交统计暂不可用'}</p></section>;
  async function download(){if(!exportWeekly)return;setExporting(true);setExportError('');let target:Window|null=null;try{if(exportFormat==='pdf'){target=window.open('','_blank');if(!target)throw new Error('请允许打开周报窗口，再另存为 PDF');target.document.body.textContent='正在准备本周周报…';}await exportWeekly(query,exportFormat,target);}catch(e){target?.close();setExportError((e as Error).message);}finally{setExporting(false);}}
  return <main className={`statistics-page ${renderCharts?'unified-statistics':''} ${report?'statistics-report':''}`}>
    {!report&&<header className="statistics-heading"><div><h1>统计仪表盘</h1></div><div className="statistics-heading-actions">{exportWeekly&&<><select aria-label="周报格式" value={exportFormat} onChange={e=>setExportFormat(e.target.value as WeeklyReportFormat)} disabled={exporting}><option value="pdf">PDF</option><option value="json">JSON</option></select><button className="button primary" onClick={()=>void download()} disabled={exporting}>{exporting?'正在导出…':'导出本周周报'}</button></>}{getLink&&<button className="button quiet" type="button" onClick={copyLink}>{copied?'已复制':'复制链接'}</button>}<button className="button" onClick={()=>setRevision(v=>v+1)} disabled={loading}>刷新统计</button></div></header>}
    {exportError&&<p className="form-error" role="alert">{exportError}</p>}
    {loading&&<p role="status" className="statistics-empty">正在汇总提交记录…</p>}
    {error&&<div role="alert" className="statistics-empty"><p>{error}</p><button className="button" onClick={()=>setRevision(v=>v+1)}>重试</button></div>}
    {data&&<>
      <section className="statistics-summary" aria-label="统计概览">{[[data.total,'观察记录'],[data.members,'提交成员'],[data.archives,'涉及档案'],[data.groups,'统计分组']].map(([value,label])=><div key={label}><strong>{Number(value).toLocaleString('zh-CN')}</strong><span>{label}</span></div>)}</section>
    </>}
    {renderCharts?renderCharts(trend,{archiveType:query.archive_type,revision,refresh:()=>setRevision(v=>v+1)}):trend}

  </main>;
}
