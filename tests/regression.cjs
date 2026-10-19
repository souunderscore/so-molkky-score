const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).filter(Boolean).at(-1).replace(/render\(\);\s*$/, '');

function app(saved) {
  const values = new Map(saved ? [['molkky_so_v2', saved]] : []);
  const inputs = {};
  const ctx = vm.createContext({
    localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) },
    BroadcastChannel: function () { this.postMessage = () => {}; },
    document: { getElementById: id => inputs[id] || null,
      querySelectorAll: selector => Object.values(inputs).filter(input => selector !== '[data-member-team]' || input.dataset?.memberTeam !== undefined) }, window: {}, Date,
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
    inputs, values,
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
  a.run(`fresh('prime'); enforcePrimeSettings();
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


function memberGame(a, mode='match') {
  a.run(`fresh('${mode}'); S.teams[0].members=[{id:0,name:'A'},{id:1,name:'B'}];
    S.teams[1].members=[{id:0,name:'C'}];`);
}
test('members rotate independently per team; correction does not change next member; undo and reload restore rotation', () => {
  const a=app(); memberGame(a);
  a.run('applyThrow(0,10); applyThrow(1,0); applyThrow(0,0)');
  assert.deepEqual(a.json('S.teams[0].history.map(h=>[h.memberName,h.points])'),[['A',10],['B',0]]);
  assert.equal(a.run('currentMember(S.teams[0]).name'),'A');
  a.run("correctThrowMember('live',-1,-1,0,0,1)");
  assert.equal(a.run('currentMember(S.teams[0]).name'),'A');
  const b=app(a.values.get('molkky_so_v2'));
  b.run('undoLastThrow()');
  assert.equal(b.run('currentMember(S.teams[0]).name'),'B');
  assert.equal(b.run('S.teams[0].history[0].memberName'),'B');
});
test('next-set member order persists separately without changing completed throws, follows team IDs, and survives reload', () => {
  const a=app(); memberGame(a);
  a.run('S.teams[0].score=49; applyThrow(0,1); moveMember(0,1,0,true)');
  assert.equal(a.run('S.setResults[0].scores[0].throws[0].memberName'),'A');
  const b=app(a.values.get('molkky_so_v2'));
  b.run('nextSet()');
  assert.deepEqual(b.json('S.teams.find(t=>t.id===0).members.map(m=>m.name)'),['B','A']);
  assert.equal(b.run('currentMember(S.teams.find(t=>t.id===0)).name'),'B');
  b.run('S.teams[0].score=49; applyThrow(0,1); nextSet()');
  assert.deepEqual(b.json('S.teams.find(t=>t.id===0).members.map(m=>m.name)'),['B','A']);
  b.run('rematch()');
  assert.deepEqual(b.json('S.teams.find(t=>t.id===0).members.map(m=>m.name)'),['B','A']);
});
test('completed-set correction updates live duplicate and archive; history correction updates finished screen without changing points', () => {
  const a=app();memberGame(a);
  a.run('S.settings.regN=1; S.teams[0].score=49; applyThrow(0,1)');
  a.run("correctThrowMember('result',-1,0,0,0,1)");
  assert.deepEqual(a.json('[S.teams[0].history[0].memberName,S.setResults[0].scores[0].throws[0].memberName,S.history[0].teams[0].history[0].memberName]'),['B','B','B']);
  a.run("correctThrowMember('history',0,0,0,0,0)");
  assert.equal(a.run('S.teams[0].history[0].memberName'),'A');
  assert.equal(a.run('S.teams[0].score'),50);
  assert.equal(a.run('S.teams[0].history[0].points'),1);
  assert.equal(a.run('memberThrows(S,S.teams[0]).length'),1);
  assert.match(a.run('buildStatsTab()'),/S1・1投目：1点/);
});
test('forced finish retains incomplete-set personal records and permits correction from history',()=>{
  const a=app(); memberGame(a);
  a.run('applyThrow(0,12); endGame(null)');
  assert.equal(a.run('memberThrows(S.history[0],S.history[0].teams[0]).length'),1);
  a.run("correctThrowMember('history',0,-1,0,0,1)");
  assert.equal(a.run('S.teams[0].history[0].memberName'),'B');
  assert.equal(a.run('S.history[0].teams[0].history[0].memberName'),'B');
});
test('uniform snapshot undo keeps corrected attribution across set transitions',()=>{
  const a=app();memberGame(a,'uniform');
  a.run('S.settings.targetScore=100; applyThrow(0,10); applyThrow(1,5); S.teams[0].score=49; applyThrow(0,1)');
  a.run("correctThrowMember('result',-1,0,0,0,1); nextSet(); undoLastThrow()");
  assert.equal(a.run('S.teams[0].history[0].memberName'),'B');
  assert.equal(a.run('currentMember(S.teams[0]).name'),'B');
});
test('unregistered teams and old histories remain usable with no inferred attribution',()=>{
  const a=app();a.run('fresh(); applyThrow(0,3)');
  assert.equal(a.run('currentMember(S.teams[0])'),null);
  assert.equal(a.run('S.teams[0].history[0].memberName'),undefined);
  assert.equal(a.run('memberButton(S.teams[0].history[0],"live",-1,-1,0,0)'),'');
  assert.doesNotThrow(()=>a.run('buildStatsTab(); buildPlaying()'));
});
test('member edits survive setup changes and start; blank names are omitted, duplicate names keep distinct IDs',()=>{
  const a=app(); setup(a);
  a.run('addMember(0); addMember(0); addMember(0)');
  a.inputs.member0={value:'Same',dataset:{memberTeam:'0',memberId:'0'}};
  a.inputs.member1={value:'Same',dataset:{memberTeam:'0',memberId:'1'}};
  a.run('captureSetupInputs(); switchRegMode("first"); startGame()');
  assert.deepEqual(a.json('S.teams[0].members'),[{id:0,name:'Same'},{id:1,name:'Same'}]);
});
