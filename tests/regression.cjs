const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).filter(Boolean).at(-1).replace(/render\(\);\s*$/, '');

function app(saved, savedTimer) {
  const values = new Map(saved ? [['molkky_so_v2', saved]] : []);
  if(savedTimer) values.set('molkky_throw_timer_v1',savedTimer);
  const inputs = {};
  const alerts=[];
  const ctx = vm.createContext({
    localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) },
    BroadcastChannel: function () { this.postMessage = () => {}; },
    document: { getElementById: id => inputs[id] || null,
      querySelectorAll: selector => Object.values(inputs).filter(input => selector !== '[data-member-team]' || input.dataset?.memberTeam !== undefined) }, window: {}, Date, alert:msg=>alerts.push(msg),
    location: {origin:'http://localhost:8000',pathname:'/index.html'},
  });
  vm.runInContext(source, ctx);
  vm.runInContext(`render = () => {}; broadcastState = () => {};
    function fresh(mode='match', count=2) {
      S = {phase:'playing', settings:{teamCount:count, targetScore:50, maxMiss:3,
        gameName:'', regMode:mode, regN:3}, teams:[], currentTeamIdx:0,
        turnCount:0, currentSet:1, setResults:[], history:[], winnerId:null,
        lastSetWinnerId:null, finishedAt:null};
      S.teams = initTeams(Array.from({length:count}, (_,i) => 'Team '+i));
      _orderDraft = null;
    }
    function state() { return {phase:S.phase,teams:S.teams,currentTeamIdx:S.currentTeamIdx,
      turnCount:S.turnCount,currentSet:S.currentSet,setResults:S.setResults,
      winnerId:S.winnerId,lastSetWinnerId:S.lastSetWinnerId,finishedAt:S.finishedAt}; }
  `, ctx);
  return {
    run: code => vm.runInContext(code, ctx),
    json: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, ctx)),
    inputs, values, alerts,
  };
}

for (const mode of ['match', 'first', 'total']) {
  test(`${mode}: undo a winning throw restores the complete set state`, () => {
    const a = app();
    a.run(`fresh('${mode}'); applyThrow(0,10); applyThrow(1,5); S.teams[0].score=49;`);
    const before = a.json('state()');
    a.run('applyThrow(0,1)');
    assert.equal(a.run('S.phase'), 'set_finished');
    a.run('getOrderDraft(); undoLastThrow()');
    assert.deepEqual(a.json('state()'), before);
    a.run('applyThrow(0,1)');
    assert.equal(a.run('S.setResults.length'), 1);
    assert.equal(a.run('S.teams[0].setWins'), 1);
    assert.equal(a.run('S.teams[0].setTotalScore'), 50);
  });
}

test('undo elimination restores both teams, including the awarded winner score', () => {
  const a = app();
  a.run(`fresh(); applyThrow(0,4); applyThrow(1,5);
    applyThrow(0,0); applyThrow(1,0); applyThrow(0,0); applyThrow(1,0);`);
  const before = a.json('state()');
  a.run('applyThrow(0,0); undoLastThrow()');
  assert.deepEqual(a.json('state()'), before);
  a.run('undoLastThrow()');
  assert.equal(a.run('S.currentTeamIdx'), 1);
  assert.equal(a.run('S.teams[1].missStreak'), 1);
});

test('undo restores a zero-score survivor with no throws', () => {
  const a = app();
  a.run('fresh(); S.settings.maxMiss=1;');
  const before = a.json('state()');
  a.run('applyThrow(0,0); undoLastThrow()');
  assert.deepEqual(a.json('state()'), before);
});

test('undo preserves previous results and handles rotated IDs and earlier eliminations', () => {
  const a = app();
  a.run(`fresh('match',3); S.teams[0].score=49; applyThrow(0,1); nextSet();
    S.settings.maxMiss=1; applyThrow(0,0); applyThrow(1,10);`);
  const before = a.json('state()');
  a.run('applyThrow(2,0); undoLastThrow()');
  assert.deepEqual(a.json('state()'), before);
  assert.equal(a.run('S.setResults.length'), 1);
});

test('undo after reload restores a completed set from persisted state', () => {
  const a = app();
  a.run('fresh(); S.teams[0].score=49;');
  const before = a.json('state()');
  a.run('applyThrow(0,1)');
  const b = app(a.values.get('molkky_so_v2'));
  b.run('undoLastThrow()');
  assert.deepEqual(b.json('state()'), before);
});

test('ordinary throws and bursts remain undoable repeatedly', () => {
  const a = app();
  a.run('fresh(); S.teams[0].score=45;');
  const before = a.json('state()');
  a.run('applyThrow(0,6); applyThrow(1,0); undoLastThrow(); undoLastThrow();');
  assert.deepEqual(a.json('state()'), before);
});

test('uniform mode still restores the snapshot after completing a set', () => {
  const a = app();
  a.run("fresh('uniform'); S.settings.targetScore=100; S.teams[0].score=49;");
  const before = a.json('state()');
  a.run('applyThrow(0,1); undoLastThrow()');
  const after = a.json('state()');
  // 均一モードの既存スナップショットはlastSetWinnerIdを含まない。
  delete after.lastSetWinnerId; delete before.lastSetWinnerId;
  assert.deepEqual(after, before);
});

function setup(a) {
  a.run("fresh(); S.phase='setup'; S.teams=[];");
  for (const [id, value] of Object.entries({
    'game-name':'決勝', 'team-name-0':'Alpha', 'team-name-1':'Beta',
    'target-score':'60', 'max-miss':'4',
  })) a.inputs[id] = { value };
}

