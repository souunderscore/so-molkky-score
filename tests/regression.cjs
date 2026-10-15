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
      querySelectorAll: () => Object.values(inputs) }, window: {}, Date,
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
