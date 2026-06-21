import { Store } from './storage.js';

export const Teams = (()=> {
  // Slow-pitch softball default: 10 fielders (adds Rover/Short Field).
  // Baseball uses 9 (no Rover). We support both.
  const POSITIONS = [
    {code:'P',  name:'Pitcher'},
    {code:'C',  name:'Catcher'},
    {code:'1B', name:'First Base'},
    {code:'2B', name:'Second Base'},
    {code:'3B', name:'Third Base'},
    {code:'SS', name:'Shortstop'},
    {code:'LF', name:'Left Field'},
    {code:'CF', name:'Center Field'},
    {code:'RF', name:'Right Field'},
    {code:'RV', name:'Rover / Short Field'}, // slow-pitch 10th
    {code:'EH', name:'Extra Hitter'},        // bats, no field
    {code:'BN', name:'Bench'},
  ];
  const uid = p => p+Math.random().toString(36).slice(2,8);

  function createTeam(name, color){
    return { id:uid('t'), name:name||'New Team', color:color||'#d2703a',
             players:[], created:Date.now() };
  }
  function addPlayer(team, {name,num,pos,bats,throws}){
    team.players.push({ id:uid('p'), name:name||'Player', num:num||'',
      pos:pos||'BN', bats:bats||'R', throws:throws||'R' });
  }
  function byId(id){ return Store.get().teams.find(t=>t.id===id); }
  function playerById(team,pid){ return team.players.find(p=>p.id===pid); }

  // A lineup = ordered batting list (player ids) + position map.
  function createLineup(teamId, name){
    const team = byId(teamId);
    return { id:uid('l'), teamId, name:name||'Lineup',
      order: team? team.players.filter(p=>p.pos!=='BN').map(p=>p.id):[],
      defense:{}, created:Date.now() };
  }
  return { POSITIONS, createTeam, addPlayer, byId, playerById, createLineup, uid };
})();

/* ============================================================
   VISUAL IDENTITY — generated crests & avatars (no uploads).
   Every team gets a monogram shield; every player a numbered
   avatar in team colors. This is what makes it feel branded.
   ============================================================ */