for (const action of ["setRegulation('match',5)", "switchRegMode('first')", "switchTab('history')", 'updateTeamCount(3)']) {
  test(`setup retains typed values across ${action}`, () => {
    const a = app(); setup(a);
    a.run(action);
    assert.equal(a.run('S.settings.gameName'), '決勝');
    assert.equal(a.run('S.teams[0].name'), 'Alpha');
    assert.equal(a.run('S.teams[1].name'), 'Beta');
    assert.equal(a.run('S.settings.targetScore'), 60);
    assert.equal(a.run('S.settings.maxMiss'), 4);
    assert.match(a.run('buildSetup()'), /value="Alpha"/);
    assert.match(a.run('buildSetup()'), /value="決勝"/);
  });
}

test('switching to uniform keeps names/misses and uses the selected target', () => {
  const a = app(); setup(a);
  a.run("switchRegMode('uniform'); setUniformTarget(150)");
  assert.equal(a.run('S.settings.targetScore'), 150);
  assert.equal(a.run('S.settings.maxMiss'), 4);
  assert.equal(a.run('S.teams[1].name'), 'Beta');
});

test('captured input survives reload and is used when starting', () => {
  const a = app(); setup(a);
  a.run('captureSetupInputs()');
  const b = app(a.values.get('molkky_so_v2'));
  assert.equal(b.run('S.settings.gameName'), '決勝');
  assert.equal(b.run('S.teams[1].name'), 'Beta');
  a.run('onStartGame()');
  assert.equal(a.run('S.settings.targetScore'), 60);
  assert.equal(a.run('S.settings.maxMiss'), 4);
  assert.equal(a.run('S.teams[0].name'), 'Alpha');
});


test('clearing the trial name is retained instead of restoring the previous name', () => {
  const a = app(); setup(a);
  a.values.set('molkky_game_name', '以前の試合');
  a.inputs['game-name'].value = '';
  a.run("setRegulation('match',2)");
  assert.equal(a.run('S.settings.gameName'), '');
  assert.doesNotMatch(a.run('buildSetup()'), /以前の試合/);
});


test('input listeners persist edits without needing a settings change', () => {
  const a = app(); setup(a);
  const listeners = {};
  for (const [id, input] of Object.entries(a.inputs)) {
    input.addEventListener = (event, handler) => { listeners[id] = handler; };
  }
  a.run('bindEvents()');
  a.inputs['team-name-0'].value = 'New name';
  listeners['team-name-0']();
  const saved = JSON.parse(a.values.get('molkky_so_v2'));
  assert.equal(saved.teams[0].name, 'New name');
  assert.equal(saved.settings.gameName, '決勝');
});


for (const [input, expected] of [[120,100], [175,150], [75,50], [0,50], [-50,50], [5000,5000], [150.9,150]]) {
  test(`uniform target ${input} becomes ${expected} on blur and in saved state`, () => {
    const a = app(); setup(a);
    a.run("switchRegMode('uniform')");
    a.inputs['reg-value'] = {value: String(input)};
    a.run("normalizeRegInput(document.getElementById('reg-value'))");
    assert.equal(Number(a.inputs['reg-value'].value), expected);
    assert.equal(a.run('S.settings.targetScore'), expected);
    assert.equal(a.run('S.settings.regN'), expected / 50);
    const saved = JSON.parse(a.values.get('molkky_so_v2'));
    assert.equal(saved.settings.targetScore, expected);
  });
}

for (const mode of ['match','first','total']) {
  test(`${mode} supports large set counts without proportional display allocation`, () => {
    const a = app(); setup(a);
    a.run(`switchRegMode('${mode}')`);
    a.inputs['reg-value'] = {value: '100000'};
    a.run('onStartGame()');
    assert.equal(a.run('S.settings.regN'), 100000);
    a.run('S.teams[0].setWins=1; S.teams[0].setTotalScore=50; S.setResults=[{}]');
    assert.ok(a.run('buildPlaying().length') < 25000);
  });
}

test('game name clear removes the separately saved name and keeps team data', () => {
  const a = app(); setup(a);
  a.values.set('molkky_game_name','古い試合');
  a.run("clearSetupField('game')");
  const b = app(a.values.get('molkky_so_v2'));
  assert.equal(b.run('S.settings.gameName'), '');
  assert.equal(a.values.get('molkky_game_name'), '');
  assert.equal(b.run('S.teams[0].name'), 'Alpha');
  assert.equal(b.run('S.settings.maxMiss'), 4);
});

test('clearing one team keeps its identity, order and all other fields', () => {
  const a = app(); setup(a);
  a.run('captureSetupInputs()');
  const before = a.json('S.teams.map(t => ({id:t.id,colorIdx:t.colorIdx}))');
  a.run('clearSetupField(1)');
  assert.equal(a.run('S.teams[1].name'), '');
  assert.equal(a.run('S.teams[0].name'), 'Alpha');
  assert.equal(a.run('S.settings.gameName'), '決勝');
  assert.deepEqual(a.json('S.teams.map(t => ({id:t.id,colorIdx:t.colorIdx}))'), before);
});

test('reordered identities and colors survive start, reload, rotation and rematch', () => {
  const a = app(); setup(a);
  a.run('moveSetupTeam(1,0)');
  assert.deepEqual(a.json('S.teams.map(t=>t.name)'), ['Beta','Alpha']);
  // Simulate the form fields produced by the real render after moving teams.
  a.inputs['team-name-0'].value = 'Beta'; a.inputs['team-name-1'].value = 'Alpha';
  a.run('onStartGame()');
  assert.deepEqual(a.json('S.initialOrder'), [1,0]);
  assert.deepEqual(a.json('S.teams.map(t=>t.colorIdx)'), [1,0]);
  const b = app(a.values.get('molkky_so_v2'));
  b.run('S.teams[0].score=59; applyThrow(0,1); nextSet()');
  assert.deepEqual(b.json('S.teams.map(t=>t.id)'), [0,1]);
  b.run('rematch()');
  assert.deepEqual(b.json('S.teams.map(t=>t.id)'), [1,0]);
  assert.deepEqual(b.json('S.teams.map(t=>t.name)'), ['Beta','Alpha']);
});

