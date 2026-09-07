import React from 'react';
export function Icon({name, size=18, ...props}) {
 const paths={
  people:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  org:<><path d="M3 21V7l9-4v18M12 10h9v11M1 21h22M6 9h2M6 13h2M6 17h2M16 14h2M16 18h2"/></>,
  bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  plus:<path d="M12 5v14M5 12h14"/>, close:<path d="m6 6 12 12M18 6 6 18"/>,
  arrow:<path d="m9 5 7 7-7 7"/>, back:<path d="m15 5-7 7 7 7"/>, down:<path d="m6 9 6 6 6-6"/>,
  image:<><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-6-6-9 12"/></>,
  edit:<><path d="m16 3 5 5-13 13H3v-5ZM13 6l5 5"/></>,
  history:<><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
  lock:<><rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
  settings:<><path d="m9 3-1 3-3 1v4l-2 1 2 3v3l4 1 2 2 3-2 4-1v-3l2-3-2-1V7l-3-1-1-3Z"/><circle cx="11.5" cy="12" r="3"/></>,
  agent:<><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M12 3v4M2 11v5M22 11v5M8 16h8"/><circle cx="9" cy="12" r=".5"/><circle cx="15" cy="12" r=".5"/></>,
  more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  check:<path d="m4 12 5 5L20 6"/>, menu:<path d="M3 6h18M3 12h18M3 18h18"/>,
  logout:<><path d="M9 3H3v18h6M10 12h12M17 7l5 5-5 5"/></>,
  copy:<><rect x="8" y="8" width="13" height="13" rx="1"/><path d="M16 8V3H3v13h5"/></>,
  trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  expand:<><path d="M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7"/></>,
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]??paths.more}</svg>;
}
export function Mark({className=''}) { return <svg className={className} width="27" height="29" viewBox="0 0 27 29" aria-hidden="true"><path fill="currentColor" d="M1 1h17v8H9v10H1zM26 10H9v8h9v10h8z"/></svg>; }
