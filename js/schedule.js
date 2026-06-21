import { Store } from './storage.js';

export const Schedule = (()=>{
  const TYPES={
    game:{label:'Game', icon:'⚾', color:'#ff6b35'},
    practice:{label:'Practice', icon:'🧢', color:'#4d9fff'},
    tournament:{label:'Tournament', icon:'🏆', color:'#ffc94d'},
    event:{label:'Event', icon:'📅', color:'#9b8cff'},
  };
  function all(){ return (Store.get().schedule||[]).slice(); }
  function upcoming(){
    const now=Date.now();
    return all().filter(e=>new Date(e.start).getTime()>=now-12*3600*1000)
                .sort((a,b)=>new Date(a.start)-new Date(b.start));
  }
  function past(){
    const now=Date.now();
    return all().filter(e=>new Date(e.start).getTime()<now-12*3600*1000)
                .sort((a,b)=>new Date(b.start)-new Date(a.start));
  }
  function byId(id){ return all().find(e=>e.id===id); }
  let _seq=0;
  function create(data){
    const e=Object.assign({
      id:'ev'+Date.now()+'_'+(_seq++), type:'game', title:'', teamId:null, oppName:'',
      start:new Date().toISOString(), location:'', notes:'',
      seasonId:Store.get().currentSeasonId||null, rsvps:{}
    }, data);
    Store.get().schedule.push(e);
    return e;
  }
  function update(id,data){
    const e=byId(id); if(!e) return null;
    Object.assign(e,data); return e;
  }
  function remove(id){
    const s=Store.get(); s.schedule=s.schedule.filter(e=>e.id!==id);
  }
  function setRsvp(eventId,playerId,status){
    const e=byId(eventId); if(!e) return;
    if(!e.rsvps) e.rsvps={};
    if(status==null) delete e.rsvps[playerId];
    else e.rsvps[playerId]=status;
  }
  // RSVP tally for an event: {in,out,maybe,pending,total}
  function rsvpTally(e){
    const team=e.teamId?Store.get().teams.find(t=>t.id===e.teamId):null;
    const roster=team?team.players:[];
    const r={in:0,out:0,maybe:0,pending:0,total:roster.length};
    roster.forEach(p=>{
      const st=(e.rsvps||{})[p.id];
      if(st==='in') r.in++; else if(st==='out') r.out++;
      else if(st==='maybe') r.maybe++; else r.pending++;
    });
    return r;
  }
  return { TYPES, all, upcoming, past, byId, create, update, remove, setRsvp, rsvpTally };
})();

/* ============================================================
   TOURNAMENTS — single elim, double elim, round robin.
   A tournament has teams[], format, and matches[]. Matches carry
   slots (teamId or {from:'winner'|'loser', match}), scores, winner.
   Advancement is derived: when a match gets a result, dependent
   slots resolve automatically.
   ============================================================ */