test('changing team count after reordering keeps IDs and colors unique', () => {
  const a = app(); setup(a);
  a.run('moveSetupTeam(1,0)');
  a.inputs['team-name-0'].value = 'Beta'; a.inputs['team-name-1'].value = 'Alpha';
  a.run('updateTeamCount(3)');
  assert.deepEqual(a.json('S.teams.map(t=>t.id)'), [1,0,2]);
  assert.deepEqual(a.json('S.teams.map(t=>t.colorIdx)'), [1,0,2]);
});

function primeMatch() {
  const a = app();
  a.run(`fresh('prime'); enforceRegulationSettings();
    function winPrimeSet(id) {
      const idx = S.teams.findIndex(t => t.id === id);
      S.currentTeamIdx = idx; S.teams[idx].score = 49;
      applyThrow(idx,1);
    }
  `);
  return a;
}
function playPrime(a, winners) {
  for (const id of winners) {
    if (a.run('S.phase') === 'set_finished') a.run('nextSet()');
    a.run(`winPrimeSet(${id})`);
  }
}

for (const winner of [0,1]) {
  for (const losses of [0,1,2]) {
    test(`prime ends at 4-${losses} for team ${winner}`, () => {
      const a = primeMatch();
      playPrime(a, [...Array(losses).fill(1-winner), ...Array(4).fill(winner)]);
      assert.equal(a.run('S.phase'), 'finished');
      assert.equal(a.run('S.winnerId'), winner);
      assert.equal(a.run('S.setResults.length'), 4+losses);
      assert.equal(a.run('S.history.length'), 1);
      assert.equal(a.run('primeExtended()'), false);
      assert.match(a.run('buildHistoryTab()'), /プライム/);
    });
  }
}

test('all 3-3 prefixes continue through 4-3 and finish at 5-3, 4-4 or 3-5', () => {
  for (let mask=0; mask<64; mask++) {
    const prefix = Array.from({length:6}, (_,i)=>(mask>>i)&1);
    if (prefix.filter(id=>id===0).length !== 3) continue;
    for (const tail of [[0,0],[0,1],[1,0],[1,1]]) {
      const a = primeMatch(); playPrime(a,prefix);
      assert.equal(a.run('S.phase'), 'set_finished');
      assert.equal(a.run('primeExtended()'), true);
      playPrime(a,[tail[0]]);
      assert.equal(a.run('S.phase'), 'set_finished');
      assert.equal(a.run('S.history.length'), 0);
      assert.match(a.run('buildSetProgress()'), /セット 7\/8/);
      playPrime(a,[tail[1]]);
      assert.equal(a.run('S.phase'), 'finished');
      assert.equal(a.run('S.setResults.length'), 8);
      assert.equal(a.run('S.winnerId'), tail[0]===tail[1] ? tail[0] : null);
      assert.equal(a.run('S.history[0].setResults.length'), 8);
      assert.match(a.run('buildHistoryTab()'), /プライム/);
    }
  }
});

test('undo at 3-3 cancels extension, allowing a corrected 4-2 finish', () => {
  const a = primeMatch(); playPrime(a,[0,0,0,1,1,1]);
  assert.equal(a.run('primeExtended()'), true);
  a.run('undoLastThrow()');
  assert.equal(a.run('primeExtended()'), false);
  assert.deepEqual(a.json('S.teams.map(t=>t.setWins).sort()'), [2,3]);
  a.run('winPrimeSet(0)');
  assert.equal(a.run('S.phase'), 'finished');
  assert.equal(a.run('S.winnerId'), 0);
  assert.equal(a.run('S.setResults.length'), 6);
});

test('reload at 4-3 retains extension and undo returns to 3-3', () => {
  const a = primeMatch(); playPrime(a,[0,1,0,1,0,1,0]);
  const b = app(a.values.get('molkky_so_v2'));
  assert.equal(b.run('primeExtended()'), true);
  assert.equal(b.run('getPublicState().primeExtended'), true);
  b.run('undoLastThrow()');
  assert.equal(b.run('primeExtended()'), true);
  assert.equal(b.run('S.phase'), 'playing');
  assert.equal(b.run('S.setResults.length'), 6);
});

test('prime fixes setup at two teams, four sets, 50 points and three misses', () => {
  const a = app(); setup(a);
  a.run("updateTeamCount(3); switchRegMode('prime')");
  assert.deepEqual(a.json('[S.settings.teamCount,S.settings.regN,S.settings.targetScore,S.settings.maxMiss]'), [2,4,50,3]);
  assert.equal(a.run('S.teams.length'), 2);
  const html = a.run('buildSetup()');
  for (const id of ['team-count-select','reg-value','target-score','max-miss']) {
    assert.match(html, new RegExp(`<[^>]*id="${id}"[^>]*disabled`));
  }
  a.run('updateTeamCount(6)');
  assert.equal(a.run('S.settings.teamCount'), 2);
  a.run("switchRegMode('first')");
  assert.equal(a.run('S.settings.regN'), 2);
  for (const id of ['team-count-select','reg-value','target-score','max-miss']) {
    assert.doesNotMatch(a.run('buildSetup()'), new RegExp(`<[^>]*id="${id}"[^>]*disabled`));
  }
});


