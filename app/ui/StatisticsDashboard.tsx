import React,{useEffect,useMemo,useState} from 'react';
import {defaultStatisticsQuery,shanghaiDate,shiftDate,type StatisticsQuery,type StatisticsResult,type StatisticsGroup} from '../shared/statistics';
import './statistics.css';

const groups: [StatisticsGroup,string][] = [['user','用户优先'],['tag','标签优先'],['category','类别优先'],['type','人物／组织优先']];
const colors = ['#9b482f','#326a83','#58834c','#8662a1','#b38025','#287f79'];
type Props = {load:(query:StatisticsQuery)=>Promise<StatisticsResult>};

export function StatisticsDashboard({load}:Props) {
  const [draft,setDraft]=useState(defaultStatisticsQuery),[query,setQuery]=useState(defaultStatisticsQuery);
  const [data,setData]=useState<StatisticsResult|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [revision,setRevision]=useState(0),[selected,setSelected]=useState<string[]>([]),[cumulative,setCumulative]=useState(false),[hover,setHover]=useState<number|null>(null);
  useEffect(()=>{
    let active=true;setLoading(true);setData(null);setError('');setHover(null);
    load(query).then(result=>{if(active){setData(result);setSelected(result.series.slice(0,5).map(s=>s.id));}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'统计加载失败');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[query,revision,load]);
  function apply(next:StatisticsQuery){setDraft(next);setQuery(next);}
  const lines=useMemo(()=>data?.series.filter(s=>selected.includes(s.id)).map(s=>{
    let sum=0;return {...s,points:s.points.map(n=>cumulative?(sum+=n):n)};
  })??[],[data,selected,cumulative]);
  const maximum=Math.max(1,...lines.flatMap(s=>s.points));
  const ceiling=Math.ceil(maximum/4)*4;
  const x=(i:number)=>60+(data!.dates.length===1?410:i*820/(data!.dates.length-1));
  const y=(n:number)=>270-n/ceiling*220;
  const focusDay=hover===null?null:data?.dates[hover];
  function toggle(id:string){setSelected(old=>old.includes(id)?old.filter(x=>x!==id):old.length<6?[...old,id]:old);}
  return <main className="statistics-page">
    <header className="statistics-heading"><div><p>协作记录 · 数据概览</p><h1>统计仪表盘</h1></div><button className="button" onClick={()=>setRevision(v=>v+1)} disabled={loading}>刷新统计</button></header>
    <div className="statistics-modes" aria-label="统计分组">{groups.map(([key,label])=><button key={key} aria-pressed={query.group===key} onClick={()=>apply({...draft,group:key,search:''})}>{label}</button>)}</div>
    <form className="statistics-filters" onSubmit={e=>{e.preventDefault();apply({...draft});}}>
      <label>开始日期<input type="date" required value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
      <label>结束日期<input type="date" required min={draft.from} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
      <label>时间粒度<select aria-label="时间粒度" value={draft.interval} onChange={e=>setDraft({...draft,interval:e.target.value as StatisticsQuery['interval']})}><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select></label>
      <label>档案类型<select aria-label="档案类型" value={draft.archive_type} onChange={e=>setDraft({...draft,archive_type:e.target.value as StatisticsQuery['archive_type']})}><option value="all">全部档案</option><option value="person">人物</option><option value="org">组织</option></select></label>
      <label className="statistics-search">搜索分组<input maxLength={100} placeholder="输入用户、标签或类别名称" value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})}/></label>
      <button className="button primary" type="submit">应用筛选</button>
      <div className="statistics-presets">{[7,30,90,365].map(days=><button className="button quiet" type="button" key={days} onClick={()=>{const to=shanghaiDate();apply({...draft,from:shiftDate(to,1-days),to});}}>近 {days} 天</button>)}</div>
    </form>
    {loading&&<p role="status" className="statistics-empty">正在汇总提交记录…</p>}
    {error&&<div role="alert" className="statistics-empty"><p>{error}</p><button className="button" onClick={()=>setRevision(v=>v+1)}>重试</button></div>}
    {data&&<>
      <section className="statistics-summary" aria-label="统计概览">{[[data.total,'观察记录'],[data.members,'提交成员'],[data.archives,'涉及档案'],[data.groups,'统计分组']].map(([value,label])=><div key={label}><strong>{Number(value).toLocaleString('zh-CN')}</strong><span>{label}</span></div>)}</section>
      <section className="statistics-chart-card" aria-label="提交趋势">
        <header><div><h2>提交趋势</h2><p>{query.from} — {query.to} · 东八区</p></div><label><input type="checkbox" checked={cumulative} onChange={e=>setCumulative(e.target.checked)}/> 区间累计</label></header>
        {!data.total?<p className="statistics-empty">此范围内暂无观察记录，试试扩大时间范围或清除搜索。</p>:<>
          {!lines.length?<p className="statistics-empty">在下方明细中选择要对比的分组。</p>:<>
            <div className="statistics-chart-scroll"><svg className="statistics-chart" viewBox="0 0 920 320" role="img" aria-label={`${cumulative?'累计':'新增'}观察记录折线图，精确值见下方逐期数据表`} onMouseLeave={()=>setHover(null)}>
              {[0,1,2,3,4].map(i=><g key={i}><line x1="60" x2="880" y1={y(i*ceiling/4)} y2={y(i*ceiling/4)} stroke="#e6e5df"/><text x="45" y={y(i*ceiling/4)+4} textAnchor="end">{i*ceiling/4}</text></g>)}
              <text x="60" y="25">记录数（条）</text>
              {data.dates.map((date,i)=>(i===0||i===data.dates.length-1||i%Math.max(1,Math.ceil(data.dates.length/6))===0)&&<text key={date} x={x(i)} y="302" textAnchor="middle">{date.slice(5)}</text>)}
              {lines.map((line,index)=><g key={line.id}><polyline fill="none" stroke={colors[index]} strokeWidth="2.5" points={line.points.map((n,i)=>`${x(i)},${y(n)}`).join(' ')}/>{line.points.map((n,i)=><circle key={i} cx={x(i)} cy={y(n)} r={data.dates.length>90?1.5:3} fill={colors[index]}><title>{line.name} · {data.dates[i]}：{n} 条</title></circle>)}</g>)}
              {hover!==null&&<line x1={x(hover)} x2={x(hover)} y1="42" y2="270" stroke="#888" strokeDasharray="4 4"/>}
              <rect x="50" y="40" width="840" height="240" fill="transparent" onMouseMove={e=>{const svg=e.currentTarget.ownerSVGElement!;const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const local=point.matrixTransform(svg.getScreenCTM()!.inverse());setHover(Math.max(0,Math.min(data.dates.length-1,Math.round((local.x-60)/820*(data.dates.length-1)))));}}/>
            </svg></div>
            <div className="statistics-legend" aria-live="polite">{focusDay&&<strong>{focusDay}</strong>}{lines.map((line,i)=><span key={line.id}><i style={{background:colors[i]}}/>{line.name}{hover!==null&&<b>{line.points[hover]} 条</b>}</span>)}</div>
          </>}
        </>}
      </section>
      <section className="statistics-details"><header><h2>分组明细</h2><span>选择最多 6 条曲线 · 默认显示前 5 组</span></header>
        {data.groups>50&&<p role="status">当前展示记录数最多的 50 组，共 {data.groups} 组。搜索名称可查看其他分组。</p>}
        <div className="statistics-table-scroll"><table><thead><tr><th>对比</th><th>{groups.find(g=>g[0]===query.group)?.[1].replace('优先','')}</th><th>记录数</th><th>占去重总数</th></tr></thead><tbody>{data.series.map(s=><tr key={s.id}><td><input type="checkbox" aria-label={`对比 ${s.name}`} checked={selected.includes(s.id)} disabled={!selected.includes(s.id)&&selected.length>=6} onChange={()=>toggle(s.id)}/></td><th scope="row">{s.name}</th><td>{s.total}</td><td>{data.total?(100*s.total/data.total).toFixed(1):'0.0'}%</td></tr>)}</tbody></table></div>
        {!data.series.length&&<p className="statistics-empty">没有匹配的分组</p>}
      </section>
      {!!lines.length&&<details className="statistics-periods"><summary>查看逐期数据</summary><div className="statistics-table-scroll"><table><thead><tr><th>周期起始日</th>{lines.map(s=><th key={s.id}>{s.name}</th>)}</tr></thead><tbody>{data.dates.map((date,i)=><tr key={date}><th scope="row">{date}</th>{lines.map(s=><td key={s.id}>{s.points[i]}</td>)}</tr>)}</tbody></table></div></details>}
    </>}
    <p className="statistics-note">按观察记录的首次提交时间统计，编辑、草稿和已删除内容不计入。标签及类别按档案当前可见绑定归类，关闭档案使用关闭时的标签；同组内去重，跨组可能重复，总记录数单独去重。周从星期一开始，累计值仅计算所选区间。</p>
  </main>;
}
