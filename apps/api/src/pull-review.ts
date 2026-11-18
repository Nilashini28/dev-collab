export function summarizeReviews(reviews:Array<{user?:{login?:string};state:string;submitted_at?:string|null;id?:number}>){
 const latest=new Map<string,{state:string;at:number;id:number}>();
 for(const r of reviews){if(!r.user?.login||!r.submitted_at||!['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state))continue;
 const row={state:r.state,at:new Date(r.submitted_at).getTime(),id:r.id??0},before=latest.get(r.user.login);
 if(!before||row.at>before.at||(row.at===before.at&&row.id>before.id))latest.set(r.user.login,row);}
 const states=[...latest.values()].map(r=>r.state);
 return states.includes('CHANGES_REQUESTED')?'CHANGES_REQUESTED':states.includes('APPROVED')?'APPROVED':'NO_REVIEW';
}