function teamRecordApp(mode='match', count=2) {
  const a=app();a.run(`fresh('${mode}',${count});
    S.teams[0].members=[{id:0,name:'A',active:true},{id:1,name:'B',active:false},{id:2,name:'C',active:true}];
    S.startedAt=1000; beginSheetSet();`);return a;
}
function play(a,points) {for(const p of points)a.run(`applyThrow(S.currentTeamIdx,${p})`);}
test('optional rosters rotate active members, snapshot identity per throw, undo and reload',()=>{
  const a=teamRecordApp();play(a,[12,1,0,1]);
  assert.deepEqual(a.json('S.teams[0].history.map(h=>[h.memberId,h.memberName,h.points])'),[[0,'A',12],[2,'C',0]]);
  assert.equal(a.run('S.teams[1].history[0].memberId'),undefined);
  assert.equal(a.run('currentMember(S.teams[0]).name'),'A');
  a.run('undoLastThrow();undoLastThrow()');assert.equal(a.run('currentMember(S.teams[0]).name'),'C');
  const b=app(a.values.get('molkky_so_v2'));assert.equal(b.run('currentMember(S.teams[0]).name'),'C');
  assert.equal(b.run('typeof correctThrowMember'),'undefined');
});
test('roster selection and next-set ordering persist without altering completed sheet',()=>{
  const a=teamRecordApp();play(a,[10,1,10,1,10,1,10,1,10]);
  assert.equal(a.run('S.phase'),'set_finished');
  a.run('moveMember(0,2,0,true); toggleMemberParticipation(0,1,true)');
  const b=app(a.values.get('molkky_so_v2'));b.run('nextSet()');
  assert.deepEqual(b.json('S.teams.find(t=>t.id===0).members.map(m=>[m.name,m.active])'),[['C',true],['A',false],['B',false]]);
  assert.equal(b.run('S.setResults[0].scores.find(sc=>sc.teamId===0).members[0].name'),'A');
  assert.equal(b.run('mayEditSet(1)'),false);assert.equal(b.run('mayEditSet(2)'),true);
  b.run('rematch()');assert.equal(b.run('currentMember(S.teams.find(t=>t.id===0)).name'),'C');
});
test('registered team requires at least one participant; unregistered opponent remains valid',()=>{
  const a=teamRecordApp();a.run("S.phase='setup'; S.teams[0].members.forEach(m=>m.active=false)");
  assert.equal(a.run('validMemberSelection()'),false);assert.equal(a.alerts.length,1);
  a.run('S.teams[0].members[1].active=true');assert.equal(a.run('validMemberSelection()'),true);
});
test('member name inputs survive setup actions and duplicate names retain separate IDs',()=>{
  const a=app();setup(a);a.run('addMember(0);addMember(0);addMember(0)');
  a.inputs.a={value:'Same',dataset:{memberTeam:'0',memberId:'0'}};
  a.inputs.b={value:'Same',dataset:{memberTeam:'0',memberId:'1'}};
  a.run('moveMember(0,1,0); switchRegMode("first"); startGame()');
  assert.deepEqual(a.json('S.teams[0].members.map(m=>[m.id,m.name])'),[[1,'Same'],[0,'Same']]);
});
test('score correction recalculates later totals/burst and preserves member attribution',()=>{
  const a=teamRecordApp();play(a,[12,1,12,1,12,1,12]);
  const memberBefore=a.json('S.teams[0].history.map(h=>h.memberId)');
  a.run('applyReplayedSet(proposeScoreEdit(0,0,1))');
  assert.equal(a.run('S.teams[0].score'),37);assert.deepEqual(a.json('S.teams[0].history.map(h=>h.memberId)'),memberBefore);
  assert.equal(a.run('S.teams[0].history[3].prevScore'),25);
  a.run('undoLastThrow()');assert.equal(a.run('S.teams[0].score'),25);
  assert.equal(a.run('currentMember(S.teams[0]).name'),'C');
});
test('normal custom target bursts reset to 25; uniform bursts reset from interval goal',()=>{
  const a=teamRecordApp();a.run('S.settings.targetScore=60');play(a,[12,1,12,1,12,1,12,1,10,1,1]);
  a.run('applyReplayedSet(proposeScoreEdit(0,5,3))');assert.equal(a.run('S.teams[0].score'),25);
  const b=teamRecordApp('uniform');b.run('S.settings.targetScore=150;S.currentSet=2;S.teams[0].score=98;S.teams[1].score=70;beginSheetSet()');
  play(b,[1,1]);b.run('applyReplayedSet(proposeScoreEdit(0,0,3))');assert.equal(b.run('S.teams[0].score'),75);
  assert.equal(b.run('S.teams[0].history[0].burst'),true);
});
test('correction that ends an earlier turn identifies every later record to discard',()=>{
  const a=teamRecordApp();play(a,[10,1,10,1,10,1,10,1,8,1,2]);
  assert.equal(a.run('S.phase'),'set_finished');
  a.run('const proposed=proposeScoreEdit(0,0,12)');
  assert.equal(a.run('proposed.removed'),2);assert.equal(a.run('S.teams[0].history.length'),6);
  a.run('applyReplayedSet(proposed)');assert.equal(a.run('S.teams[0].history.length'),5);assert.equal(a.run('S.teams[1].history.length'),4);
  assert.equal(a.run('S.setResults.length'),1);assert.equal(a.run('S.teams[0].setWins'),1);assert.equal(a.run('S.teams[0].setTotalScore'),50);
});
test('correcting a winning throw resumes play and removes stale results/wins',()=>{
  const a=teamRecordApp();play(a,[10,1,10,1,10,1,10,1,10]);
  a.run('applyReplayedSet(proposeScoreEdit(0,4,9))');
  assert.equal(a.run('S.phase'),'playing');assert.equal(a.run('S.setResults.length'),0);
  assert.equal(a.run('S.teams[0].score'),49);assert.equal(a.run('S.teams[0].setWins'),0);assert.equal(a.run('S.teams[0].setTotalScore'),0);
  assert.equal(a.run('S.currentTeamIdx'),1);
});
test('miss correction recalculates elimination and the score awarded to survivor',()=>{
  const a=teamRecordApp();play(a,[0,5,0,5,1,5]);
  a.run('const r=proposeScoreEdit(0,2,0)');assert.equal(a.run('r.removed'),1);
  a.run('applyReplayedSet(r)');assert.equal(a.run('S.teams[0].isEliminated'),true);assert.equal(a.run('S.teams[1].score'),50);
  a.run('applyReplayedSet(proposeScoreEdit(0,2,2))');assert.equal(a.run('S.phase'),'playing');assert.equal(a.run('S.teams[1].score'),10);assert.equal(a.run('S.teams[0].missStreak'),0);
});
test('three-team changed elimination detects missing turns instead of silently reassigning throws',()=>{
  const a=teamRecordApp('match',3);a.run('S.settings.maxMiss=1');play(a,[0,3,4,5]);
  a.run('const r=proposeScoreEdit(0,0,2)');
  assert.equal(a.run('r.removed'),1);assert.equal(a.run('r.teams[0].history[0].memberName'),'A');
  a.run('applyReplayedSet(r)');assert.equal(a.run('S.currentTeamIdx'),0);assert.equal(a.run('S.teams[1].score'),3);
});
test('final-set correction replaces archive, and reopening match removes stale finished record',()=>{
  const a=teamRecordApp();a.run('S.settings.regN=1');play(a,[10,1,10,1,10,1,10,1,10]);
  assert.equal(a.run('S.history.length'),1);
  a.run('applyReplayedSet(proposeScoreEdit(1,0,2))');assert.equal(a.run('S.history.length'),1);assert.equal(a.run('S.history[0].teams[1].history[0].points'),2);
  a.run('applyReplayedSet(proposeScoreEdit(0,4,9))');assert.equal(a.run('S.phase'),'playing');assert.equal(a.run('S.history.length'),0);
});
test('forced finish keeps partial-set records and remains finished after valid correction',()=>{
  const a=teamRecordApp();play(a,[12,3]);a.run('endGame(null);applyReplayedSet(proposeScoreEdit(0,0,10))');
  assert.equal(a.run('S.phase'),'finished');assert.equal(a.run('S.history.length'),1);
  assert.equal(a.run('getSheetSets(S.history[0])[0].scores[0].throws[0].points'),10);
});
test('six-team sheet includes unregistered teams and retains old records without guessed members',()=>{
  const a=teamRecordApp('match',6);play(a,[12,1,2,3,4,5]);
  assert.equal(a.run('getSheetSets(S)[0].scores.length'),6);
  const html=a.run('buildSheetTable(S,getSheetSets(S)[0],true)');assert.match(html,/A/);assert.match(html,/投擲者/);
  a.run('S.teams[0].history[0]={points:5,prevScore:0,timestamp:1}; S.teams[0].members=[]');
  assert.equal(a.run('sheetColumns(getSheetSets(S)[0].scores[0])[0].id'),null);
});
test('sheet UI escapes names; renderer exposes no member correction controls',()=>{
  const a=teamRecordApp();a.run("S.teams[0].name='<script>bad</script>';S.teams[0].members[0].name='<b>name</b>'");play(a,[3]);
  const html=a.run('buildSheetTable(S,getSheetSets(S)[0],true)');assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;b&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(a.run('buildMemberEditor(0,true)'),/投擲者を修正/);
});

