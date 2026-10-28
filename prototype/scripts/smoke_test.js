const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.argv[2], 'utf8');
const grab = id => html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'))[1];

/* ---- minimal fake DOM, just enough for the app glue ---- */
const els = {}, listeners = {};
function makeEl(tag) {
  const el = { tagName: tag || 'div', dataset: {}, attrs: {}, _html: '', children: [], hidden: false, value: '', textContent: '', open: false, scrollTop: 0, disabled: false, type: 'text',
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, f) { const on = f === undefined ? !this.s.has(c) : f; on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k]; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, focus() { els.__focused = this; }, appendChild(c) { this.children.push(c); },
    remove() {}, addEventListener(t, fn) { (this.ev = this.ev || {})[t] = fn; }, showModal() { this.open = true; }, close() { this.open = false; if (this.ev && this.ev.close) this.ev.close(); } };
  return el;
}
const byId = id => els[id] || (els[id] = makeEl());
const document = { getElementById: byId, body: makeEl('body'), createElement: makeEl, addEventListener(t, fn) { listeners[t] = fn; }, querySelector: () => null, querySelectorAll: () => [], activeElement: null, visibilityState: 'visible' };
const store = {}, sstore = {};
const mk = o => ({ getItem: k => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: k => { delete o[k]; } });
class FormDataStub { constructor(f) { this.f = f; } forEach(cb) { Object.entries(this.f.__values).forEach(([k, v]) => [].concat(v).forEach(x => cb(x, k))); } }
const win = { crypto: globalThis.crypto, addEventListener(t, fn) { listeners['window:' + t] = fn; }, scrollTo() {}, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
const ctx = vm.createContext({ console, crypto: globalThis.crypto, TextEncoder, btoa, atob, Intl, Uint8Array, Array, JSON, Promise, Date, Math, setTimeout, document, window: win, localStorage: mk(store), sessionStorage: mk(sstore), FormData: FormDataStub, navigator: { clipboard: { writeText: async () => {} } }, __els: els, __listeners: listeners, makeEl });
vm.runInContext(grab('core'), ctx, { filename: 'core.js' }); vm.runInContext(grab('views'), ctx, { filename: 'views.js' });
// The stage 1-3 scenarios below count the original seed; the history added in stage 4 is covered by its own checks.
vm.runInContext('var __bs = buildSeed; buildSeed = function (o) { return __bs(o || { history: false }); };', ctx);
vm.runInContext(grab('app'), ctx, { filename: 'app.js' });

const scenario = `(async () => {
  const log = []; const ok = (n, c, x) => log.push([n, !!c, c ? '' : (x || '')]);
  const wait = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };
  const root = () => __els.root._html, dlgHtml = () => __els.dlg._html;
  const btn = (action, data) => ({ dataset: Object.assign({ action }, data || {}), innerHTML: '', setAttribute() {}, textContent: '' });
  const click = async (action, data) => { const b = btn(action, data); await __listeners.click({ target: { closest: s => s === '[data-action]' ? b : null } }); };
  const makeForm = (kind, values, extra) => {
    const submit = { dataset: { busyLabel: 'Working' }, disabled: false, innerHTML: 'Go', textContent: '' }, fe = { hidden: true, textContent: '' }, errs = {};
    const form = Object.assign({ dataset: Object.assign({ form: kind }, extra || {}), __values: values, elements: {}, submit, fe, errs,
      querySelector: s => s.includes('submit') ? submit : s === '[data-form-error]' ? fe : s.startsWith('[data-err="') ? (errs[s.slice(11, -2)] = errs[s.slice(11, -2)] || { textContent: '', id: '' }) : s === '[aria-invalid="true"]' ? null : null,
      querySelectorAll: () => [], closest: () => form }, {});
    Object.keys(values).forEach(k => { form.elements[k] = { value: values[k], setAttribute() {}, removeAttribute() {}, focus() {} }; });
    ['email', 'password'].forEach(k => { if (!form.elements[k]) form.elements[k] = { value: '', setAttribute() {}, removeAttribute() {}, focus() {} }; });
    return form;
  };
  const submit = async (kind, values, extra) => { const f = makeForm(kind, values, extra); await __listeners.submit({ target: { closest: s => s === 'form[data-form]' ? f : null }, preventDefault() {} }); return f; };
  const signInAs = async (email) => { await click('show-login'); await submit('login', { email, password: APP.demoPassword }); };

  ok('boot shows sign-in', await wait(() => root().includes('Welcome back')), root().slice(0, 200));
  ok('boot seeded and saved state', !!localStorage.getItem(STORE_KEY) && state.users.length === 9);
  ok('login body class set', __els.body === undefined || document.body.classList.contains('in-login'));

  // failed sign-in
  let f = await submit('login', { email: 'john@example.org', password: 'nope-nope-nope' });
  ok('failed sign-in shows generic error and no session', f.fe.hidden === false && /couldn.t sign you in/.test(f.fe.textContent) && sessionUserId === null);
  f = await submit('login', { email: '', password: '' });
  ok('empty sign-in is validated field by field', f.errs.email && f.errs.email.textContent && f.errs.password && f.errs.password.textContent);

  // admin session
  await submit('login', { email: 'michael@example.org', password: APP.demoPassword });
  ok('admin signs in and lands on Users', sessionUserId === 'u_michael' && ui.page === 'users' && root().includes('<h1 id="page-title" tabindex="-1">Users</h1>'));
  ok('session id stored for reloads', sessionStorage.getItem(SESSION_KEY) === 'u_michael');
  await click('nav', { page: 'settings' });
  ok('navigation switches page', root().includes('Church name') && ui.page === 'settings');
  await click('nav', { page: 'users' });

  // invite flow
  await click('open-invite');
  ok('invite dialog opens', __els.dlg.open && dlgHtml().includes('Invite a user'));
  f = await submit('invite', { name: 'Ruth Adeyemi', email: 'bad-email', role: 'coordinator' });
  ok('invalid invite shows field errors and saves nothing', f.errs.email.textContent && state.users.length === 9);
  f = await submit('invite', { name: 'Ruth Adeyemi', email: 'ruth@example.org', role: 'coordinator', departmentIds: ['d_a', 'd_b'] });
  const ruth = findUserByEmail(state, 'ruth@example.org');
  ok('valid invite creates an invited user', ruth && ruth.status === 'invited' && deptIdsOf(state, ruth.id).length === 2);
  const code = (dlgHtml().match(/<code id="code-text">([^<]+)<\\/code>/) || [])[1];
  ok('invite code is shown once in the dialog', /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(code || ''), dlgHtml().slice(0, 300));
  ok('state persisted after invite', JSON.parse(localStorage.getItem(STORE_KEY)).users.some(u => u.email === 'ruth@example.org'));
  ok('users list updated behind the dialog', root().includes('Ruth Adeyemi'));

  // deactivate with confirmation
  await click('manage-user', { id: 'u_sarah' });
  ok('manage dialog opens', dlgHtml().includes('Manage Sarah Mitchell'));
  await click('ask-status', { id: 'u_sarah', status: 'deactivated' });
  ok('deactivate asks for confirmation first', dlgHtml().includes('Deactivate Sarah Mitchell?') && getUser(state, 'u_sarah').status === 'active');
  await click('confirm-yes');
  ok('confirmed deactivation applies and a toast appears', getUser(state, 'u_sarah').status === 'deactivated' && __els.toasts.children.some(c => c._html.includes('was deactivated')));
  await click('manage-user', { id: 'u_sarah' });
  await click('ask-status', { id: 'u_sarah', status: 'active' }); await click('confirm-yes');
  ok('reactivation works', getUser(state, 'u_sarah').status === 'active');

  // role change needs confirmation
  await click('manage-user', { id: 'u_daniel' });
  await submit('edit-user', { name: 'Daniel Kingsley', role: 'team_leader', departmentIds: ['d_a'] }, { userId: 'u_daniel' });
  ok('role change asks for confirmation first', dlgHtml().includes('Change role?') && getUser(state, 'u_daniel').role === 'coordinator');
  await click('confirm-yes');
  ok('confirmed role change is saved', getUser(state, 'u_daniel').role === 'team_leader');
  await click('manage-user', { id: 'u_daniel' });
  await submit('edit-user', { name: 'Daniel K. Kingsley', departmentIds: ['d_a', 'd_b'] }, { userId: 'u_daniel' });
  ok('edit without role change saves directly', getUser(state, 'u_daniel').name === 'Daniel K. Kingsley' && deptIdsOf(state, 'u_daniel').length === 2);

  // reset access shows a new code
  await click('manage-user', { id: 'u_grace' });
  await click('ask-reset', { id: 'u_grace' }); await click('confirm-yes');
  ok('reset access issues a new code', getUser(state, 'u_grace').status === 'invited' && dlgHtml().includes('Access reset') && dlgHtml().includes('code-text'));

  // settings
  await click('nav', { page: 'settings' });
  await submit('dept-add', { name: 'Team Z' });
  ok('team added', state.departments.some(d => d.name === 'Team Z'));
  f = await submit('dept-add', { name: 'team z' });
  ok('duplicate team shows an error', f.errs.name && /already exists/.test(f.errs.name.textContent));
  await click('dept-toggle', { id: 'd_d' });
  ok('team can be deactivated', state.departments.find(d => d.id === 'd_d').active === false);
  await submit('church', { name: 'Kharis Church' });
  ok('church name saved and shown', state.settings.churchName === 'Kharis Church' && root().includes('Kharis Church'));

  // sign out, activate the invited user
  await click('toggle-account'); ok('account menu opens', ui.menuOpen === true);
  await click('sign-out');
  ok('sign-out returns to sign-in with a notice', sessionUserId === null && root().includes('Welcome back') && root().includes('You have signed out.') && !sessionStorage.getItem(SESSION_KEY));
  await click('show-activate');
  ok('activation screen shown', root().includes('Activate your account'));
  f = await submit('activate', { email: 'ruth@example.org', code, password: 'abc', confirm: 'abd' });
  ok('mismatched passwords are caught before any request', f.errs.confirm.textContent && getUser(state, ruth.id).status === 'invited');
  f = await submit('activate', { email: 'ruth@example.org', code: 'ZZZZ-ZZZZ-ZZZZ', password: 'Strong-Passw0rd!', confirm: 'Strong-Passw0rd!' });
  ok('wrong code shows the generic message', f.fe.hidden === false && /don.t match/.test(f.fe.textContent));
  f = await submit('activate', { email: 'ruth@example.org', code, password: 'Strong-Passw0rd!', confirm: 'Strong-Passw0rd!' });
  ok('activation succeeds and returns to sign-in', getUser(state, ruth.id).status === 'active' && root().includes('Welcome back') && root().includes('Your account is active') && root().includes('value="ruth@example.org"'));
  await submit('login', { email: 'ruth@example.org', password: 'Strong-Passw0rd!' });
  ok('activated user signs in as a coordinator and lands on the pipeline', sessionUserId === ruth.id && ui.page === 'pipeline' && root().includes('Follow-up Pipeline') && !root().includes('data-page="users"'));

  // access guard via About dialog
  await click('open-about');
  ok('about dialog opens', dlgHtml().includes('About this prototype'));
  __els['try-page'] = Object.assign(makeEl(), { value: 'users' });
  await click('try-page');
  ok('direct navigation to a restricted page shows 403', ui.forbidden === true && root().includes('Error 403') && !root().includes('data-action="manage-user"'));
  await click('go-home');
  ok('go home leaves the 403 page', ui.forbidden === false && ui.page === 'pipeline');

  // session death when the account is deactivated elsewhere
  getUser(state, ruth.id).status = 'deactivated';
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  await __listeners['window:storage']({ key: STORE_KEY });
  ok('deactivated account loses its session on the next refresh', sessionUserId === null && root().includes('no longer active') && root().includes('Welcome back'));
  ok('deactivated account cannot sign in again', (await submit('login', { email: 'ruth@example.org', password: 'Strong-Passw0rd!' })).fe.hidden === false && sessionUserId === null);

  // team leader sees only their team
  await submit('login', { email: 'tunde@example.org', password: APP.demoPassword });
  await click('nav', { page: 'team' });
  ok('team leader team page is scoped to own team and active members only', root().includes('Tunde Bello') && root().includes('(you)') && root().includes('Daniel K. Kingsley') && !root().includes('Sarah Mitchell') && !root().includes('Grace Okafor'), root().slice(0, 400));
  await click('nav', { page: 'dashboard' });
  ok('team leader dashboard renders', root().includes('Welcome, Tunde'));
  await click('toggle-nav'); ok('drawer opens', ui.navOpen === true); await click('close-nav'); ok('drawer closes', ui.navOpen === false);
  await click('toggle-password', { target: 'x' });

  // pastor sees the greeting
  await click('toggle-account'); await click('sign-out');
  await submit('login', { email: 'apollos@example.org', password: APP.demoPassword });
  ok('pastor lands on the dashboard greeted by name', ui.page === 'dashboard' && root().includes('<h1 id="page-title" tabindex="-1">Pastor Apollos</h1>') && root().includes('Reports') && !root().includes('data-page="users"'));

  // reset demo data
  await click('toggle-account'); await click('sign-out');
  await click('ask-reset-demo');
  ok('reset asks first', dlgHtml().includes('Reset demo data?'));
  await click('confirm-yes');
  ok('reset restores the seed', state.users.length === 9 && !findUserByEmail(state, 'ruth@example.org') && root().includes('Demo data was reset.'));

  /* ======================= STAGE 2: the recorder, end to end through real events ======================= */
  const typeInto = async (path, value) => __listeners.input({ target: { dataset: { draft: path }, value: value, type: 'text', id: '', checked: false, removeAttribute() {} } });
  const setCheck = async (path, on, extra) => __listeners.change({ target: { dataset: Object.assign({ draft: path }, extra || {}), type: 'checkbox', checked: on, value: '', id: '', removeAttribute() {} } });
  const pickRadio = async (path, value) => __listeners.change({ target: { dataset: { draft: path }, type: 'radio', value: value, checked: true, id: '', removeAttribute() {} } });
  const filterBy = async (kind, value) => __listeners.change({ target: { dataset: { input: kind }, value: value } });
  const rowsIn = (html, action) => (html.match(new RegExp('data-action="' + action + '"', 'g')) || []).length;
  const pastDay = isoDate(Date.now() - 5 * DAY);

  await signInAs('sarah@example.org');
  ok('evangelist lands on her sessions', ui.page === 'sessions' && rowsIn(root(), 'open-session') === 3);
  await click('open-record');
  ok('open-record starts a draft on step 1', ui.page === 'record' && ui.draft && ui.draft.step === 1 && root().includes('Record outreach session') && root().includes('id="rs-area"'));
  await click('draft-next');
  ok('step 1 refuses empty required fields and stays put', ui.draft.step === 1 && root().includes('Choose an area.') && root().includes('Choose the type of outreach.') && ui.focusSel === null);
  await typeInto('session.areaId', 'a_market'); await typeInto('session.typeKey', 'street'); await typeInto('session.startTime', '09:30'); await typeInto('session.outreachDate', pastDay); await typeInto('session.notes', 'Smoke test outing');
  ok('typing writes into the draft and clears that field’s error', ui.draft.session.areaId === 'a_market' && ui.draft.session.notes === 'Smoke test outing' && !ui.draft.errors.session.areaId && ui.draft.errors.session.typeKey === undefined);
  await click('draft-next');
  ok('step 1 → step 2 when the details are valid', ui.draft.step === 2 && root().includes('No one added yet') && root().includes('aria-current="step"'));
  await click('add-person');
  ok('add-person adds a card and aims focus at its name', ui.draft.people.length === 1 && root().includes('id="pc0-name"') && ui.focusSel === null);
  await typeInto('people.0.name', 'Hope Adeyemi'); await typeInto('people.0.phone', '07700 900555');
  await click('draft-review');
  ok('contact details without confirmation block the review and stay on step 2', ui.draft.step === 2 && root().includes('Confirm they shared these details freely') && /<details class="more" open/.test(root()));
  await setCheck('people.0.voluntary', true); await pickRadio('people.0.response', 'receptive'); await setCheck('people.0.followUp', true); await typeInto('people.0.notes', 'Wants to know about Sunday');
  ok('checkboxes and radios write into the draft', ui.draft.people[0].voluntary === true && ui.draft.people[0].response === 'receptive' && ui.draft.people[0].followUp === true && !ui.draft.errors.people[0].voluntary);
  await click('add-person'); await click('person-mode', { index: '1', mode: 'existing' });
  ok('switching a card to “already in the system” shows the search', ui.draft.people[1].mode === 'existing' && root().includes('id="pc1-q"'));
  await typeInto('people.1.query', 'liam');
  ok('typing a search updates only the results box with people in scope', __els['pr-1']._html.includes('Liam Carter') && !__els['pr-1']._html.includes('Priscilla') && !__els['pr-1']._html.includes('07700'));
  await click('pick-person', { index: '1', id: 'p_liam' });
  ok('choosing a result links the existing person', ui.draft.people[1].existingId === 'p_liam' && root().includes('class="picked"') && root().includes('Liam Carter'));
  await click('add-person'); await typeInto('people.2.name', 'Lian Carter');
  ok('someone already added to this draft is not offered again as a match', __els['dup-2']._html === '');
  await typeInto('people.2.name', 'Noor Rahmen');
  ok('typing a similar new name shows a possible match box without contact details', __els['dup-2']._html.includes('Could this be someone already recorded?') && __els['dup-2']._html.includes('Noor Rahman') && !__els['dup-2']._html.includes('noor.rahman@example.org'));
  await click('dup-dismiss', { index: '2' });
  ok('dismissing the match clears it and remembers', __els['dup-2']._html === '' && ui.draft.people[2].dupDismissed === true);
  await click('remove-person', { index: '2' });
  ok('a person can be removed', ui.draft.people.length === 2 && ui.draft.people[1].existingId === 'p_liam');
  await click('draft-review');
  ok('step 2 → step 3 and the review shows everyone', ui.draft.step === 3 && root().includes('Submit session') && root().includes('Hope Adeyemi') && root().includes('Liam Carter') && root().includes('Contact: 07700 900555'));
  await click('draft-back'); ok('Back returns to step 2 with everything still there', ui.draft.step === 2 && root().includes('value="Hope Adeyemi"') && ui.draft.people.length === 2);
  await click('draft-review'); await click('draft-goto', { step: '1' });
  ok('Edit on the review returns to step 1', ui.draft.step === 1 && root().includes('value="' + pastDay + '"') && root().includes('Smoke test outing'));
  await click('draft-next'); await click('draft-review');
  const sBefore = state.sessions.length, pBefore = state.people.length, eBefore = state.encounters.length;
  const k = ui.draft.key;
  await click('submit-session'); await click('submit-session');
  ok('submitting (even twice) saves one session with its people together', state.sessions.length === sBefore + 1 && state.people.length === pBefore + 1 && state.encounters.length === eBefore + 2 && state.sessions.some(s => s.submissionKey === k));
  ok('success goes to the new session with a clear message, and the draft is gone', ui.page === 'session' && ui.draft === null && root().includes('Session saved with 2 people (1 new).') && root().includes('Hope Adeyemi') && root().includes(fmtDay(pastDay)));
  ok('the saved session is in storage', JSON.parse(localStorage.getItem(STORE_KEY)).sessions.some(s => s.submissionKey === k));
  ok('the outreach date was kept, not replaced by today', state.sessions.find(s => s.submissionKey === k).outreachDate === pastDay && isoDate(state.sessions.find(s => s.submissionKey === k).enteredAt) === isoDate(Date.now()));
  await click('open-person', { id: state.people.find(p => p.name === 'Hope Adeyemi').id });
  ok('opening a person from a session shows their profile with a back link to the session', ui.page === 'person' && root().includes('Hope Adeyemi') && root().includes('07700 900555') && root().includes('Back to the session'));
  await click('back-from', { page: 'people' });
  ok('Back returns to the session', ui.page === 'session' && root().includes('Smoke test outing'));
  await click('nav', { page: 'people' });
  ok('People lists the new person and filters as you type', rowsIn(root(), 'open-person') === 6);
  await __listeners.input({ target: { dataset: { input: 'people-q' }, value: 'hope' } });
  ok('the people search narrows the table', rowsIn(__els['people-table']._html, 'open-person') === 1 && !__els['people-table']._html.includes('07700'));
  await __listeners.input({ target: { dataset: { input: 'people-q' }, value: '' } });
  await click('nav', { page: 'sessions' });
  ok('the sessions list now has four rows', rowsIn(root(), 'open-session') === 4);
  await filterBy('sess-area', 'a_centre');
  ok('the area filter updates the table', rowsIn(__els['sessions-table']._html, 'open-session') === 1);
  await click('clear-session-filters'); ok('clear filters restores the list', rowsIn(root(), 'open-session') === 4);

  /* discard, keep-while-navigating, and no leaking between people */
  await click('open-record'); await typeInto('session.areaId', 'a_centre');
  await click('draft-discard');
  ok('discarding a draft with content asks first', __els.dlg.open && __els.dlg._html.includes('Discard this draft?') && ui.draft !== null);
  await click('confirm-yes');
  ok('confirming discards it and returns to the list', ui.draft === null && ui.page === 'sessions');
  await click('open-record'); await typeInto('session.notes', 'Private draft text'); await click('nav', { page: 'people' }); await click('nav', { page: 'sessions' });
  ok('a draft survives moving around and is offered again', ui.draft && ui.draft.session.notes === 'Private draft text' && root().includes('unsent session draft'));
  await click('toggle-account'); await click('sign-out');
  ok('signing out throws the draft away', ui.draft === null && ui.sessionId === null);
  await signInAs('grace@example.org');
  await click('open-record');
  ok('the next person starts with a blank draft', ui.draft.session.notes === '' && ui.draft.people.length === 0);
  ok('Grace sees only her team’s sessions', (await click('nav', { page: 'sessions' }), rowsIn(root(), 'open-session') === 2 && !root().includes('Hope') && !root().includes('Sarah Mitchell')));
  ui.draft = null;
  await click('toggle-account'); await click('sign-out');
  await signInAs('tunde@example.org');
  await click('nav', { page: 'sessions' });
  ok('the team leader sees Team B’s sessions only', rowsIn(root(), 'open-session') === 2);
  await click('open-session', { id: state.sessions.find(s => s.id === 's_a1').id });
  ok('opening another team’s session by id gives a 404 and no data', root().includes('Error 404') && !root().includes('Freshers') && !root().includes('Amara'));
  await click('open-person', { id: 'p_amara' });
  ok('opening another team’s person by id gives a 404 and no data', root().includes('Error 404') && !root().includes('Amara') && !root().includes('07700'));
  await click('nav', { page: 'dashboard' });
  ok('the team leader’s dashboard shows Team B totals', root().includes('Team B') && !root().includes('Team A') && root().includes('<p class="kpi-value">3</p>'));
  await click('toggle-account'); await click('sign-out');

  /* admin: areas */
  await signInAs('michael@example.org');
  await click('nav', { page: 'settings' });
  ok('settings shows the areas card', root().includes('Outreach areas') && rowsIn(root(), 'area-toggle') === 4);
  let af = await submit('area-add', { name: 'Riverside walk' });
  ok('an area can be added', state.areas.some(a => a.name === 'Riverside walk') && rowsIn(root(), 'area-toggle') === 5);
  af = await submit('area-add', { name: 'riverside WALK' });
  ok('a duplicate area name is refused with a message', af.errs.name && /already exists/.test(af.errs.name.textContent));
  af = await submit('area-add', { name: ' ' });
  ok('a blank area name is refused', af.errs.name && af.errs.name.textContent.length > 0);
  const riverId = state.areas.find(a => a.name === 'Riverside walk').id;
  await click('area-rename', { id: riverId });
  ok('the rename dialog opens', __els.dlg.open && __els.dlg._html.includes('Rename area'));
  await submit('area-rename', { name: 'River path' }, { areaId: riverId });
  ok('renaming saves and closes the dialog', state.areas.find(a => a.id === riverId).name === 'River path' && !__els.dlg.open);
  await click('area-toggle', { id: riverId });
  ok('an area can be switched off', state.areas.find(a => a.id === riverId).active === false && root().includes('River path'));
  await click('area-toggle', { id: riverId });
  await click('toggle-account'); await click('sign-out');

  /* failure paths must keep the draft and report honestly */
  await signInAs('sarah@example.org');
  const sessionsBefore = state.sessions.length;
  const prepare = async () => { await click('open-record'); await typeInto('session.areaId', 'a_station'); await typeInto('session.typeKey', 'other'); await click('draft-next'); await click('add-person'); await typeInto('people.0.name', 'Failure Case'); await click('draft-review'); };
  await prepare();
  ok('the review is reached', ui.draft.step === 3);
  setAreaActive(state, 'u_michael', 'a_station', false);
  await click('submit-session');
  ok('if the area was switched off meanwhile, nothing is saved, the draft is kept and step 1 shows the problem', state.sessions.length === sessionsBefore && ui.draft && ui.draft.step === 1 && root().includes('We couldn’t save this session') && root().includes('isn’t available any more') && ui.draft.people.length === 1 && ui.page === 'record');
  setAreaActive(state, 'u_michael', 'a_station', true);
  await click('draft-next'); await click('draft-review');
  const realCreate = createSession;
  createSession = function () { state.sessions.push({ id: 'half-saved', createdBy: 'u_sarah', participantIds: [], outreachDate: '2026-01-01', startTime: '', enteredAt: 0 }); throw new Error('boom'); };
  const quiet = console.error; console.error = () => {};
  await click('submit-session');
  console.error = quiet; createSession = realCreate;
  ok('if saving throws part-way, everything is rolled back and the draft stays', state.sessions.length === sessionsBefore && !state.sessions.some(s => s.id === 'half-saved') && ui.draft && root().includes('Something went wrong while saving') && ui.page === 'record');
  const realSet = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('storage blocked'); };
  await click('submit-session');
  localStorage.setItem = realSet;
  ok('if the browser blocks storage the message says so instead of claiming it is safe', state.sessions.length === sessionsBefore + 1 && root().includes('blocking storage') && ui.storageOK === false);
  ui.storageOK = true;
  await click('toggle-account'); await click('sign-out');

  /* ======================= STAGE 3: the follow-up pipeline, through real events ======================= */
  await click('ask-reset-demo'); await click('confirm-yes');
  const todayS = isoDate(Date.now());
  const toastHas = t => __els.toasts.children.some(c => c._html.includes(t));
  const dlgKey = () => (dlgHtml().match(/data-key="([^"]+)"/) || [])[1];
  await signInAs('john@example.org');
  ok('a team leader lands on a dashboard with a real follow-up summary', ui.page === 'dashboard' && root().includes('Where follow-up is falling behind') && root().includes('Follow-ups due'));
  await click('nav', { page: 'pipeline' });
  ok('the pipeline lists three open cases and one suggestion, and is no longer a placeholder', ui.page === 'pipeline' && rowsIn(root(), 'open-case-page') === 3 && root().includes('Suggested by evangelists (1)') && !root().includes('Planned for build stage'));
  await __listeners.input({ target: { dataset: { input: 'pipe-q' }, value: 'noor' } });
  ok('typing in the search narrows only the table', rowsIn(__els['pipeline-table']._html, 'open-case-page') === 1 && ui.pipeFilter.q === 'noor');
  await __listeners.input({ target: { dataset: { input: 'pipe-q' }, value: '' } });
  await filterBy('pipe-assignee', 'none');
  ok('the assignee filter updates the table and explains an empty result', rowsIn(__els['pipeline-table']._html, 'open-case-page') === 0 && __els['pipeline-table']._html.includes('No cases match these filters'));
  await click('clear-pipe-filters');
  ok('clearing the filters restores the list', rowsIn(root(), 'open-case-page') === 3 && ui.pipeFilter.assignee === 'all');
  await click('pipe-stage', { stage: 'integrating' });
  ok('a stage chip filters the list and keeps focus on itself', rowsIn(root(), 'open-case-page') === 1 && ui.pipeFilter.stage === 'integrating' && /data-stage="integrating" aria-pressed="true"/.test(root()));
  await click('pipe-stage', { stage: 'open' });

  // open a case from the suggestion queue
  await click('open-case', { id: 'p_liam' });
  ok('Open case from the queue opens a dialog for that person', __els.dlg.open && dlgHtml().includes('Open a follow-up case') && dlgHtml().includes('Liam Carter'));
  const casesBefore = state.cases.length;
  f = await submit('case-open', { assigneeId: 'u_grace', nextAction: '', nextContactDate: '' }, { personId: 'p_liam' });
  ok('assigning someone who cannot follow up is refused beside the field and saves nothing', f.errs.assigneeId && f.errs.assigneeId.textContent && state.cases.length === casesBefore && __els.dlg.open);
  f = await submit('case-open', { assigneeId: 'u_daniel', nextAction: 'Say hello and introduce ourselves', nextContactDate: '' }, { personId: 'p_liam' });
  const liamCase = state.cases.find(c => c.personId === 'p_liam');
  ok('opening the case saves it, closes the dialog and goes to the case page with a message', state.cases.length === casesBefore + 1 && liamCase.stage === 'awaiting' && !__els.dlg.open && ui.page === 'case' && ui.caseId === liamCase.id && root().includes('Follow-up case opened.') && root().includes('Say hello and introduce ourselves'));
  ok('the case is in storage', JSON.parse(localStorage.getItem(STORE_KEY)).cases.some(c => c.id === liamCase.id));
  await click('nav', { page: 'pipeline' });
  ok('the queue is empty and the new case is listed', !root().includes('Suggested by evangelists') && rowsIn(root(), 'open-case-page') === 4);
  f = await submit('case-open', { assigneeId: '', nextAction: '', nextContactDate: '' }, { personId: 'p_liam' });
  ok('a second case for the same person is refused with a clear message', f.fe.hidden === false && /already has an open/.test(f.fe.textContent) && state.cases.length === casesBefore + 1);

  // record contacts
  await click('open-case-page', { id: liamCase.id });
  ok('the case page has the action buttons', root().includes('data-action="contact-open"') && root().includes('data-action="stage-open"') && root().includes('data-action="assign-open"') && root().includes('data-action="nextstep-open"'));
  await click('contact-open', { id: liamCase.id });
  ok('the contact dialog opens with its own submission key', __els.dlg.open && dlgHtml().includes('Record a contact') && !!dlgKey());
  const key1 = dlgKey(), kBefore = state.contacts.length;
  f = await submit('contact-add', { contactDate: todayS, contactTime: '', method: 'call', outcome: 'no_answer', response: 'receptive', attendance: '', notes: '', nextAction: '', nextContactDate: '', stageTo: '', closeReason: '' }, { caseId: liamCase.id, key: key1 });
  ok('a missed call with a response is refused beside the field and nothing is saved', f.errs.response && f.errs.response.textContent && state.contacts.length === kBefore && __els.dlg.open);
  f = await submit('contact-add', { contactDate: todayS, contactTime: '', method: 'call', outcome: 'no_answer', response: '', attendance: '', notes: 'Rang twice.', nextAction: 'Try again tomorrow', nextContactDate: isoDate(Date.now() + DAY), stageTo: '', closeReason: '' }, { caseId: liamCase.id, key: key1 });
  ok('a missed call is saved as an attempt, the stage stays and the plan is replaced', state.contacts.length === kBefore + 1 && liamCase.stage === 'awaiting' && liamCase.nextAction === 'Try again tomorrow' && root().includes('Contact saved.') && root().includes('Tried to reach') && !__els.dlg.open);
  f = await submit('contact-add', { contactDate: todayS, contactTime: '', method: 'call', outcome: 'no_answer', response: '', attendance: '', notes: 'Rang twice.', nextAction: 'Try again tomorrow', nextContactDate: isoDate(Date.now() + DAY), stageTo: '', closeReason: '' }, { caseId: liamCase.id, key: key1 });
  ok('submitting the same dialog again saves nothing twice', state.contacts.length === kBefore + 1 && root().includes('already been saved'));
  await click('contact-open', { id: liamCase.id });
  const key2 = dlgKey();
  ok('each opening of the dialog has a fresh key', key2 && key2 !== key1);
  f = await submit('contact-add', { contactDate: todayS, contactTime: '', method: 'call', outcome: 'no_answer', response: '', attendance: '', notes: '', nextAction: '', nextContactDate: '', stageTo: 'contacted', closeReason: '' }, { caseId: liamCase.id, key: key2 });
  ok('trying to move to Contacted after only a missed call is refused with the reason', f.errs.stageTo && /conversation/.test(f.errs.stageTo.textContent) && liamCase.stage === 'awaiting' && state.contacts.length === kBefore + 1);
  f = await submit('contact-add', { contactDate: todayS, contactTime: '', method: 'call', outcome: 'spoke', response: 'receptive', attendance: '', notes: 'Happy to meet for coffee.', nextAction: 'Coffee on Saturday', nextContactDate: isoDate(Date.now() + 3 * DAY), stageTo: 'contacted', closeReason: '' }, { caseId: liamCase.id, key: key2 });
  ok('a conversation with Contacted selected saves the contact and moves the case together', liamCase.stage === 'contacted' && state.contacts.length === kBefore + 2 && root().includes('moved to Contacted') && root().includes('Contacted') && root().includes('Reached them'));
  ok('the timeline now shows the earlier attempt below the conversation', root().indexOf('Reached them') < root().indexOf('Tried to reach'));

  // the live form behaviour
  const part = { '#ct-conv': { hidden: true }, '#ct-nocontact': { hidden: true }, '#ct-close': { hidden: true } };
  const sel = v => ({ value: v });
  const live = { dataset: { caseId: 'c_ben' }, elements: { outcome: sel('spoke'), method: sel('call'), response: sel('receptive'), attendance: sel(''), stageTo: sel('') }, querySelector: q => part[q] || null };
  const change = async (kind, value) => __listeners.change({ target: { dataset: { input: kind }, value: value, form: live } });
  await change('contact-outcome', 'spoke');
  ok('choosing a conversation shows the conversation fields and suggests Contacted', part['#ct-conv'].hidden === false && live.elements.stageTo.value === 'contacted');
  live.elements.outcome.value = 'no_answer'; await change('contact-outcome', 'no_answer');
  ok('choosing a missed call hides and clears the conversation fields and suggests nothing', part['#ct-conv'].hidden === true && live.elements.response.value === '' && live.elements.stageTo.value === '');
  live.elements.outcome.value = 'seen_at_church'; await change('contact-outcome', 'seen_at_church');
  ok('seeing someone at church sets the method to in person and suggests Attended', live.elements.method.value === 'in_person' && live.elements.stageTo.value === 'attended');
  live.elements.outcome.value = 'asked_no_contact'; await change('contact-outcome', 'asked_no_contact');
  ok('“asked not to be contacted” warns, suggests closing and asks for the reason', part['#ct-nocontact'].hidden === false && live.elements.stageTo.value === 'closed' && part['#ct-close'].hidden === false);
  live.elements.stageTo.value = 'attended'; await change('contact-stage', 'attended'); live.elements.outcome.value = 'spoke'; await change('contact-outcome', 'spoke');
  ok('once someone picks a stage themselves it is not overwritten, and the close reason hides again', live.elements.stageTo.value === 'attended' && part['#ct-close'].hidden === true && part['#ct-nocontact'].hidden === true);

  // change stage, next step, assign
  await click('stage-open', { id: liamCase.id });
  ok('the stage dialog opens', __els.dlg.open && dlgHtml().includes('Change stage') && dlgHtml().includes('disabled'));
  f = await submit('stage-change', { to: 'attended', note: '', closeReason: '' }, { caseId: liamCase.id });
  ok('a move without evidence is refused with the reason in the form', f.fe.hidden === false && /came|saw/.test(f.fe.textContent) && liamCase.stage === 'contacted');
  f = await submit('stage-change', { to: 'awaiting', note: '', closeReason: '' }, { caseId: liamCase.id });
  ok('moving back without a reason is refused', f.fe.hidden === false && /reason/.test(f.fe.textContent) && liamCase.stage === 'contacted');
  f = await submit('stage-change', { to: 'awaiting', note: 'Logged as contacted too early', closeReason: '' }, { caseId: liamCase.id });
  ok('moving back with a reason works and says so', liamCase.stage === 'awaiting' && root().includes('Stage changed to Awaiting contact.') && root().includes('Logged as contacted too early') && root().includes('Moved back'));
  await click('nextstep-open', { id: liamCase.id });
  f = await submit('next-step', { nextAction: 'Send a message', nextContactDate: isoDate(Date.now() - DAY) }, { caseId: liamCase.id });
  ok('a next step in the past is refused beside the date field', f.errs.nextContactDate && f.errs.nextContactDate.textContent && liamCase.nextAction === 'Coffee on Saturday');
  f = await submit('next-step', { nextAction: 'Send a message', nextContactDate: isoDate(Date.now() + 2 * DAY) }, { caseId: liamCase.id });
  ok('a valid next step is saved and shown', liamCase.nextAction === 'Send a message' && root().includes('Next step saved.') && root().includes('Send a message'));
  await click('assign-open', { id: liamCase.id });
  ok('the assign dialog lists only people who can follow up on the team', dlgHtml().includes('value="u_daniel"') && dlgHtml().includes('value="u_john"') && !dlgHtml().includes('value="u_sarah"'));
  f = await submit('case-assign', { assigneeId: 'u_john' }, { caseId: liamCase.id });
  ok('reassigning saves and says who', liamCase.assigneeId === 'u_john' && root().includes('Assigned to John'));
  f = await submit('case-assign', { assigneeId: 'u_sarah' }, { caseId: liamCase.id });
  ok('assigning an evangelist is refused', f.fe.hidden === false && liamCase.assigneeId === 'u_john');

  // close and reopen
  await click('stage-open', { id: liamCase.id });
  f = await submit('stage-change', { to: 'closed', note: '', closeReason: '' }, { caseId: liamCase.id });
  ok('closing without a reason is refused', f.fe.hidden === false && liamCase.stage === 'awaiting');
  f = await submit('stage-change', { to: 'closed', note: 'Moved to Leeds', closeReason: 'moved_away' }, { caseId: liamCase.id });
  ok('closing stores the reason and the case page shows it, with no way to log more contact', liamCase.stage === 'closed' && root().includes('Moved away') && root().includes('Reopen case') && !root().includes('data-action="contact-open"'));
  await click('nav', { page: 'pipeline' });
  ok('closed cases leave the default list', rowsIn(root(), 'open-case-page') === 3);
  await click('pipe-stage', { stage: 'closed' });
  ok('and appear under the Closed chip', rowsIn(root(), 'open-case-page') === 1);
  await click('clear-pipe-filters');

  // corrections
  await click('open-case-page', { id: 'c_noor' });
  ok('the case page for Noor shows an overdue plan and Correct buttons for a team leader', root().includes('Overdue by 1 day') && rowsIn(root(), 'correct-open') >= 2);
  await click('correct-open', { kind: 'contact', id: 'k_n2' });
  ok('the correction dialog opens and explains what is logged', __els.dlg.open && dlgHtml().includes('Correct this contact') && dlgHtml().includes('but not what the old wording was'));
  const kn2 = state.contacts.find(k => k.id === 'k_n2');
  const same = Object.assign({ contactDate: kn2.contactDate, contactTime: kn2.contactTime, method: kn2.method, outcome: kn2.outcome, response: kn2.response, attendance: kn2.attendance, notes: kn2.notes });
  f = await submit('correct', Object.assign({}, same, { response: 'receptive', reason: '' }), { kind: 'contact', id: 'k_n2' });
  ok('a correction without a reason is refused beside the field', f.errs.reason && f.errs.reason.textContent && kn2.response === 'prayer' && state.corrections.length === 0);
  f = await submit('correct', Object.assign({}, same), { kind: 'contact', id: 'k_n2' });
  f = await submit('correct', Object.assign({}, same, { reason: 'No change really' }), { kind: 'contact', id: 'k_n2' });
  ok('a correction that changes nothing says so and is not logged', f.fe.hidden === false && /Nothing was changed/.test(f.fe.textContent) && state.corrections.length === 0);
  f = await submit('correct', Object.assign({}, same, { response: 'receptive', reason: 'It was a conversation, not a prayer request' }), { kind: 'contact', id: 'k_n2' });
  ok('a valid correction is saved, logged and shown as Corrected', kn2.response === 'receptive' && state.corrections.length === 1 && !__els.dlg.open && root().includes('Corrected once') && root().includes('It was a conversation, not a prayer request') && toastHas('Correction saved'));
  ok('the log names the field and both coded values', state.corrections[0].changes[0].field === 'response' && state.corrections[0].changes[0].from === 'prayer' && state.corrections[0].changes[0].to === 'receptive' && root().includes('Response changed from Received prayer to Open to talking more'));

  // duplicates and merging
  state.people.push({ id: 'p_dup', name: 'amara eze', phone: '07700 900101', email: '', contactVoluntary: true, createdBy: 'u_sarah', createdAt: Date.now() - 3600000 });
  state.encounters.push({ id: 'e_dup', sessionId: 's_a3', personId: 'p_dup', response: 'listened', followUpSuggested: false, notes: '', recordedBy: 'u_sarah', recordedAt: Date.now() - 3600000 });
  await click('nav', { page: 'people' });
  ok('the people page shows a duplicate count and the stage filter', root().includes('Possible duplicates (1)') && root().includes('data-input="people-stage"'));
  await filterBy('people-stage', 'integrating');
  ok('the stage filter narrows the directory', rowsIn(__els['people-table']._html, 'open-person') === 1 && __els['people-table']._html.includes('Amara'));
  await filterBy('people-stage', 'all');
  await click('open-duplicates');
  ok('the duplicates page shows the pair with its reasons', ui.page === 'duplicates' && root().includes('Same phone number') && root().includes('Similar names') && rowsIn(root(), 'pair-merge') === 1);
  await click('pair-merge', { a: 'p_amara', b: 'p_dup' });
  ok('the merge dialog warns that it cannot be undone', __els.dlg.open && dlgHtml().includes('Merge these records?') && dlgHtml().includes('be undone'));
  f = await submit('merge', {}, { a: 'p_amara', b: 'p_dup' });
  ok('submitting without choosing a record to keep is refused', f.fe.hidden === false && state.merges.length === 0);
  const mergedBefore = state.encounters.filter(e => e.personId === 'p_amara').length;
  f = await submit('merge', { keepId: 'p_amara' }, { a: 'p_amara', b: 'p_dup' });
  ok('merging moves the meetings, retires the other record and says what moved', state.merges.length === 1 && state.encounters.filter(e => e.personId === 'p_amara').length === mergedBefore + 1 && state.people.find(p => p.id === 'p_dup').archived === true && toastHas('Merged.') && !__els.dlg.open && root().includes('No possible duplicates'));
  state.people.push({ id: 'p_dup2', name: 'liam carter', phone: '', email: '', contactVoluntary: false, createdBy: 'u_sarah', createdAt: Date.now() - 3600000 });
  state.encounters.push({ id: 'e_dup2', sessionId: 's_a1', personId: 'p_dup2', response: 'listened', followUpSuggested: false, notes: '', recordedBy: 'u_sarah', recordedAt: Date.now() - 3600000 });
  await click('nav', { page: 'people' }); await click('open-duplicates');
  ok('another suspected pair shows up', rowsIn(root(), 'pair-different') === 1);
  await click('pair-different', { a: 'p_liam', b: 'p_dup2' });
  ok('“not the same person” hides the pair for good', state.dupDecisions.length === 1 && root().includes('No possible duplicates') && toastHas('Marked as different'));

  // honest failure: a save that throws part-way is rolled back
  await click('nav', { page: 'pipeline' }); await click('open-case-page', { id: 'c_ben' });
  await click('contact-open', { id: 'c_ben' });
  const realRecord = recordContact, snapKeys = state.contacts.length, snapEvents = state.caseEvents.length;
  recordContact = function () { state.contacts.push({ id: 'half-saved', caseId: 'c_ben' }); state.caseEvents.push({ id: 'half-event', caseId: 'c_ben' }); throw new Error('boom'); };
  const quiet3 = console.error; console.error = () => {};
  f = await submit('contact-add', { contactDate: todayS, method: 'call', outcome: 'no_answer' }, { caseId: 'c_ben', key: 'rollback-test' });
  console.error = quiet3; recordContact = realRecord;
  ok('if saving a contact throws part-way, everything is rolled back and the form says so', state.contacts.length === snapKeys && state.caseEvents.length === snapEvents && !state.contacts.some(k => k.id === 'half-saved') && f.fe.hidden === false && /Nothing was saved/.test(f.fe.textContent));
  await click('dlg-close');

  // evangelists, pastor and admin cannot reach any of it
  await click('toggle-account'); await click('sign-out');
  await signInAs('sarah@example.org');
  await click('open-about');
  __els['try-page'] = Object.assign(makeEl(), { value: 'pipeline' });
  await click('try-page');
  ok('an evangelist trying the pipeline directly gets a 403 and no names', ui.forbidden === true && root().includes('Error 403') && !/Noor|Priscilla|Ben Taylor/.test(root()));
  ui.forbidden = false; ui.caseId = 'c_noor'; await go('case', { caseId: 'c_noor' });
  ok('an evangelist trying a case by id gets a 403 too', ui.forbidden === true && root().includes('Error 403') && !root().includes('Noor'));
  await click('open-case', { id: 'p_liam' });
  ok('an evangelist cannot open the open-case dialog even by forcing the click', !dlgHtml().includes('Open a follow-up case') && toastHas('We couldn'));
  await click('pair-merge', { a: 'p_amara', b: 'p_liam' });
  ok('nor the merge dialog', !dlgHtml().includes('Merge these records?'));
  await click('nav', { page: 'people' });
  ok('the evangelist’s directory has no follow-up filter', !root().includes('data-input="people-stage"') && !root().includes('Possible duplicates'));
  await click('toggle-account'); await click('sign-out');
  await signInAs('tunde@example.org');
  await click('nav', { page: 'pipeline' });
  ok('Tunde’s pipeline holds Team B’s case only', rowsIn(root(), 'open-case-page') === 1 && root().includes('Priscilla Mensah') && !root().includes('Amara'));
  await go('case', { caseId: 'c_amara' });
  ok('Tunde opening a Team A case by id gets a 404 and no data', root().includes('Error 404') && !root().includes('Amara') && !root().includes('youth'));
  await click('toggle-account'); await click('sign-out');
  await signInAs('apollos@example.org');
  await click('open-about'); __els['try-page'] = Object.assign(makeEl(), { value: 'pipeline' }); await click('try-page');
  ok('the pastor gets a 403 on the pipeline and the dashboard has no case data', ui.forbidden === true && root().includes('Error 403'));
  await click('go-home');
  ok('the pastor’s dashboard shows no follow-up cards', !root().includes('Follow-up at a glance') && !/Noor|Priscilla|Amara/.test(root()));
  await click('toggle-account'); await click('sign-out');

  /* older saved data is upgraded rather than lost */
  const old = JSON.parse(JSON.stringify(state)); delete old.areas; delete old.people; delete old.sessions; delete old.encounters; old.version = 1; old.settings.churchName = 'Old Kharis';
  localStorage.setItem(STORE_KEY, JSON.stringify(old));
  await __listeners['window:storage']({ key: STORE_KEY });
  ok('version 1 data in storage is upgraded on load and keeps what was there', state.version === APP.stateVersion && state.settings.churchName === 'Old Kharis' && state.sessions.length > 5 && state.areas.length === 4 && state.cases.length > 4);
  await click('ask-reset-demo'); await click('confirm-yes');

  // blocked storage must not break the app
  const failed = log.filter(l => !l[1]);
  return { total: log.length, failed };
})()`;
vm.runInContext(scenario, ctx).then(r => {
  console.log('smoke checks:', r.total, ' failed:', r.failed.length);
  r.failed.forEach(f => console.log('  FAIL:', f[0], f[2] ? '\n      ' + String(f[2]).slice(0, 300) : ''));
  process.exit(r.failed.length ? 1 : 0);
}).catch(e => { console.log('SMOKE HARNESS ERROR:', e && e.stack || e); process.exit(2); });