test('new elimination in multi-team match rewinds at that throw before later valid opponents',()=>{
  const a=teamRecordApp('match',3);a.run('S.settings.maxMiss=1');play(a,[1,3,4,2,3,4]);
  a.run('const r=proposeScoreEdit(0,0,0)');assert.equal(a.run('r.consumed'),1);assert.equal(a.run('r.removed'),5);
  assert.equal(a.run('r.currentTeamIdx'),1);assert.equal(a.run('S.teams[0].isEliminated'),false);
  a.run('applyReplayedSet(r)');assert.equal(a.run('S.teams[0].isEliminated'),true);assert.equal(a.run('S.teams[1].history.length'),0);
});
test('uniform edited set keeps correct start scores and roster when next-set boundary is undone',()=>{
  const a=teamRecordApp('uniform');a.run('S.settings.targetScore=150');play(a,[10,1,10,1,10,1,10,1,10]);
  a.run('applyReplayedSet(proposeScoreEdit(1,0,2));nextSet();undoLastThrow()');
  assert.equal(a.run('S.currentSet'),1);assert.equal(a.run('S.sheetSet.setNum'),1);
  assert.equal(a.run('S.teams.find(t=>t.id===0).history.length'),4);
});


function timerApp() {
  const a=app();a.run('fresh();let testTimerNow=1000;throwTimerNow=()=>testTimerNow;');return a;
}
test('manual timer pauses and resumes without counting paused time',()=>{
  const a=timerApp();a.run('toggleThrowTimer();testTimerNow=13789;toggleThrowTimer()');
  assert.equal(a.run('throwTimerText()'),'12.7秒');assert.equal(a.run('throwTimer.startedAt'),null);
  a.run('testTimerNow=30000');assert.equal(a.run('throwTimerElapsed()'),12789);
  assert.equal(a.run('throwTimerButtonLabel()'),'再開');
  a.run('toggleThrowTimer()');assert.equal(a.run('throwTimerElapsed()'),12789);
  a.run('testTimerNow=31200');assert.equal(a.run('throwTimerText()'),'13.9秒');
  a.run('toggleThrowTimer();testTimerNow=40000;toggleThrowTimer();testTimerNow=41100;toggleThrowTimer()');
  assert.equal(a.run('throwTimerElapsed()'),15089);
});
test('reset restarts running timer and keeps a stopped timer stopped',()=>{
  const a=timerApp();a.run('toggleThrowTimer();testTimerNow=4500;resetThrowTimer()');
  assert.equal(a.run('throwTimer.startedAt'),4500);assert.equal(a.run('throwTimerText()'),'0.0秒');
  a.run('testTimerNow=6000');assert.equal(a.run('throwTimerText()'),'1.5秒');
  a.run('toggleThrowTimer();resetThrowTimer();testTimerNow=9000');
  assert.equal(a.run('throwTimer.startedAt'),null);assert.equal(a.run('throwTimerElapsed()'),0);
});
test('scoring, undo and set advancement leave manual timer unchanged even on set win',()=>{
  const a=timerApp();a.run('toggleThrowTimer();testTimerNow=6100;applyThrow(0,12);applyThrow(1,1);undoLastThrow()');
  assert.equal(a.run('throwTimerText()'),'5.1秒');
  a.run('S.teams[0].score=49;S.currentTeamIdx=0;applyThrow(0,1)');
  assert.equal(a.run('S.phase'),'set_finished');assert.equal(a.run('throwTimer.startedAt'),1000);
  assert.match(a.run('buildSetFinished()'),/throw-timer-toggle/);
  a.run('nextSet();testTimerNow=8000');assert.equal(a.run('throwTimerText()'),'7.0秒');
});
test('running and stopped timer state are restored independently of scoring state',()=>{
  const a=timerApp();a.run('toggleThrowTimer();testTimerNow=5000');
  const saved=a.values.get('molkky_throw_timer_v1');const b=app(undefined,saved);
  b.run('throwTimerNow=()=>9000');assert.equal(b.run('throwTimerText()'),'8.0秒');
  b.run('toggleThrowTimer()');
  const c=app(undefined,b.values.get('molkky_throw_timer_v1'));
  c.run('throwTimerNow=()=>99999');assert.equal(c.run('throwTimerText()'),'8.0秒');
});
test('new match, rematch and reset clear previous timing; invalid saved timer recovers',()=>{
  const a=timerApp();a.run('toggleThrowTimer();testTimerNow=10000;rematch()');
  assert.equal(a.run('throwTimerElapsed()'),0);assert.equal(a.run('throwTimer.startedAt'),null);
  a.run('toggleThrowTimer();testTimerNow=12000;resetGame()');assert.equal(a.run('throwTimer.startedAt'),null);
  for(const saved of ['invalid','{"elapsedMs":-1,"startedAt":null}','{"elapsedMs":0,"startedAt":"bad"}']){
    const b=app(undefined,saved);assert.equal(b.run('throwTimerElapsed()'),0);
  }
});



test('paused timing resumes after reload and reset restores the start label',()=>{
  const a=timerApp();a.run('toggleThrowTimer();testTimerNow=5500;toggleThrowTimer()');
  const b=app(undefined,a.values.get('molkky_throw_timer_v1'));
  b.run('let resumedNow=20000;throwTimerNow=()=>resumedNow');
  assert.equal(b.run('throwTimerButtonLabel()'),'再開');
  b.run('toggleThrowTimer();resumedNow=21000');assert.equal(b.run('throwTimerText()'),'5.5秒');
  const c=app(undefined,b.values.get('molkky_throw_timer_v1'));c.run('throwTimerNow=()=>22000');
  assert.equal(c.run('throwTimerText()'),'6.5秒');
  c.run('toggleThrowTimer();resetThrowTimer()');assert.equal(c.run('throwTimerButtonLabel()'),'開始');assert.equal(c.run('throwTimerElapsed()'),0);
});
test('even a zero-duration pause shows resume; legacy saved timers remain compatible',()=>{
  const a=timerApp();a.run('toggleThrowTimer();toggleThrowTimer()');
  assert.equal(a.run('throwTimerButtonLabel()'),'再開');
  const b=app(undefined,a.values.get('molkky_throw_timer_v1'));assert.equal(b.run('throwTimerButtonLabel()'),'再開');
  const legacy=app(undefined,JSON.stringify({elapsedMs:1200,startedAt:null}));assert.equal(legacy.run('throwTimerButtonLabel()'),'再開');
});


function elevenMatch(count=2) {
  const a=app();a.run(`fresh('eleven',${count});enforceRegulationSettings();beginSheetSet();
    function winElevenSet(id) {
      if(S.phase==='set_finished')nextSet();
      if(S.phase==='finished')throw Error('match already finished');
      const idx=S.teams.findIndex(t=>t.id===id);S.currentTeamIdx=idx;S.teams[idx].score=49;applyThrow(idx,1);
    }
    function elevenWins(){return S.teams.slice().sort((a,b)=>a.id-b.id).map(t=>t.setWins||0);}
  `);return a;
}
function elevenPlay(a,ids){for(const id of ids)a.run(`winElevenSet(${id})`);}
function reachTenTie(a){elevenPlay(a,[...Array(10).fill(0),...Array(10).fill(1)]);}
for(const count of [2,3,6])test(`eleven with ${count} teams: normal 11 wins ends before deuce`,()=>{
  const a=elevenMatch(count);elevenPlay(a,[...Array(10).fill(0),...Array(9).fill(1),0]);
  assert.equal(a.run('S.phase'),'finished');assert.equal(a.run('S.winnerId'),0);assert.equal(a.run('elevenExtended()'),false);
  assert.equal(a.run('S.settings.regN'),11);assert.match(a.run('buildHistoryTab()'),/11先/);
});
test('eleven deuce: A-B-B leaves 11-12 ongoing; next B wins 11-13',()=>{
  const a=elevenMatch();reachTenTie(a);assert.equal(a.run('S.phase'),'set_finished');assert.equal(a.run('elevenExtended()'),true);
  elevenPlay(a,[0,1,1]);assert.deepEqual(a.json('elevenWins()'),[11,12]);assert.equal(a.run('S.phase'),'set_finished');
  elevenPlay(a,[1]);assert.equal(a.run('S.phase'),'finished');assert.equal(a.run('S.winnerId'),1);assert.deepEqual(a.json('elevenWins()'),[11,13]);
});
for(const tail of [[0,0],[1,1],[0,1,0,0]])test(`eleven deuce finishes at a two-win margin after ${tail.join('-')}`,()=>{
  const a=elevenMatch();reachTenTie(a);elevenPlay(a,tail);assert.equal(a.run('S.phase'),'finished');
  const wins=a.json('elevenWins()').sort((a,b)=>b-a);assert.equal(wins[0]-wins[1],2);
});
test('three teams: another team can catch up and must lead the actual runner-up by two',()=>{
  const a=elevenMatch(3);reachTenTie(a);elevenPlay(a,[...Array(9).fill(2),0,2,2,2]);
  assert.deepEqual(a.json('elevenWins()'),[11,10,12]);assert.equal(a.run('S.phase'),'set_finished');
  elevenPlay(a,[2]);assert.equal(a.run('S.winnerId'),2);assert.deepEqual(a.json('elevenWins()'),[11,10,13]);
});
test('six-team extension keeps all teams eligible and ignores lower places in margin',()=>{
  const a=elevenMatch(6);reachTenTie(a);elevenPlay(a,[...Array(9).fill(2),...Array(7).fill(3),...Array(11).fill(4)]);
  assert.equal(a.run('S.phase'),'set_finished');assert.deepEqual(a.json('elevenWins()'),[10,10,9,7,11,0]);
  elevenPlay(a,[4]);assert.equal(a.run('S.winnerId'),4);
});
test('eleven extension has no fixed set cap while leaders alternate',()=>{
  const a=elevenMatch();reachTenTie(a);for(let i=0;i<40;i++)elevenPlay(a,[0,1]);
  assert.equal(a.run('S.phase'),'set_finished');assert.deepEqual(a.json('elevenWins()'),[50,50]);
  elevenPlay(a,[0,0]);assert.equal(a.run('S.phase'),'finished');assert.deepEqual(a.json('elevenWins()'),[52,50]);
});
test('undoing the 10-10 trigger cancels extension and reload/redo restores it',()=>{
  const a=elevenMatch();reachTenTie(a);a.run('undoLastThrow()');
  assert.equal(a.run('elevenExtended()'),false);assert.deepEqual(a.json('elevenWins()'),[10,9]);
  a.run('winElevenSet(1)');const b=app(a.values.get('molkky_so_v2'));
  assert.equal(b.run('elevenExtended()'),true);assert.equal(b.run('getPublicState().elevenExtended'),true);assert.match(b.run('buildSetProgress()'),/延長中/);
  b.run('rematch()');assert.equal(b.run('elevenExtended()'),false);
});
test('score correction of deuce trigger clears extension; final-set correction reopens match',()=>{
  const a=elevenMatch();reachTenTie(a);a.run('applyReplayedSet(proposeScoreEdit(1,0,0))');
  assert.equal(a.run('elevenExtended()'),false);assert.deepEqual(a.json('elevenWins()'),[10,9]);
  const b=elevenMatch();reachTenTie(b);elevenPlay(b,[0,0]);assert.equal(b.run('S.history.length'),1);
  b.run('applyReplayedSet(proposeScoreEdit(0,0,0))');assert.equal(b.run('S.phase'),'playing');assert.equal(b.run('S.history.length'),0);
  assert.deepEqual(b.json('elevenWins()'),[11,10]);assert.equal(b.run('elevenExtended()'),true);
});
test('eleven setup fixes only set target at 11 and preserves multiple teams and per-set settings',()=>{
  const a=app();setup(a);a.run("updateTeamCount(3);switchRegMode('eleven')");
  assert.equal(a.run('S.teams.length'),3);assert.equal(a.run('S.settings.regN'),11);assert.equal(a.run('S.settings.targetScore'),60);assert.equal(a.run('S.settings.maxMiss'),4);
  assert.match(a.run('buildSetup()'),/<input[^>]*id="reg-value"[^>]*disabled/);
  assert.doesNotMatch(a.run('buildSetup()'),/<select[^>]*id="team-count-select"[^>]*disabled/);
  assert.doesNotMatch(a.run('buildSetup()'),/<input[^>]*id="target-score"[^>]*disabled/);
  a.run("setRegulation('eleven',2)");assert.equal(a.run('S.settings.regN'),11);
  a.run("switchRegMode('first')");assert.equal(a.run('S.settings.regN'),2);assert.doesNotMatch(a.run('buildSetup()'),/<input[^>]*id="reg-value"[^>]*disabled/);
});


function reachDecider() {
  const a=app();a.run(`fresh('first');S.settings.regN=2;S.initialOrder=[0,1];beginSheetSet();
    S.teams[0].score=49;S.teams[1].score=48;S.currentTeamIdx=0;applyThrow(0,1);nextSet();
    S.teams.find(t=>t.id===0).score=30;S.teams.find(t=>t.id===1).score=49;
    S.currentTeamIdx=S.teams.findIndex(t=>t.id===1);applyThrow(S.currentTeamIdx,1);`);return a;
}
test('first-to-two deciding set defaults to higher total, retains manual override after reload',()=>{
  const a=reachDecider();assert.equal(a.run('decidingSetByTotal()'),true);
  assert.deepEqual(a.json('getOrderDraft().map(i=>S.teams[i].id)'),[1,0]);
  assert.deepEqual(a.json('S.teams.slice().sort((a,b)=>a.id-b.id).map(t=>t.setTotalScore)'),[80,98]);
  a.run('moveOrder(0,1)');const b=app(a.values.get('molkky_so_v2'));
  assert.deepEqual(b.json('getOrderDraft().map(i=>S.teams[i].id)'),[0,1]);
  const old=b.json('S.setResults');b.run('nextSet()');assert.equal(b.run('S.teams[0].id'),0);assert.equal(b.run('S.currentSet'),3);assert.deepEqual(b.json('S.setResults'),old);
});
test('all teams must be on match point; equal totals retain the normal rotation',()=>{
  const a=app();a.run(`fresh('first',3);S.settings.regN=2;S.initialOrder=[2,0,1];
    S.setResults=[{setNum:1,winnerId:0},{setNum:2,winnerId:1},{setNum:3,winnerId:2}];
    S.teams.forEach((t,i)=>{t.setWins=1;t.setTotalScore=[80,90,80][i]});`);
  assert.equal(a.run('decidingSetByTotal()'),true);assert.deepEqual(a.json('getOrderDraft().map(i=>S.teams[i].id)'),[1,2,0]);
  a.run('S.teams[2].setWins=0;_orderDraft=null');assert.equal(a.run('decidingSetByTotal()'),false);assert.deepEqual(a.json('getOrderDraft().map(i=>S.teams[i].id)'),[2,0,1]);
});
test('other modes keep their ordinary rotation even if wins happen to match the reach value',()=>{
  for(const mode of ['match','total','prime','eleven']){
    const a=app();a.run(`fresh('${mode}',3);S.settings.regN=2;S.initialOrder=[0,1,2];S.setResults=[{},{}];S.teams.forEach(t=>{t.setWins=1;t.setTotalScore=100-t.id*10})`);
    assert.equal(a.run('decidingSetByTotal()'),false);assert.deepEqual(a.json('getOrderDraft().map(i=>S.teams[i].id)'),[2,0,1]);
  }
});
test('playing totals include current score once; completed totals do not double count',()=>{
  const a=app();a.run("fresh('first');S.teams[0].setTotalScore=50;S.teams[0].score=15");
  assert.equal(a.run('displayedMatchTotal(S.teams[0])'),65);assert.match(a.run('buildSetProgress()'),/暫定合計 65点/);
  a.run('S.teams[0].score=50;endSet(0)');assert.equal(a.run('displayedMatchTotal(S.teams[0])'),100);assert.match(a.run('buildSetProgress()'),/合計 100点/);
  a.run("S.settings.regMode='uniform';S.teams[0].score=75");assert.equal(a.run('displayedMatchTotal(S.teams[0])'),75);
});
test('unplayed current-set order edit can change teams, participants and members without changing prior state until apply',()=>{
  const a=teamRecordApp();a.run('S.initialOrder=[0,1];openCurrentOrder();moveCurrentOrder(0,1);moveMember(0,2,0,true);toggleMemberParticipation(0,1,true)');
  assert.deepEqual(a.json('S.teams.map(t=>t.id)'),[0,1]);assert.equal(a.run('currentMember(S.teams[0]).name'),'A');
  a.run('confirmCurrentOrder()');assert.deepEqual(a.json('S.teams.map(t=>t.id)'),[1,0]);assert.equal(a.run('currentMember(S.teams.find(t=>t.id===0)).name'),'C');
  assert.deepEqual(a.json('S.initialOrder'),[1,0]);assert.equal(a.run('S.sheetSet.firstTeamId'),1);assert.equal(a.run('S.currentSet'),1);
});
test('canceling an entered-set edit preserves throws and blocks score entry/undo while editing',()=>{
  const a=teamRecordApp();play(a,[12,3,2]);const before=a.json('state()');
  a.run('openCurrentOrder();moveCurrentOrder(0,1);moveMember(0,2,0,true);applyThrow(0,12);undoLastThrow()');
  assert.deepEqual(a.json('state()'),before);a.run('cancelCurrentOrder()');assert.deepEqual(a.json('state()'),before);
});
test('restart current entered set requires confirmation and keeps all past sets and stats',()=>{
  const a=teamRecordApp();play(a,[10,1,10,1,10,1,10,1,10]);a.run('nextSet()');play(a,[3,12,4]);
  const past=a.json('S.setResults'),stats=a.json('S.teams.map(t=>[t.id,t.setWins,t.setTotalScore])');
  a.run(`showConfirm=(message,fn)=>{window.orderConfirmation=message;window.orderApply=fn};
    openCurrentOrder();moveCurrentOrder(0,1);confirmCurrentOrder()`);
  assert.match(a.run('window.orderConfirmation'),/3投/);assert.equal(a.run('S.teams.reduce((n,t)=>n+t.history.length,0)'),3);
  a.run('window.orderApply()');assert.equal(a.run('S.teams.reduce((n,t)=>n+t.history.length,0)'),0);assert.equal(a.run('S.currentSet'),2);
  assert.deepEqual(a.json('S.setResults'),past);assert.deepEqual(a.json('S.teams.slice().reverse().map(t=>[t.id,t.setWins,t.setTotalScore])'),stats);
  assert.equal(a.run('S.teams.every(t=>t.score===0&&!t.isEliminated&&t.missStreak===0)'),true);
});
test('a reloaded draft retains member/order changes and can be canceled without losing input',()=>{
  const a=teamRecordApp();play(a,[12,3]);a.run('openCurrentOrder();moveCurrentOrder(0,1);moveMember(0,2,0,true)');
  const b=app(a.values.get('molkky_so_v2'));assert.equal(b.run('editingCurrentOrder()'),true);assert.deepEqual(b.json('S.orderEdit.orderIds'),[1,0]);
  assert.equal(b.run('S.orderEdit.teams[0].nextMembers[0].name'),'C');b.run('cancelCurrentOrder()');assert.equal(b.run('S.teams[0].history[0].points'),12);
});
test('uniform restart restores interval start scores rather than zero and removes undo of discarded throws',()=>{
  const a=teamRecordApp('uniform');a.run(`S.settings.targetScore=150;S.currentSet=2;S.teams[0].score=50;S.teams[1].score=35;
    S.setResults=[{setNum:1,winnerId:0,scores:[{teamId:0,score:50},{teamId:1,score:35}]}];beginSheetSet()`);
  play(a,[12,4]);a.run('openCurrentOrder();moveCurrentOrder(0,1);applyCurrentOrder()');
  assert.equal(a.run('S.teams.find(t=>t.id===0).score'),50);assert.equal(a.run('S.teams.find(t=>t.id===1).score'),35);
  assert.equal(a.run('S.setResults.length'),1);assert.equal(a.run('S.uniformBeforeThrow'),null);assert.equal(a.run('S.previousSetUndo'),null);assert.equal(a.run('S.turnCount'),0);
});
test('empty participation in a correction draft cannot overwrite the live set',()=>{
  const a=teamRecordApp();play(a,[12,3]);a.run('openCurrentOrder();S.orderEdit.teams[0].members.forEach(m=>m.active=false);applyCurrentOrder()');
  assert.equal(a.run('editingCurrentOrder()'),true);assert.equal(a.run('S.teams[0].history[0].points'),12);assert.ok(a.alerts.length>0);
});
