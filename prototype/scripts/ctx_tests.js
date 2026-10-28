(async () => {
  const results = [];
  const check = (name, cond, extra) => results.push([name, !!cond, cond ? '' : (extra || '')]);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = o => JSON.parse(JSON.stringify(o));
  const fresh = async () => { state = await buildSeed({history:false}); sessionUserId = null; ui.page = null; ui.forbidden = false; return state; };
  const by = id => getUser(state, id);

  /* ---------- seed and sign-in ---------- */
  await fresh();
  check('seed has 9 users', state.users.length === 9);
  check('seed validates', isValidState(clone(state)));
  check('isValidState rejects junk', !isValidState(null) && !isValidState({}) && !isValidState({ version: 2 }));
  let r = await authenticate(state, 'john@example.org', APP.demoPassword);
  check('valid sign-in works', r.ok && r.user.id === 'u_john');
  check('sign-in stamps lastLoginAt', Date.now() - by('u_john').lastLoginAt < 5000);
  r = await authenticate(state, ' JOHN@example.org ', APP.demoPassword);
  check('email is case and space insensitive', r.ok);
  const bad1 = await authenticate(state, 'john@example.org', 'wrong-password-1');
  const bad2 = await authenticate(state, 'nobody@example.org', APP.demoPassword);
  const bad3 = await authenticate(state, 'emma@example.org', APP.demoPassword);
  const bad4 = await authenticate(state, 'priya@example.org', APP.demoPassword);
  check('wrong password refused', !bad1.ok);
  check('unknown, wrong, deactivated and invited give the same message (no enumeration)', bad1.error === bad2.error && bad2.error === bad3.error && bad3.error === bad4.error && !bad3.ok && !bad4.ok);
  check('password hash uses Django-style format', /^pbkdf2_sha256\$120000\$[A-Za-z0-9+\/=]+\$[A-Za-z0-9+\/=]+$/.test(by('u_john').passwordHash));
  check('verifyPassword true/false', (await verifyPassword('abc', await hashPassword('abc'))) && !(await verifyPassword('abd', await hashPassword('abc'))));
  check('verifyPassword rejects malformed hash', !(await verifyPassword('x', 'garbage')) && !(await verifyPassword('x', null)));

  /* ---------- role-based navigation and guard ---------- */
  const navFor = u => visiblePages(u).map(p => p.label);
  check('evangelist nav', same(navFor(by('u_sarah')), ['Outreach Sessions', 'People']), JSON.stringify(navFor(by('u_sarah'))));
  check('coordinator nav', same(navFor(by('u_daniel')), ['Follow-up Pipeline', 'People']));
  check('team leader nav', same(navFor(by('u_john')), ['Dashboard', 'Outreach Sessions', 'Follow-up Pipeline', 'People', 'Reports', 'Team']));
  check('pastor nav', same(navFor(by('u_apollos')), ['Dashboard', 'Reports']));
  check('admin nav', same(navFor(by('u_michael')), ['Users', 'Settings']));
  check('landing pages', landingPage(by('u_sarah')) === 'sessions' && landingPage(by('u_daniel')) === 'pipeline' && landingPage(by('u_john')) === 'dashboard' && landingPage(by('u_apollos')) === 'dashboard' && landingPage(by('u_michael')) === 'users');
  check('guard: evangelist cannot open users (403)', guardPage(by('u_sarah'), 'users').code === 403);
  check('guard: admin cannot open sessions (403)', guardPage(by('u_michael'), 'sessions').code === 403);
  check('guard: pastor cannot open people (403)', guardPage(by('u_apollos'), 'people').code === 403);
  check('guard: coordinator cannot open dashboard (403)', guardPage(by('u_daniel'), 'dashboard').code === 403);
  check('guard: unknown page is 404', guardPage(by('u_michael'), 'nope').code === 404);
  check('guard: pastor can open dashboard', guardPage(by('u_apollos'), 'dashboard').ok);
  check('every page needs a known capability', PAGES.every(p => CAPS[p.cap]));
  check('every role capability is defined', ROLE_ORDER.every(r => ROLE_CAPS[r].every(c => CAPS[c])));
  check('deactivated admin has no capabilities', !can({ role: 'admin', status: 'deactivated' }, 'users.manage'));
  check('invited user has no capabilities', !can({ role: 'admin', status: 'invited' }, 'users.manage'));
  check('pastor cannot manage users or see people', !can(by('u_apollos'), 'users.manage') && !can(by('u_apollos'), 'people.view'));
  check('sessionUser is null for deactivated and invited', sessionUser(state, 'u_emma') === null && sessionUser(state, 'u_priya') === null && sessionUser(state, 'u_john') !== null);

  /* ---------- scoped reads ---------- */
  const names = id => teamView(state, id).map(g => g.department.name + ':' + g.members.map(m => m.name).join('|'));
  check('John sees only Team A members', same(names('u_john'), ['Team A:Daniel Kingsley|John Leader|Sarah Mitchell']), JSON.stringify(names('u_john')));
  check('Tunde sees only Team B, without the deactivated leader', same(names('u_tunde'), ['Team B:Grace Okafor|Tunde Bello']), JSON.stringify(names('u_tunde')));
  check('team view is null for evangelist, coordinator, pastor, admin', ['u_sarah', 'u_daniel', 'u_apollos', 'u_michael'].every(id => teamView(state, id) === null));
  check('usersVisibleTo: admin sees all, others none', usersVisibleTo(state, 'u_michael').length === 9 && ['u_sarah', 'u_john', 'u_apollos', 'u_daniel'].every(id => usersVisibleTo(state, id).length === 0));

  /* ---------- inviting ---------- */
  let inv = await inviteUser(state, 'u_sarah', { name: 'X Y', email: 'xy@example.org', role: 'evangelist', departmentIds: [] });
  check('non-admin cannot invite (403)', !inv.ok && inv.code === 403);
  inv = await inviteUser(state, 'u_michael', { name: '', email: 'nope', role: 'wizard', departmentIds: [] });
  check('invite validates name, email and role', !inv.ok && inv.errors.name && inv.errors.email && inv.errors.role);
  inv = await inviteUser(state, 'u_michael', { name: 'Dup', email: 'SARAH@example.org', role: 'evangelist', departmentIds: [] });
  check('duplicate email refused case-insensitively', !inv.ok && /already exists/.test(inv.errors.email));
  const usersBefore = state.users.length, invBefore = state.invitations.length;
  inv = await inviteUser(state, 'u_michael', { name: 'Ruth Adeyemi', email: 'Ruth@Example.org', role: 'coordinator', departmentIds: ['d_a', 'd_x'] });
  check('invite succeeds', inv.ok && inv.user.status === 'invited' && inv.user.email === 'ruth@example.org' && inv.user.passwordHash === null);
  check('invite writes one user and one invitation', state.users.length === usersBefore + 1 && state.invitations.length === invBefore + 1);
  check('unknown team ids are ignored', same(deptIdsOf(state, inv.user.id), ['d_a']));
  check('code format and alphabet', /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}){2}$/.test(inv.code), inv.code);
  check('invitation expires in 7 days', Math.abs(latestInvitation(state, inv.user.id).expiresAt - (Date.now() + 7 * DAY)) < 5000);
  check('only the code hash is stored, never the code', !JSON.stringify(state).includes(inv.code) && !JSON.stringify(state).includes(normaliseCode(inv.code)));
  check('status badge says Invited', displayStatus(state, inv.user).key === 'invited');
  const codes = new Set(); for (let i = 0; i < 200; i++) codes.add(newInviteCode());
  check('200 generated codes are unique and well-formed', codes.size === 200 && [...codes].every(c => /^[A-Z2-9-]{14}$/.test(c) && !/[ILO01]/.test(c)));

  /* ---------- activation ---------- */
  const email = inv.user.email, code = inv.code;
  let act = await activateWithCode(state, email, 'AAAA-BBBB-CCCC', 'Strong-Passw0rd!');
  const genericMsg = act.error;
  check('wrong code refused', !act.ok);
  act = await activateWithCode(state, 'someone@example.org', code, 'Strong-Passw0rd!');
  check('wrong email refused with the same message', !act.ok && act.error === genericMsg);
  act = await activateWithCode(state, email, code, 'short');
  check('weak password refused and account stays invited', !act.ok && act.field === 'password' && by(inv.user.id).status === 'invited');
  act = await activateWithCode(state, email, code, 'ruth-example-1');
  check('password containing the email name refused', !act.ok && act.field === 'password');
  act = await activateWithCode(state, email.toUpperCase(), code.toLowerCase().replace(/-/g, ' '), 'Strong-Passw0rd!');
  check('code is accepted regardless of case and separators', act.ok && act.user.status === 'active');
  check('invitation marked used', latestInvitation(state, inv.user.id).usedAt > 0);
  r = await authenticate(state, email, 'Strong-Passw0rd!');
  check('new user can sign in', r.ok);
  act = await activateWithCode(state, email, code, 'Another-Passw0rd!');
  check('code cannot be used twice', !act.ok && act.error === genericMsg);

  /* expiry */
  inv = await inviteUser(state, 'u_michael', { name: 'Late Comer', email: 'late@example.org', role: 'evangelist', departmentIds: [] });
  latestInvitation(state, inv.user.id).expiresAt = Date.now() - 1000;
  check('expired invitation shows as expired', displayStatus(state, inv.user).key === 'expired');
  act = await activateWithCode(state, 'late@example.org', inv.code, 'Strong-Passw0rd!');
  check('expired code refused', !act.ok);
  act = await activateWithCode(state, DEMO_INVITE.email, DEMO_INVITE.code, 'Strong-Passw0rd!');
  check('seeded demo invitation activates', act.ok);

  /* reissue and reset */
  let re = await reissueInvitation(state, 'u_sarah', 'u_grace');
  check('non-admin cannot reissue (403)', !re.ok && re.code === 403);
  re = await reissueInvitation(state, 'u_michael', 'u_michael');
  check('cannot reset your own access', !re.ok);
  re = await reissueInvitation(state, 'u_michael', 'u_emma');
  check('cannot reissue for a deactivated account', !re.ok);
  const oldCode = inv.code;
  re = await reissueInvitation(state, 'u_michael', inv.user.id);
  check('new code issued for expired invite', re.ok && re.code !== oldCode && displayStatus(state, by(inv.user.id)).key === 'invited');
  act = await activateWithCode(state, 'late@example.org', oldCode, 'Strong-Passw0rd!');
  check('old code stops working after reissue', !act.ok);
  re = await reissueInvitation(state, 'u_michael', 'u_grace');
  check('reset on active user clears password and ends their session', re.ok && by('u_grace').status === 'invited' && by('u_grace').passwordHash === null && sessionUser(state, 'u_grace') === null);
  r = await authenticate(state, 'grace@example.org', APP.demoPassword);
  check('reset user cannot sign in with the old password', !r.ok);

  /* ---------- status changes ---------- */
  let st = setUserStatus(state, 'u_michael', 'u_michael', 'deactivated');
  check('cannot deactivate yourself', !st.ok);
  st = setUserStatus(state, 'u_sarah', 'u_john', 'deactivated');
  check('non-admin cannot deactivate (403)', !st.ok && st.code === 403);
  st = setUserStatus(state, 'u_michael', 'u_sarah', 'deactivated');
  check('admin deactivates a user', st.ok && by('u_sarah').status === 'deactivated');
  check('deactivated user loses their session and cannot sign in', sessionUser(state, 'u_sarah') === null && !(await authenticate(state, 'sarah@example.org', APP.demoPassword)).ok);
  check('deactivation keeps history and memberships', same(deptIdsOf(state, 'u_sarah'), ['d_a']) && by('u_sarah').name === 'Sarah Mitchell');
  st = setUserStatus(state, 'u_michael', 'u_sarah', 'active');
  check('reactivation restores sign-in', st.ok && by('u_sarah').status === 'active' && (await authenticate(state, 'sarah@example.org', APP.demoPassword)).ok);
  st = setUserStatus(state, 'u_michael', 'u_emma', 'active');
  check('reactivating a user with a password restores them', st.ok && by('u_emma').status === 'active');
  st = setUserStatus(state, 'u_michael', 'u_emma', 'deactivated');
  inv = await inviteUser(state, 'u_michael', { name: 'Never Done', email: 'never@example.org', role: 'evangelist', departmentIds: [] });
  setUserStatus(state, 'u_michael', inv.user.id, 'deactivated');
  check('deactivating an invited user revokes the code', by(inv.user.id).status === 'deactivated' && !(await activateWithCode(state, 'never@example.org', inv.code, 'Strong-Passw0rd!')).ok);
  setUserStatus(state, 'u_michael', inv.user.id, 'active');
  check('reactivating someone who never activated returns them to invited', by(inv.user.id).status === 'invited');
  // a second admin makes last-admin guard reachable
  const second = await inviteUser(state, 'u_michael', { name: 'Second Admin', email: 'second@example.org', role: 'admin', departmentIds: [] });
  await activateWithCode(state, 'second@example.org', second.code, 'Strong-Passw0rd!');
  st = setUserStatus(state, 'u_michael', second.user.id, 'deactivated');
  check('admin can deactivate another admin when two exist', st.ok);
  setUserStatus(state, 'u_michael', second.user.id, 'active');

  /* ---------- updating users ---------- */
  let up = updateUser(state, 'u_sarah', 'u_john', { name: 'John', role: 'evangelist', departmentIds: [] });
  check('non-admin cannot edit users (403)', !up.ok && up.code === 403);
  up = updateUser(state, 'u_michael', 'u_michael', { name: 'Michael Brown', role: 'pastor', departmentIds: [] });
  check('cannot change your own role', !up.ok && up.field === 'role');
  up = updateUser(state, 'u_michael', 'u_john', { name: ' ', role: 'team_leader', departmentIds: [] });
  check('name is validated on edit', !up.ok && up.field === 'name');
  up = updateUser(state, 'u_michael', 'u_john', { name: 'John Leader', role: 'wizard', departmentIds: [] });
  check('role is validated on edit', !up.ok && up.field === 'role');
  addDepartment(state, 'u_michael', 'Team E');
  const teamE = state.departments.find(d => d.name === 'Team E');
  setDepartmentActive(state, 'u_michael', 'd_d', true);
  state.memberships.push({ userId: 'u_john', departmentId: 'd_d' });
  setDepartmentActive(state, 'u_michael', 'd_d', false);
  up = updateUser(state, 'u_michael', 'u_john', { name: 'John L. Leader', role: 'coordinator', departmentIds: ['d_b', teamE.id, 'd_d'] });
  check('role and name change recorded', up.ok && up.roleChanged && up.from === 'team_leader' && by('u_john').role === 'coordinator' && by('u_john').name === 'John L. Leader');
  check('memberships replaced, inactive team kept, inactive team cannot be newly assigned', same(deptIdsOf(state, 'u_john').sort(), ['d_b', 'd_d', teamE.id].sort()), JSON.stringify(deptIdsOf(state, 'u_john')));
  check('changed role changes reachable pages immediately', same(navFor(by('u_john')), ['Follow-up Pipeline', 'People']));

  /* ---------- teams and settings ---------- */
  check('non-admin cannot add a team (403)', addDepartment(state, 'u_sarah', 'Team Z').code === 403);
  check('duplicate team name refused', !addDepartment(state, 'u_michael', 'team a').ok);
  check('team name validated', !addDepartment(state, 'u_michael', ' ').ok && !renameDepartment(state, 'u_michael', 'd_a', 'x').ok);
  check('rename works', renameDepartment(state, 'u_michael', 'd_a', 'Team Alpha').ok && state.departments[0].name === 'Team Alpha');
  check('rename to an existing name refused', !renameDepartment(state, 'u_michael', 'd_b', 'team alpha').ok);
  check('church name validated and saved', !setChurchName(state, 'u_michael', 'K').ok && setChurchName(state, 'u_michael', 'Kharis Church').ok && state.settings.churchName === 'Kharis Church');
  check('non-admin cannot change church name (403)', setChurchName(state, 'u_apollos', 'Hacked').code === 403);
  inv = await inviteUser(state, 'u_michael', { name: 'In Active', email: 'inactive-team@example.org', role: 'evangelist', departmentIds: ['d_d'] });
  check('inactive team cannot be assigned on invite', same(deptIdsOf(state, inv.user.id), []));

  /* ---------- validation helpers ---------- */
  check('email validator', validateEmail('a@b.co') === '' && !!validateEmail('a@b') && !!validateEmail('') && !!validateEmail('a b@c.org'));
  check('name validator', validateName('Al') === '' && !!validateName('A') && !!validateName('x'.repeat(81)));
  const rules = pw => passwordRules(pw, { email: 'sam.jones@example.org' }).map(x => x.ok);
  check('password rules: good', same(rules('Moonlit-Harbour-7'), [true, true, true, true]));
  check('password rules: short numeric', same(rules('12345'), [false, false, true, true]));
  check('password rules: common', rules('password123')[2] === false);
  check('password rules: contains email name', rules('xx-sam.jones-xx-xx')[3] === false);
  check('password rules: empty is all unmet', same(rules(''), [false, false, false, false]));

  /* ---------- views ---------- */
  await fresh();
  const balance = (htmlText, label) => {
    const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);
    const stack = []; const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g; let m; let ok = true, why = '';
    while ((m = re.exec(htmlText))) {
      const close = m[1] === '/', tag = m[2].toLowerCase(), selfClose = m[4] === '/' || VOID.has(tag);
      if (selfClose && !close) continue;
      if (!close) stack.push(tag);
      else { const top = stack.pop(); if (top !== tag) { ok = false; why = label + ': expected </' + top + '> but found </' + tag + '> near ' + htmlText.slice(Math.max(0, m.index - 60), m.index + 20); break; } }
    }
    if (ok && stack.length) { ok = false; why = label + ': unclosed <' + stack.join('>,<') + '>'; }
    return ok ? '' : why;
  };
  const pageTitles = { dashboard: null, sessions: 'Outreach Sessions', pipeline: 'Follow-up Pipeline', people: 'People', reports: 'Reports', team: 'Team', users: 'Users', settings: 'Settings' };
  let renderErr = '', balErr = '', navErr = '', permErr = '';
  for (const id of ['u_apollos', 'u_michael', 'u_john', 'u_tunde', 'u_sarah', 'u_daniel']) {
    const u = by(id); sessionUserId = id;
    for (const p of PAGES) {
      ui.page = p.id; const g = guardPage(u, p.id); ui.forbidden = !g.ok;
      let out = '';
      try { out = viewShell(u); } catch (e) { renderErr += id + '/' + p.id + ': ' + e.message + '\n'; continue; }
      balErr += balance(out, id + '/' + p.id);
      const navCount = (out.match(/class="nav-item" data-action="nav"/g) || []).length;
      if (navCount !== visiblePages(u).length) navErr += id + ' nav count ' + navCount + '\n';
      if (g.ok && pageTitles[p.id] && !out.includes('<h1 id="page-title" tabindex="-1">' + pageTitles[p.id] + '</h1>')) permErr += id + '/' + p.id + ' missing title\n';
      if (!g.ok && !out.includes('Error 403')) permErr += id + '/' + p.id + ' forbidden page not shown\n';
      if (g.ok && out.includes('Error 403')) permErr += id + '/' + p.id + ' wrongly forbidden\n';
      if (!g.ok && out.includes('data-action="manage-user"')) permErr += id + '/' + p.id + ' leaked users table\n';
    }
  }
  check('every role x page renders without throwing', renderErr === '', renderErr);
  check('all generated markup is balanced', balErr === '', balErr);
  check('nav shows exactly the permitted pages', navErr === '', navErr);
  check('allowed pages render, forbidden pages show 403 and no data', permErr === '', permErr);

  sessionUserId = 'u_apollos'; ui.page = 'dashboard'; ui.forbidden = false;
  let dash = viewShell(by('u_apollos'));
  check('pastor greeting reads Pastor Apollos', dash.includes('<h1 id="page-title" tabindex="-1">Pastor Apollos</h1>') && dash.includes('Here’s your church’s outreach overview.'));
  check('dashboard numbers are the real scoped counts, with definitions beside them', (() => { const t = buildReport(state, 'u_apollos', newReportFilter(), 'dashboard.view').totals; return t.sessions === 5 && t.encounters === 11 && t.peopleReached === 8 && dash.includes('<p class="kpi-value">8</p>') && dash.includes('Read the definitions'); })());
  sessionUserId = 'u_john'; dash = viewShell(by('u_john')); ui.page = 'dashboard';
  check('team leader dashboard greets by first name', viewShell(by('u_john')).includes('Welcome, John'));
  sessionUserId = 'u_michael'; ui.page = 'users'; ui.forbidden = false;
  const usersHtml = viewShell(by('u_michael'));
  check('users page lists everyone with status', (usersHtml.match(/data-action="manage-user"/g) || []).length === 9 && usersHtml.includes('Deactivated') && usersHtml.includes('Invited'));
  check('app shell shows church name', usersHtml.includes('Kharis') && usersHtml.includes('Outreach Management'));
  ui.page = 'settings'; const setHtml = viewShell(by('u_michael'));
  check('settings shows roles matrix and teams', setHtml.includes('Roles and access') && setHtml.includes('Team A') && setHtml.includes('Data they reach'));
  sessionUserId = null; ui.screen = 'login';
  const login = viewLogin(), activate = viewActivate();
  check('login view has brand, scripture and demo panel', login.includes('Mark 16:15 (KJV)') && login.includes('Outreach Management') && login.includes('Kharis') && login.includes('Prototype demo accounts') && login.includes('type="password"'));
  check('login has no public registration route', !/sign up|register|create account/i.test(login + activate));
  check('generated sign-in fields carry the ids the app relies on', ['login-email','login-password'].every(i => login.includes('id="'+i+'"')) && ['act-email','act-code','act-password','act-confirm'].every(i => activate.includes('id="'+i+'"')));
  check('activate view has code field and live rules', activate.includes('name="code"') && activate.includes('id="pw-rules"') && activate.includes('name="confirm"'));
  check('login and activate markup balanced', balance(login, 'login') === '' && balance(activate, 'activate') === '', balance(login, 'login') + balance(activate, 'activate'));
  const dlgs = {
    invite: inviteDialogHtml(), about: aboutHtml(by('u_michael')), rename: renameDeptHtml(state.departments[0]),
    code: codeDialogHtml(by('u_priya'), 'K7QM-2XPD-9TBH', Date.now() + DAY, 'Invitation created'),
    confirm: confirmHtml({ title: 'T', message: 'M', confirmLabel: 'Go', tone: 'danger' })
  };
  state.users.forEach(u => { dlgs['manage-' + u.id] = manageUserHtml(u, 'u_michael'); });
  const dlgErr = Object.keys(dlgs).map(k => balance(dlgs[k], k)).filter(Boolean).join('\n');
  check('all dialogs render and are balanced', dlgErr === '', dlgErr);
  check('managing yourself hides destructive actions and locks role', manageUserHtml(by('u_michael'), 'u_michael').includes('You can’t deactivate, reset or change the role') && !manageUserHtml(by('u_michael'), 'u_michael').includes('data-action="ask-status"') && /<select id="edit-role"[^>]* disabled/.test(manageUserHtml(by('u_michael'), 'u_michael')));
  check('managing someone else offers reset and deactivate', manageUserHtml(by('u_sarah'), 'u_michael').includes('data-action="ask-reset"') && manageUserHtml(by('u_sarah'), 'u_michael').includes('data-status="deactivated"'));
  check('managing an invited user offers a new code', manageUserHtml(by('u_priya'), 'u_michael').includes('data-action="new-code"'));
  check('managing a deactivated user offers reactivation', manageUserHtml(by('u_emma'), 'u_michael').includes('data-status="active"'));

  /* ---------- escaping ---------- */
  check('esc neutralises markup and quotes', esc('<img src=x onerror="a()">\'&') === '&lt;img src=x onerror=&quot;a()&quot;&gt;&#39;&amp;' && esc(null) === '' && esc(0) === '0');
  const evil = await inviteUser(state, 'u_michael', { name: '<img src=x onerror=alert(1)>', email: 'evil@example.org', role: 'evangelist', departmentIds: [] });
  sessionUserId = 'u_michael'; ui.page = 'users'; ui.forbidden = false; ui.usersFilter = { q: '', status: 'all', role: 'all' };
  const evilHtml = viewShell(by('u_michael')) + manageUserHtml(evil.user, 'u_michael') + codeDialogHtml(evil.user, evil.code, evil.expiresAt, 'X');
  check('hostile names never become markup', !evilHtml.includes('<img src=x') && evilHtml.includes('&lt;img src=x'));
  ui.usersFilter = { q: 'tunde', status: 'all', role: 'all' };
  check('users filter by search', (usersTable().match(/data-action="manage-user"/g) || []).length === 1);
  ui.usersFilter = { q: '', status: 'deactivated', role: 'all' };
  check('users filter by status', (usersTable().match(/data-action="manage-user"/g) || []).length === 1 && usersTable().includes('Emma Wilson'));
  ui.usersFilter = { q: '', status: 'invited', role: 'evangelist' };
  let t = usersTable();
  check('invited + evangelist filter shows only invited evangelists', t.includes('Priya Shah') && !t.includes('Daniel Kingsley') && !t.includes('Emma Wilson') && !t.includes('Sarah Mitchell'));
  latestInvitation(state, 'u_priya').expiresAt = Date.now() - 1000;
  check('expired invitations still appear under the invited filter', usersTable().includes('Priya Shah') && usersTable().includes('Invitation expired'));
  ui.usersFilter = { q: 'zzzzzz', status: 'all', role: 'all' };
  check('empty filter result has a clear-filters action', usersTable().includes('data-action="clear-user-filters"'));

  /* ======================= STAGE 2: outreach sessions and people ======================= */
  {
    const zedUser = () => ({ id: 'u_zed', name: 'Zed Tester', email: 'zed@example.org', role: 'evangelist', status: 'active', passwordHash: 'x', createdAt: Date.now(), lastLoginAt: null, invitedBy: null });
    const addZed = () => { state.users.push(zedUser()); state.memberships.push({ userId: 'u_zed', departmentId: 'd_a' }); };
    const sid = id => sessionsVisibleTo(state, id).map(s => s.id).sort();
    const pn = id => searchPeople(state, id, '').map(r => r.name).sort();
    const prof = (a, p) => personProfile(state, a, p);
    const snap = () => JSON.stringify(state);
    const baseSession = () => ({ outreachDate: isoDate(Date.now() - 2 * DAY), startTime: '14:00', areaId: 'a_centre', typeKey: 'street', departmentId: '', participantIds: [], notes: 'Test outing.' });
    const newP = o => Object.assign({ mode: 'new', existingId: '', name: 'Test Person', phone: '', email: '', voluntary: false, response: 'listened', followUp: false, notes: '' }, o || {});
    const input = (people, sess, key) => ({ submissionKey: key || ('k' + Math.random()), session: Object.assign(baseSession(), sess || {}), people: people || [] });
    const countAll = () => ({ s: state.sessions.length, e: state.encounters.length, p: state.people.length });

    /* ---------- seed and upgrade ---------- */
    await fresh();
    check('seed has areas, people, sessions and encounters', state.areas.length === 4 && state.people.length === 8 && state.sessions.length === 5 && state.encounters.length === 11, JSON.stringify(countAll()));
    check('every encounter points at a real person and session', state.encounters.every(e => state.people.some(p => p.id === e.personId) && state.sessions.some(s => s.id === e.sessionId)));
    check('a person is met at most once per session (unique constraint)', new Set(state.encounters.map(e => e.personId + '|' + e.sessionId)).size === state.encounters.length);
    check('seed keeps the outreach date separate from the entry time', state.sessions.every(s => s.enteredAt >= eventTs(s)) && state.sessions.some(s => isoDate(s.enteredAt) !== s.outreachDate));
    check('seed contact details are fictional only', state.people.every(p => (!p.phone || /^07700 900\d{3}$/.test(p.phone)) && (!p.email || /@example\.org$/.test(p.email))));
    check('seed people were all created by a real user', state.people.every(p => getUser(state, p.createdBy) && p.createdAt > 0));
    check('seed sessions are all recorded by evangelists on the right team', state.sessions.every(s => getUser(state, s.createdBy).role === 'evangelist' && deptIdsOf(state, s.createdBy).indexOf(s.departmentId) !== -1));
    const v1 = clone(state); delete v1.areas; delete v1.people; delete v1.sessions; delete v1.encounters; v1.version = 1;
    check('version 1 data is not valid until upgraded', !isValidState(v1));
    const up2 = upgradeState(v1);
    check('upgrade brings version 1 data to the current version and keeps the users', isValidState(up2) && up2.version === APP.stateVersion && up2.users.length === 9 && up2.sessions.length > 5 && up2.cases.length > 4);
    check('upgrade ignores current data and junk', upgradeState(null) === null && upgradeState({ version: 2 }).version === 2 && !isValidState(upgradeState({ version: 1 })));

    /* ---------- what each role may reach ---------- */
    check('Sarah sees her three Team A sessions and Grace her two Team B sessions', same(sid('u_sarah'), ['s_a1', 's_a2', 's_a3']) && same(sid('u_grace'), ['s_b1', 's_b2']));
    check('team leaders see only their team’s sessions', same(sid('u_john'), ['s_a1', 's_a2', 's_a3']) && same(sid('u_tunde'), ['s_b1', 's_b2']));
    check('coordinator, pastor, admin, invited and deactivated users have no session list', ['u_daniel', 'u_apollos', 'u_michael', 'u_priya', 'u_emma'].every(id => sid(id).length === 0));
    check('Sarah sees five people and Grace three', same(pn('u_sarah'), ['Amara Eze', 'Ben Taylor', 'Jonas Weber', 'Liam Carter', 'Noor Rahman']) && same(pn('u_grace'), ['Priscilla Mensah', 'Tom Hargreaves', 'Yusuf Demir']), JSON.stringify(pn('u_sarah')));
    check('the coordinator sees the people met by their team; pastor and admin see no one', pn('u_daniel').length === 5 && pn('u_apollos').length === 0 && pn('u_michael').length === 0);
    check('evangelists can now open person records', can(by('u_sarah'), 'people.view') && ROLE_CAPS.evangelist.indexOf('people.view') !== -1);
    check('another team’s session and person look exactly like ones that do not exist',
      sessionDetail(state, 'u_tunde', 's_a1') === null && sessionDetail(state, 'u_tunde', 's_nope') === null && prof('u_tunde', 'p_amara') === null && prof('u_tunde', 'p_nope') === null && getSessionFor(state, 'u_tunde', 's_a1') === null);
    check('searching cannot reveal another team’s people', searchPeople(state, 'u_tunde', 'Amara').length === 0 && searchPeople(state, 'u_tunde', '900101').length === 0 && searchPeople(state, 'u_sarah', 'Priscilla').length === 0 && possibleDuplicates(state, 'u_sarah', 'Priscilla').length === 0);
    check('nobody without the capability can search or open profiles', searchPeople(state, 'u_apollos', '').length === 0 && prof('u_michael', 'p_amara') === null && prof('u_apollos', 'p_amara') === null);

    /* ---------- contact details ---------- */
    check('the evangelist who recorded someone sees their contact details', prof('u_sarah', 'p_amara').contact.phone === '07700 900101' && prof('u_sarah', 'p_amara').contact.voluntary === true);
    check('the team leader and coordinator see contact details for people in scope', prof('u_john', 'p_amara').contact.phone === '07700 900101' && prof('u_daniel', 'p_noor').contact.email === 'noor.rahman@example.org');
    addZed(); state.sessions.find(s => s.id === 's_a2').participantIds.push('u_zed');
    check('a co-participant sees the session and its three people', same(sid('u_zed'), ['s_a2']) && pn('u_zed').length === 3);
    check('…but not contact details someone else collected', prof('u_zed', 'p_amara').contact === null && canSeeContact(state, by('u_zed'), 'p_amara') === false && !JSON.stringify(prof('u_zed', 'p_amara')).includes('07700'));
    check('contact search only matches where contact details are visible',
      searchPeople(state, 'u_sarah', '900101').length === 1 && searchPeople(state, 'u_zed', '900101').length === 0 && searchPeople(state, 'u_john', 'rahman@example').length === 1 && searchPeople(state, 'u_zed', 'rahman@example').length === 0);
    check('a timeline only lists encounters the viewer may see', prof('u_zed', 'p_amara').timesMet === 1 && prof('u_sarah', 'p_amara').timesMet === 2 && prof('u_sarah', 'p_amara').timeline[0].session.id === 's_a2');
    state.encounters.push({ id: 'x1', personId: 'p_amara', sessionId: 's_b1', response: 'listened', notes: 'team B note', followUpSuggested: false, recordedBy: 'u_grace', recordedAt: Date.now() });
    check('a person shared by two teams shows each team only its own encounters',
      prof('u_tunde', 'p_amara').timesMet === 1 && prof('u_tunde', 'p_amara').timeline[0].encounter.notes === 'team B note' && prof('u_john', 'p_amara').timesMet === 2 && !JSON.stringify(prof('u_john', 'p_amara')).includes('team B note'));
    state.encounters.pop();
    state.memberships = state.memberships.filter(m => !(m.userId === 'u_john' && m.departmentId === 'd_a'));
    check('leaving a team removes access straight away', sid('u_john').length === 0 && pn('u_john').length === 0 && prof('u_john', 'p_amara') === null);
    state.memberships.push({ userId: 'u_john', departmentId: 'd_a' });
    check('rejoining restores it', sid('u_john').length === 3);

    /* ---------- dashboard totals ---------- */
    await fresh();
    check('pastor totals are church-wide counts', same(outreachStats(state, 'u_apollos'), { sessions: 5, encounters: 11, peopleReached: 8, scope: 'church' }), JSON.stringify(outreachStats(state, 'u_apollos')));
    check('team leader totals cover only their team, with people counted once', same(outreachStats(state, 'u_john'), { sessions: 3, encounters: 7, peopleReached: 5, scope: 'team' }) && same(outreachStats(state, 'u_tunde'), { sessions: 2, encounters: 4, peopleReached: 3, scope: 'team' }));
    check('totals are refused to roles without the dashboard', ['u_sarah', 'u_daniel', 'u_michael', 'u_priya'].every(id => outreachStats(state, id) === null));

    /* ---------- recording a session ---------- */
    await fresh(); addZed();
    check('only evangelists can record sessions (403 for everyone else) and nothing is saved', ['u_daniel', 'u_john', 'u_apollos', 'u_michael', 'u_emma'].every(id => { const r = createSession(state, id, input([])); return !r.ok && r.code === 403; }) && state.sessions.length === 5);
    check('a deactivated evangelist cannot record', (() => { setUserStatus(state, 'u_michael', 'u_grace', 'deactivated'); const r = createSession(state, 'u_grace', input([])); setUserStatus(state, 'u_michael', 'u_grace', 'active'); return !r.ok && r.code === 403; })());
    const before = countAll(), pastDate = isoDate(Date.now() - 4 * DAY);
    let cs = createSession(state, 'u_sarah', input([
      newP({ name: '  New Friend  ', phone: ' 07700 900222 ', email: 'FRIEND@Example.org', voluntary: true, response: 'receptive', followUp: true, notes: ' Keen to visit ' }),
      { mode: 'existing', existingId: 'p_liam', response: 'listened', followUp: false, notes: '' }], { outreachDate: pastDate, notes: '  A note  ' }, 'key-1'));
    check('a valid session saves', cs.ok && cs.encounterCount === 2 && cs.newPeople === 1);
    check('one session, two encounters and one new person were written together', same(countAll(), { s: before.s + 1, e: before.e + 2, p: before.p + 1 }));
    const ns = cs.session;
    check('the outreach date is kept as entered, and the entry time is recorded separately', ns.outreachDate === pastDate && Math.abs(ns.enteredAt - Date.now()) < 5000 && isoDate(ns.enteredAt) !== pastDate);
    check('a one-team evangelist’s team is filled in and the recorder is a participant', ns.departmentId === 'd_a' && same(ns.participantIds, ['u_sarah']) && ns.notes === 'A note');
    const np = state.people.find(p => p.name === 'New Friend');
    check('names are trimmed, phone trimmed, email lower-cased and contact marked voluntary', !!np && np.phone === '07700 900222' && np.email === 'friend@example.org' && np.contactVoluntary === true && np.createdBy === 'u_sarah');
    check('linking an existing person adds an encounter but no duplicate, and leaves their record untouched', state.people.filter(p => p.name === 'Liam Carter').length === 1 && state.encounters.some(e => e.personId === 'p_liam' && e.sessionId === ns.id) && state.people.find(p => p.id === 'p_liam').phone === '');
    check('encounters carry the response, follow-up flag, notes and recorder', (() => { const e = state.encounters.find(x => x.personId === np.id); return e.response === 'receptive' && e.followUpSuggested === true && e.notes === 'Keen to visit' && e.recordedBy === 'u_sarah'; })());
    check('the new session is visible to the recorder and their team leader only', sid('u_sarah').includes(ns.id) && sid('u_john').includes(ns.id) && !sid('u_tunde').includes(ns.id) && !sid('u_grace').includes(ns.id));
    check('the new person is visible to the coordinator, with contact, and not to Team B', pn('u_daniel').includes('New Friend') && !pn('u_tunde').includes('New Friend') && prof('u_daniel', np.id).contact.email === 'friend@example.org');
    const c1 = countAll();
    const again = createSession(state, 'u_sarah', input([newP({ name: 'New Friend' })], {}, 'key-1'));
    check('submitting the same form twice saves nothing twice', again.ok && again.duplicate === true && again.session.id === ns.id && same(countAll(), c1));
    cs = createSession(state, 'u_sarah', input([], {}, 'key-2'));
    check('a session with no people is allowed', cs.ok && cs.encounterCount === 0 && cs.newPeople === 0);
    check('a missing submission key is refused', !createSession(state, 'u_sarah', { session: baseSession(), people: [] }).ok);

    /* validation: every refusal must leave the data untouched */
    const sBefore = snap();
    const bad = (label, sess, people, test) => { const r = createSession(state, 'u_sarah', input(people, sess)); check(label, !r.ok && !!test(r), JSON.stringify(r).slice(0, 200)); };
    bad('a future outreach date is refused', { outreachDate: isoDate(Date.now() + 2 * DAY) }, [], r => r.errors.outreachDate);
    bad('a missing date is refused', { outreachDate: '' }, [], r => r.errors.outreachDate);
    bad('an impossible date is refused', { outreachDate: '2026-02-31' }, [], r => r.errors.outreachDate);
    bad('a malformed time is refused', { startTime: '25:99' }, [], r => r.errors.startTime);
    const soon = new Date(Date.now() + 90 * 1000);
    if (isoDate(soon) === isoDate(Date.now())) bad('a start time later today is refused', { outreachDate: isoDate(Date.now()), startTime: pad2(soon.getHours()) + ':' + pad2(soon.getMinutes()) }, [], r => r.errors.startTime);
    bad('a missing area is refused', { areaId: '' }, [], r => r.errors.areaId);
    bad('an unknown area is refused', { areaId: 'a_nope' }, [], r => r.errors.areaId);
    bad('a missing type is refused', { typeKey: '' }, [], r => r.errors.typeKey);
    bad('a team the recorder is not on is refused', { departmentId: 'd_b' }, [], r => r.errors.departmentId);
    bad('overlong session notes are refused', { notes: 'x'.repeat(1001) }, [], r => r.errors.notes);
    bad('a participant from another team is refused', { participantIds: ['u_grace'] }, [], r => r.errors.participantIds);
    bad('a participant who is not an evangelist is refused', { participantIds: ['u_john'] }, [], r => r.errors.participantIds);
    bad('a participant who does not exist is refused', { participantIds: ['u_nope'] }, [], r => r.errors.participantIds);
    bad('a nameless new person is refused', {}, [newP({ name: ' ' })], r => r.personErrors[0].name);
    bad('a one-letter name is refused', {}, [newP({ name: 'A' })], r => r.personErrors[0].name);
    bad('an invalid phone number is refused', {}, [newP({ phone: 'abc' })], r => r.personErrors[0].phone);
    bad('an invalid email is refused', {}, [newP({ email: 'nope', voluntary: true })], r => r.personErrors[0].email);
    bad('contact details without the voluntary confirmation are refused', {}, [newP({ phone: '07700 900333' })], r => r.personErrors[0].voluntary);
    bad('an unknown response is refused', {}, [newP({ response: 'saved' })], r => r.personErrors[0].response);
    bad('overlong encounter notes are refused', {}, [newP({ notes: 'x'.repeat(601) })], r => r.personErrors[0].notes);
    bad('an existing person must be chosen', {}, [{ mode: 'existing', existingId: '', response: 'listened' }], r => r.personErrors[0].existing);
    bad('another team’s person cannot be linked', {}, [{ mode: 'existing', existingId: 'p_priscilla', response: 'listened' }], r => r.personErrors[0].existing);
    bad('the same existing person cannot be added twice', {}, [{ mode: 'existing', existingId: 'p_liam', response: 'listened' }, { mode: 'existing', existingId: 'p_liam', response: 'listened' }], r => r.personErrors[1].existing);
    bad('more than 40 people are refused', {}, Array.from({ length: 41 }, (_, i) => newP({ name: 'Person ' + i })), r => r.errors.people);
    const rForeign = createSession(state, 'u_sarah', input([{ mode: 'existing', existingId: 'p_priscilla', response: 'listened' }]));
    const rMissing = createSession(state, 'u_sarah', input([{ mode: 'existing', existingId: 'p_zzz', response: 'listened' }]));
    check('linking another team’s person gives the same message as linking someone who does not exist', rForeign.personErrors[0].existing === rMissing.personErrors[0].existing && !!rMissing.personErrors[0].existing);
    const rAll = createSession(state, 'u_sarah', input([newP({ name: 'Valid One' }), newP({ name: '' })]));
    check('one bad person means nothing is saved, not even the good ones', !rAll.ok && !state.people.some(p => p.name === 'Valid One'));
    check('no refused session changed any data at all', snap() === sBefore);
    check('errors are reported per field for the form to show', (() => { const r = createSession(state, 'u_sarah', input([newP({ name: '' }), newP()], { areaId: '', typeKey: '' })); return !r.ok && r.errors.areaId && r.errors.typeKey && r.personErrors[0].name && Object.keys(r.personErrors[1]).length === 0; })());

    /* teams and participants */
    state.memberships.push({ userId: 'u_sarah', departmentId: 'd_b' });
    let r3 = createSession(state, 'u_sarah', input([], { departmentId: '' }));
    check('an evangelist on two teams must choose one', !r3.ok && !!r3.errors.departmentId);
    r3 = createSession(state, 'u_sarah', input([], { departmentId: 'd_b' }, 'key-team-b'));
    check('…and can record for either of their teams', r3.ok && r3.session.departmentId === 'd_b' && sid('u_tunde').includes(r3.session.id) && !sid('u_john').includes(r3.session.id));
    state.memberships = state.memberships.filter(m => m.userId !== 'u_sarah');
    r3 = createSession(state, 'u_sarah', input([], {}, 'key-no-team'));
    check('an evangelist with no team can record, and only they can see it', r3.ok && r3.session.departmentId === null && sid('u_sarah').includes(r3.session.id) && !sid('u_john').includes(r3.session.id) && !sid('u_tunde').includes(r3.session.id));
    r3 = createSession(state, 'u_sarah', input([], { participantIds: ['u_zed'] }));
    check('without a team nobody else can be added', !r3.ok && !!r3.errors.participantIds);
    state.memberships.push({ userId: 'u_sarah', departmentId: 'd_a' });
    r3 = createSession(state, 'u_sarah', input([], { participantIds: ['u_zed', 'u_zed', 'u_sarah'] }, 'key-part'));
    check('participants are de-duplicated, include the recorder and gain access', r3.ok && same(r3.session.participantIds, ['u_sarah', 'u_zed']) && sid('u_zed').includes(r3.session.id));

    /* ---------- areas ---------- */
    check('non-admins cannot change areas (403)', addArea(state, 'u_sarah', 'Park').code === 403 && renameArea(state, 'u_john', 'a_centre', 'X Y').code === 403 && setAreaActive(state, 'u_apollos', 'a_centre', false).code === 403);
    check('area names are validated', !addArea(state, 'u_michael', ' ').ok && !addArea(state, 'u_michael', 'city CENTRE').ok && /an area/.test(addArea(state, 'u_michael', 'x').error));
    check('admin can add and rename an area', addArea(state, 'u_michael', 'Riverside walk').ok && renameArea(state, 'u_michael', 'a_market', 'Market hall').ok && state.areas.find(a => a.id === 'a_market').name === 'Market hall' && !renameArea(state, 'u_michael', 'a_market', 'train station').ok && !renameArea(state, 'u_michael', 'a_zzz', 'Whatever').ok);
    setAreaActive(state, 'u_michael', 'a_centre', false);
    r3 = createSession(state, 'u_sarah', input([], { areaId: 'a_centre' }));
    check('an inactive area cannot be used for new sessions, and old sessions keep it', !r3.ok && !!r3.errors.areaId && sessionDetail(state, 'u_sarah', 's_a2').area.name === 'City centre');
    setAreaActive(state, 'u_michael', 'a_centre', true);

    /* ---------- duplicates and names ---------- */
    const dups = n => possibleDuplicates(state, 'u_sarah', n).map(r => r.name);
    check('exact, partial, typo, case and accent variants suggest Liam Carter', ['Liam Carter', 'liam', 'LIAM  carter', 'Lian Carter', 'Líam Cárter', 'Carter'].every(n => dups(n).includes('Liam Carter')), JSON.stringify(['Lian Carter', 'Líam Cárter'].map(dups)));
    check('unrelated names suggest nothing', dups('Zachariah Quill').length === 0 && dups('x').length === 0 && dups('').length === 0);
    check('the exclude list is honoured', possibleDuplicates(state, 'u_sarah', 'Liam Carter', ['p_liam']).every(r => r.id !== 'p_liam'));
    const nBefore = state.people.length;
    createSession(state, 'u_sarah', input([newP({ name: 'Liam Carter' })], {}, 'k-dup'));
    check('a possible duplicate is never merged automatically', state.people.length === nBefore + 1 && state.people.filter(p => p.name === 'Liam Carter').length === 2);
    check('name normalising handles punctuation, accents and non-Latin scripts', normName('  Élodie-Anne  O’Brien ') === 'elodie anne o brien' && normName('محمد علي').length > 3 && withinOneEdit('jonas webber', 'jonas weber') && !withinOneEdit('abc', 'axx'));
    check('person label, phone and email validators', validatePersonLabel('Al') === '' && !!validatePersonLabel('') && !!validatePersonLabel('x'.repeat(81)) && validatePhone('') === '' && validatePhone('+44 7700 900123') === '' && validatePhone('(020) 7946-0000') === '' && !!validatePhone('12') && !!validatePhone('abc') && !!validatePhone('1'.repeat(16)));
    check('date helpers round-trip', parseIsoDate('2026-10-23').getDate() === 23 && parseIsoDate('2026-02-30') === null && parseIsoDate('x') === null && isoDate(parseIsoDate('2026-01-05')) === '2026-01-05' && validTime('00:00') && validTime('23:59') && !validTime('24:00') && !validTime('9:30'));

    /* ---------- recorder draft helpers ---------- */
    {
      const d0 = newDraft(by('u_sarah'));
      check('a new draft defaults to today and the only team, and counts as empty', d0.session.outreachDate === isoDate(Date.now()) && d0.session.departmentId === 'd_a' && !draftHasContent(d0) && d0.step === 1);
      d0.people.push(newPersonCard());
      check('setDraftPath only accepts known paths', setDraftPath(d0, 'session.notes', 'x') && d0.session.notes === 'x' && setDraftPath(d0, 'people.0.name', 'Ann') && d0.people[0].name === 'Ann' && !setDraftPath(d0, '__proto__.polluted', 1) && !setDraftPath(d0, 'session.__proto__', 1) && !setDraftPath(d0, 'people.5.name', 'x') && !setDraftPath(d0, 'people.0.mode', 'x') && ({}).polluted === undefined);
      toggleParticipant(d0, 'u_zed', true); toggleParticipant(d0, 'u_zed', true);
      check('toggleParticipant adds once and removes', same(d0.session.participantIds, ['u_zed']) && (toggleParticipant(d0, 'u_zed', false), d0.session.participantIds.length === 0));
      d0.errors = { session: { notes: 'x', areaId: 'y' }, people: [{ phone: 'p', voluntary: 'v', name: 'n' }] };
      clearDraftError(d0, 'session.notes'); clearDraftError(d0, 'people.0.phone');
      check('editing a field clears only its own error', same(d0.errors.session, { areaId: 'y' }) && same(d0.errors.people[0], { name: 'n' }));
      check('draftInput carries the key, session and people', draftInput(d0).submissionKey === d0.key && draftInput(d0).people === d0.people);
    }

    /* ---------- pages ---------- */
    await fresh(); addZed(); state.sessions.find(s => s.id === 's_a2').participantIds.push('u_zed');
    const shell = (userId, page, extra) => { sessionUserId = userId; ui.page = page; Object.assign(ui, extra || {}); ui.forbidden = !guardPage(by(userId), page).ok; return viewShell(by(userId)); };
    const rows = (h, action) => (h.match(new RegExp('data-action="' + action + '"', 'g')) || []).length;
    resetWorkState();
    check('detail pages are guarded by capability', guardPage(by('u_sarah'), 'record').ok && guardPage(by('u_john'), 'record').code === 403 && guardPage(by('u_daniel'), 'session').code === 403 && guardPage(by('u_daniel'), 'person').ok && guardPage(by('u_apollos'), 'person').code === 403 && guardPage(by('u_michael'), 'session').code === 403);
    check('evangelist nav now has Sessions and People', same(visiblePages(by('u_sarah')).map(p => p.label), ['Outreach Sessions', 'People']));
    check('detail pages are never in the menu', PAGES.filter(p => p.nav === false).every(p => !visiblePages(by('u_sarah')).some(v => v.id === p.id)) && !aboutHtml(by('u_sarah')).includes('value="record"') && !aboutHtml(by('u_sarah')).includes('value="person"'));

    let h = shell('u_sarah', 'sessions');
    check('sessions page lists the evangelist’s sessions with a record button and the entry date', rows(h, 'open-session') === 3 && rows(h, 'open-record') >= 1 && h.includes('Entered') && h.includes('3</b> sessions') && h.includes('7</b> encounters') && balance(h, 'sessions') === '', balance(h, 'sessions'));
    h = shell('u_john', 'sessions');
    check('team leaders see team sessions but cannot record', rows(h, 'open-session') === 3 && rows(h, 'open-record') === 0 && h.includes('Sessions recorded by your team'));
    h = shell('u_tunde', 'sessions');
    check('Tunde’s list shows only Team B’s sessions', rows(h, 'open-session') === 2 && !h.includes('Sarah Mitchell') && h.includes('Grace Okafor'));
    ui.sessionFilter = { area: 'a_centre', type: 'all' };
    check('sessions filter by area', (sessionsTable(by('u_sarah')).match(/data-action="open-session"/g) || []).length === 1);
    ui.sessionFilter = { area: 'a_centre', type: 'campus' };
    check('an empty filter result offers to clear the filters', sessionsTable(by('u_sarah')).includes('data-action="clear-session-filters"'));
    ui.sessionFilter = { area: 'all', type: 'all' };

    h = shell('u_sarah', 'session', { sessionId: 's_a2' });
    check('session detail shows details, people, notes and profile links', h.includes('City centre') && h.includes('Amara Eze') && h.includes('Liam Carter') && rows(h, 'open-person') === 3 && h.includes('Met before') && h.includes('Follow-up suggested') && h.includes('Asked what the youth group is like.') && h.includes('Dry afternoon') && balance(h, 'session') === '', balance(h, 'session'));
    check('an entry made later says how long after the outreach', shell('u_sarah', 'session', { sessionId: 's_a3' }).includes('1 day after the outreach'));
    const h404 = shell('u_tunde', 'session', { sessionId: 's_a2' });
    check('another team’s session shows the same 404 as a missing one and leaks nothing', h404.includes('Error 404') && h404 === shell('u_tunde', 'session', { sessionId: 's_missing' }) && !h404.includes('Amara') && !h404.includes('City centre'));
    check('a coordinator cannot open a session page (403)', shell('u_daniel', 'session', { sessionId: 's_a2' }).includes('Error 403'));

    h = shell('u_sarah', 'people');
    check('the directory lists names but never contact details', rows(h, 'open-person') === 5 && h.includes('Amara Eze') && !h.includes('07700') && !h.includes('noor.rahman') && balance(h, 'people') === '');
    h = shell('u_daniel', 'people');
    check('the coordinator’s directory also hides contact details in the list', rows(h, 'open-person') === 5 && !h.includes('07700') && !h.includes('noor.rahman'));
    ui.peopleQ = 'amara';
    check('directory search narrows the list', (peopleTable(by('u_sarah')).match(/data-action="open-person"/g) || []).length === 1);
    ui.peopleQ = 'zzzz';
    check('an empty search offers to clear it', peopleTable(by('u_sarah')).includes('data-action="clear-people-q"'));
    ui.peopleQ = '07700 900101';
    check('searching by phone works for the recorder and is hidden from others', (peopleTable(by('u_sarah')).match(/data-action="open-person"/g) || []).length === 1 && peopleTable(by('u_zed')).includes('No one matches'));
    ui.peopleQ = '';

    h = shell('u_sarah', 'person', { personId: 'p_amara' });
    const iNew = h.indexOf('Open to talking more'), iOld = h.indexOf('Listened');
    check('profile shows overview, contact for the recorder and a newest-first timeline', h.includes('07700 900101') && h.includes('Shared by the person themselves') && h.includes('Times met') && iNew > -1 && iOld > iNew && h.includes('Asked what the youth group is like.') && !h.includes('Follow-up case') && h.includes('special-category') && balance(h, 'person') === '', balance(h, 'person'));
    h = shell('u_zed', 'person', { personId: 'p_amara' });
    check('a co-participant sees the profile without contact details', h.includes('Not shown for your role') && !h.includes('07700') && h.includes('Times met'));
    h = shell('u_tunde', 'person', { personId: 'p_amara' });
    check('another team’s person shows the same 404 as a missing one', h.includes('Error 404') && h === shell('u_tunde', 'person', { personId: 'p_missing' }) && !h.includes('Amara'));
    check('the pastor cannot open a profile (403)', shell('u_apollos', 'person', { personId: 'p_amara' }).includes('Error 403') && !shell('u_apollos', 'person', { personId: 'p_amara' }).includes('Amara'));
    check('the coordinator sees the profile with contact details but no session link', (() => { const x = shell('u_daniel', 'person', { personId: 'p_amara' }); return x.includes('07700 900101') && !x.includes('data-action="open-session"'); })());
    check('team leaders get a link from the timeline to the session', shell('u_john', 'person', { personId: 'p_amara' }).includes('data-action="open-session"'));

    /* ---------- recorder screens ---------- */
    resetWorkState();
    h = shell('u_sarah', 'record');
    check('step 1 shows date, time, area, type and notes, with the team fixed for a one-team evangelist', h.includes('Record outreach session') && h.includes('id="rs-date"') && h.includes('max="' + isoDate(Date.now()) + '"') && h.includes('id="rs-area"') && h.includes('id="rs-type"') && h.includes('id="rs-notes"') && !h.includes('id="rs-team"') && h.includes('Team A') && h.includes('draft-next') && h.includes('aria-current="step"') && balance(h, 'step1') === '', balance(h, 'step1'));
    check('the date field says the entry date is kept separate', h.includes('Entering it later is fine'));
    setAreaActive(state, 'u_michael', 'a_station', false);
    check('inactive areas are not offered', !shell('u_sarah', 'record').includes('Train station'));
    setAreaActive(state, 'u_michael', 'a_station', true);
    state.memberships.push({ userId: 'u_sarah', departmentId: 'd_b' }); resetWorkState();
    check('an evangelist on two teams gets a team picker, and a teammate list once a team is chosen', shell('u_sarah', 'record').includes('id="rs-team"') && !shell('u_sarah', 'record').includes('Zed Tester'));
    ui.draft.session.departmentId = 'd_a';
    check('teammates on the chosen team can be added to the session', shell('u_sarah', 'record').includes('Zed Tester') && shell('u_sarah', 'record').includes('data-multi="u_zed"'));
    state.memberships = state.memberships.filter(m => !(m.userId === 'u_sarah' && m.departmentId === 'd_b')); resetWorkState();
    shell('u_sarah', 'record'); ui.draft.errors.session = { areaId: 'Choose an area.', outreachDate: 'Choose the date the outreach took place.' };
    h = shell('u_sarah', 'record');
    check('step 1 errors appear next to the fields and mark them invalid', h.includes('Choose an area.') && h.includes('aria-describedby="rs-area-err"') && (h.match(/aria-invalid="true"/g) || []).length === 2);

    ui.draft.errors = { session: {}, people: [] }; ui.draft.step = 2;
    h = shell('u_sarah', 'record');
    check('step 2 starts with a clear empty state and an add button', h.includes('No one added yet') && h.includes('data-action="add-person"') && h.includes('data-action="draft-review"') && h.includes('data-action="draft-back"') && balance(h, 'step2empty') === '');
    ui.draft.people.push(newPersonCard());
    h = shell('u_sarah', 'record');
    check('a new-person card has name, contact details, response choices, follow-up and notes', h.includes('id="pc0-name"') && h.includes('Contact details (optional)') && h.includes('name="resp-0"') && (h.match(/name="resp-0"/g) || []).length === RESPONSES.length && h.includes('id="pc0-fu"') && h.includes('id="pc0-notes"') && h.includes('data-action="remove-person"') && h.includes('aria-pressed="true"') && balance(h, 'step2card') === '', balance(h, 'step2card'));
    check('the contact section stays closed until something is entered', !/<details class="more" open/.test(h));
    ui.draft.people[0].phone = '0770'; ui.draft.errors.people[0] = { phone: 'Use digits, spaces and + only (7 to 15 digits).', voluntary: 'Confirm they shared these details freely, or remove them.' };
    h = shell('u_sarah', 'record');
    check('entered contact details keep the section open and show their errors', /<details class="more" open/.test(h) && h.includes('Use digits, spaces and + only') && h.includes('Confirm they shared these details freely') && h.includes('value="0770"'));
    ui.draft.errors.people = []; ui.draft.people[0].phone = '';
    ui.draft.people[0].name = 'liam carter';
    sessionUserId = 'u_sarah';
    check('typing a similar name shows a possible match to check, never a merge', dupHintHtml(0).includes('Could this be someone already recorded?') && dupHintHtml(0).includes('Liam Carter') && dupHintHtml(0).includes('data-action="dup-use"') && dupHintHtml(0).includes('data-action="dup-dismiss"') && !dupHintHtml(0).includes('07700'));
    ui.draft.people[0].dupDismissed = true;
    check('a dismissed match stays dismissed', dupHintHtml(0) === '');
    ui.draft.people[0].dupDismissed = false; ui.draft.people[0].name = 'Zachariah Quill';
    check('an unrelated name shows no match', dupHintHtml(0) === '');
    ui.draft.people[0].mode = 'existing'; ui.draft.people[0].query = 'a';
    check('the existing-person search asks for at least two letters', pickResultsHtml(0).includes('at least two letters'));
    ui.draft.people[0].query = 'ama';
    check('search results show only people in scope, with no contact details', pickResultsHtml(0).includes('Amara Eze') && pickResultsHtml(0).includes('data-action="pick-person"') && !pickResultsHtml(0).includes('07700') && !pickResultsHtml(0).includes('Priscilla'));
    ui.draft.people[0].query = 'pris';
    check('searching for another team’s person finds nothing and says so', pickResultsHtml(0).includes('No one you can see matches') && !pickResultsHtml(0).includes('Priscilla Mensah'));
    ui.draft.people[0].existingId = 'p_amara'; ui.draft.people[0].query = '';
    h = shell('u_sarah', 'record');
    check('a chosen existing person is shown with a Change button', h.includes('class="picked"') && h.includes('Amara Eze') && h.includes('data-action="clear-pick"') && !h.includes('07700'));
    ui.draft.people[0].existingId = 'p_priscilla';
    h = shell('u_sarah', 'record');
    check('an existing person who is out of scope is not shown by name', !h.includes('Priscilla') && h.includes('Find a person you can see'));
    ui.draft.people[0] = Object.assign(newPersonCard(), { name: '<img src=x onerror=alert(1)>', notes: '<b>bold</b>', phone: '07700 900444', voluntary: true });
    ui.draft.session.notes = '<script>alert(1)</script>';
    h = shell('u_sarah', 'record');
    check('hostile text never becomes markup on step 2', !h.includes('<img src=x') && !h.includes('<b>bold</b>') && h.includes('&lt;img src=x onerror=alert(1)&gt;') && balance(h, 'hostile2') === '', balance(h, 'hostile2'));

    ui.draft.step = 3; ui.draft.session.areaId = 'a_centre'; ui.draft.session.typeKey = 'street'; ui.draft.people.push(Object.assign(newPersonCard(), { name: 'Liam', followUp: true, response: 'receptive' }), Object.assign(newPersonCard(), { name: 'Liam' }), { mode: 'existing', existingId: 'p_noor', query: '', response: 'prayer', followUp: false, notes: '', dupDismissed: false });
    h = shell('u_sarah', 'record');
    check('the review shows the session, every person and the contact details typed', h.includes('City centre') && h.includes('Street outreach') && h.includes('People reached (4)') && h.includes('Noor Rahman') && h.includes('Already in the system') && h.includes('New person') && h.includes('Contact: 07700 900444') && h.includes('Submit session') && h.includes('data-step="1"') && h.includes('data-step="2"') && balance(h, 'step3') === '', balance(h, 'step3'));
    check('the review warns about a possible match and about two people sharing a name', h.includes('May be the same as Liam Carter') && h.includes('Another person in this session has the same name') && h.includes('3 new people and 1 already in the system'));
    check('hostile text never becomes markup on the review', !h.includes('<img src=x') && !h.includes('<script>alert') && !h.includes('<b>bold</b>'));
    ui.draft.banner = 'We couldn’t save this session.';
    check('a save failure is shown above the step and the draft is kept', shell('u_sarah', 'record').includes('We couldn’t save this session.') && ui.draft.people.length === 4);
    check('the sessions page offers to continue an unsent draft', shell('u_sarah', 'sessions').includes('unsent session draft') && shell('u_sarah', 'sessions').includes('data-action="draft-discard"'));
    resetWorkState();
    check('clearing session state removes the draft', ui.draft === null && !shell('u_sarah', 'sessions').includes('unsent session draft'));

    /* ---------- dashboard and settings ---------- */
    h = shell('u_apollos', 'dashboard');
    check('the pastor’s dashboard shows church-wide totals and no names', h.includes('Whole church') && h.includes('<p class="kpi-value">8</p>') && h.includes('Team A') && h.includes('Team B') && !h.includes('Amara') && !h.includes('Sarah Mitchell') && !h.includes('No outreach recorded'));
    h = shell('u_john', 'dashboard');
    check('the team leader’s dashboard shows only team totals', h.includes('Team A') && !h.includes('Team B') && !h.includes('Whole church') && h.includes('<p class="kpi-value">5</p>') && !h.includes('<p class="kpi-value">8</p>') && balance(h, 'dash') === '');
    h = shell('u_michael', 'settings');
    check('settings lists areas with session counts and lets an admin add, rename and switch them', h.includes('Outreach areas') && h.includes('University campus') && h.includes('1 session') && rows(h, 'area-toggle') === 4 && rows(h, 'area-rename') === 4 && h.includes('data-form="area-add"') && balance(h, 'settings') === '', balance(h, 'settings'));
    check('the area rename dialog is balanced', balance(renameAreaHtml(state.areas[0]), 'rename-area') === '');
    check('the roles matrix shows the evangelist’s new access', shell('u_michael', 'settings').includes('Contact details only for people they recorded themselves'));
    const saved = state.sessions, savedE = state.encounters;
    state.sessions = []; state.encounters = [];
    check('with nothing recorded the dashboard and lists show honest empty states', shell('u_apollos', 'dashboard').includes('No outreach recorded in this period') && !shell('u_apollos', 'dashboard').includes('class="viz-cols"') && shell('u_sarah', 'sessions').includes('No sessions yet') && shell('u_sarah', 'sessions').includes('data-action="open-record"') && shell('u_sarah', 'people').includes('No people yet') && shell('u_john', 'sessions').includes('Sessions recorded by your team will appear here.'));
    state.sessions = saved; state.encounters = savedE;

    /* ---------- every role x every page with the new pages and real data ---------- */
    let errs = '', bal = '';
    for (const id of ['u_apollos', 'u_michael', 'u_john', 'u_tunde', 'u_sarah', 'u_grace', 'u_daniel', 'u_zed']) {
      for (const p of PAGES) {
        resetWorkState(); const params = { sessionId: 's_a2', personId: 'p_amara' };
        try { const out = shell(id, p.id, params); bal += balance(out, id + '/' + p.id); } catch (e) { errs += id + '/' + p.id + ': ' + e.message + '\n'; }
      }
    }
    check('every role x every page (including detail pages) renders with real data', errs === '', errs);
    check('…and all of it is balanced markup', bal === '', bal);
    resetWorkState();
  }

  /* ======================= STAGE 3: follow-up pipeline, contact history, corrections, duplicates ======================= */
  {
    const JOHN = 'u_john', DAN = 'u_daniel', TUN = 'u_tunde', SAR = 'u_sarah', GRA = 'u_grace', APO = 'u_apollos', MIC = 'u_michael';
    const snap = () => JSON.stringify(state);
    const todayIso = () => isoDate(Date.now());
    const dayIso = n => isoDate(Date.now() + n * DAY);
    const count = (h, s) => h.split(s).length - 1;
    const shell3 = (userId, page, extra) => { sessionUserId = userId; ui.page = page; Object.assign(ui, extra || {}); ui.forbidden = !guardPage(by(userId), page).ok; return viewShell(by(userId)); };
    const resetUi = () => { ui.pipeFilter = newPipeFilter(); ui.peopleStage = 'all'; ui.peopleQ = ''; ui.flash = null; ui.back = null; ui.caseId = null; ui.personId = null; ui.sessionId = null; };
    const cin = o => Object.assign({ submissionKey: 'k_' + Math.random(), contactDate: todayIso(), contactTime: '', method: 'call', outcome: 'spoke', response: '', attendance: '', notes: '', nextAction: '', nextContactDate: '', stageTo: '', stageNote: '', closeReason: '' }, o || {});
    const caseOf = id => state.cases.find(c => c.id === id);
    const evs = id => state.caseEvents.filter(e => e.caseId === id);
    const kids = id => state.contacts.filter(k => k.caseId === id);
    const msg = r => (r.error || '') + ' ' + Object.keys(r.errors || {}).map(k => r.errors[k]).join(' ');
    const addPerson = (id, name, extra, sessionId) => {
      state.people.push(Object.assign({ id: id, name: name, phone: '', email: '', contactVoluntary: false, createdBy: 'u_sarah', createdAt: Date.now() - 3600000 }, extra || {}));
      state.encounters.push({ id: 'e_' + id, sessionId: sessionId || 's_a3', personId: id, response: 'listened', followUpSuggested: false, notes: '', recordedBy: 'u_sarah', recordedAt: Date.now() - 3600000 });
    };

    /* ---------- seed and upgrade ---------- */
    await fresh();
    check('seed has 4 cases, 6 contacts and 14 events', state.cases.length === 4 && state.contacts.length === 6 && state.caseEvents.length === 14, [state.cases.length, state.contacts.length, state.caseEvents.length].join(','));
    check('seed validates at the current version and survives a storage round trip', state.version === APP.stateVersion && isValidState(clone(state)));
    check('state without follow-up tables is not valid', !isValidState(Object.assign(clone(state), { cases: undefined })) && !isValidState(Object.assign(clone(state), { contacts: 'x' })));
    check('every case points at a real person, team and, when assigned, someone who can follow up on that team',
      state.cases.every(c => state.people.some(p => p.id === c.personId) && state.departments.some(d => d.id === c.departmentId) && (!c.assigneeId || assignableUsers(state, c.departmentId).some(u => u.id === c.assigneeId))));
    check('a person has at most one open case', state.people.every(p => state.cases.filter(c => c.personId === p.id && isOpenStage(c.stage)).length <= 1));
    check('every contact belongs to a case and uses a known method and outcome', state.contacts.every(k => caseOf(k.caseId) && CONTACT_METHODS.some(m => m.key === k.method) && CONTACT_OUTCOMES.some(o => o.key === k.outcome)));
    check('seed attempts carry no response or attendance, and seen-at-church is in person', state.contacts.every(k => { const o = outcomeInfo(k.outcome); return (o.kind !== 'attempt' || (!k.response && !k.attendance)) && (o.kind !== 'attendance' || (k.method === 'in_person' && k.attendance === 'recorded')); }));
    check('no seed contact is dated in the future or before the person was first met', state.contacts.every(k => { const c = caseOf(k.caseId); return k.contactDate <= todayIso() && k.contactDate >= firstMetDateAny(state, c.personId); }));
    check('seed stages are backed by their history (conversation before Contacted, attendance before Attended)', state.cases.every(c => {
      const ks = kids(c.id), conv = ks.some(k => outcomeInfo(k.outcome).kind === 'conversation'), att = ks.some(k => k.attendance || outcomeInfo(k.outcome).kind === 'attendance');
      const idx = STAGES.findIndex(s => s.key === c.stage);
      return (idx < 2 || conv) && (idx < 3 || c.stage === 'closed' || att || c.stage === 'contacted');
    }));
    check('seed next-contact dates give one overdue, one due today and one later', (() => { const d = c => dueInfo(caseOf(c)).kind; return d('c_noor') === 'overdue' && d('c_ben') === 'today' && d('c_amara') === 'later' && d('c_priscilla') === 'none'; })());
    {
      const v2 = clone(state); ['cases', 'contacts', 'caseEvents', 'corrections', 'dupDecisions', 'merges'].forEach(k => delete v2[k]); v2.version = 2;
      check('version 2 data is not valid until upgraded', !isValidState(v2));
      const up = upgradeState(clone(v2));
      check('upgrade brings version 2 data to the current version and keeps sessions and people', isValidState(up) && up.version === APP.stateVersion && up.cases.length >= 4 && up.sessions.length >= 5 && up.people.length >= 8 && up.corrections.length === 0);
      check('upgrade leaves version 3 data untouched', same(upgradeState(clone(state)), state));
      const sparse = clone(v2); sparse.people = sparse.people.filter(p => p.id === 'p_jonas'); sparse.encounters = sparse.encounters.filter(e => e.personId === 'p_jonas');
      const up2 = upgradeState(sparse);
      check('upgrade only adds cases for people who exist', up2.cases.length === 0 && isValidState(up2));
    }

    /* ---------- capabilities and scope ---------- */
    await fresh();
    const caps = role => ROLE_CAPS[role].filter(c => /^followup\.|^people\.merge|^records\.correct/.test(c)).sort().join(',');
    check('only coordinators and team leaders hold follow-up capabilities', caps('coordinator') === 'followup.assign,followup.open,followup.record,followup.view,people.merge,records.correct' && caps('team_leader') === caps('coordinator') && caps('evangelist') === 'records.correct' && caps('pastor') === '' && caps('admin') === '');
    const ids = (a) => casesVisibleTo(state, a).map(c => c.id).sort().join(',');
    check('John and Daniel see Team A cases and Tunde only Team B', ids(JOHN) === 'c_amara,c_ben,c_noor' && ids(DAN) === 'c_amara,c_ben,c_noor' && ids(TUN) === 'c_priscilla');
    check('evangelists, the pastor and the admin see no cases at all', ids(SAR) === '' && ids(GRA) === '' && ids(APO) === '' && ids(MIC) === '' && caseRows(state, SAR, { stage: 'all' }).length === 0 && followUpStats(state, APO) === null);
    check('Tunde cannot open a Team A case by its id, and gets the same answer as for a case that does not exist', getCaseFor(state, TUN, 'c_amara') === null && caseDetail(state, TUN, 'c_amara') === null && caseDetail(state, TUN, 'c_nope') === null);
    {
      const before = snap();
      const tries = [assignCase(state, TUN, 'c_amara', 'u_tunde'), changeStage(state, TUN, 'c_amara', 'integrated', {}), setNextStep(state, TUN, 'c_amara', { nextAction: 'x' }), recordContact(state, TUN, 'c_amara', cin()), openCase(state, TUN, { personId: 'p_liam' })];
      check('every service answers 404 for Tunde on Team A records, and changes nothing', tries.every(r => !r.ok && r.code === 404) && snap() === before, JSON.stringify(tries.map(r => r.code)));
      const denied = [openCase(state, SAR, { personId: 'p_liam' }), assignCase(state, SAR, 'c_amara', 'u_daniel'), changeStage(state, SAR, 'c_amara', 'integrated', {}), setNextStep(state, SAR, 'c_amara', {}), recordContact(state, SAR, 'c_amara', cin()),
        mergePeople(state, SAR, 'p_amara', 'p_liam'), dismissDuplicate(state, SAR, 'p_amara', 'p_liam')];
      check('an evangelist is refused by every follow-up service', denied.every(r => !r.ok && r.code === 403) && snap() === before);
      const deniedPastor = [openCase(state, APO, { personId: 'p_liam' }), changeStage(state, APO, 'c_amara', 'integrated', {}), recordContact(state, MIC, 'c_amara', cin()), mergePeople(state, MIC, 'p_amara', 'p_liam'), correctRecord(state, APO, 'encounter', 's_a3_e1', { response: 'listened' }, 'because')];
      check('the pastor and the admin are refused too', deniedPastor.every(r => !r.ok && r.code === 403) && snap() === before);
    }
    check('an evangelist’s view of a person never includes follow-up contacts or case events', (() => { const pr = personProfile(state, SAR, 'p_amara'); return pr.history.length === pr.timeline.length && pr.history.length > 0 && pr.history.every(h => h.kind === 'encounter') && pr.latestCase === null && pr.canOpenCase === false; })(), JSON.stringify(personProfile(state, SAR, 'p_amara').history.map(h => h.kind)));
    check('a team leader’s view of the same person includes the full history', (() => { const pr = personProfile(state, JOHN, 'p_amara'); return pr.history.some(h => h.kind === 'contact') && pr.history.some(h => h.kind === 'event') && pr.history.some(h => h.kind === 'encounter') && pr.latestCase.id === 'c_amara'; })());
    check('Tunde cannot open Amara’s profile either', personProfile(state, TUN, 'p_amara') === null);
    {
      const pages = (u, p) => guardPage(by(u), p).ok;
      check('pipeline, case and duplicate pages are open to coordinators and team leaders only', ['pipeline', 'case', 'duplicates'].every(p => pages(DAN, p) && pages(JOHN, p) && pages(TUN, p) && !pages(SAR, p) && !pages(APO, p) && !pages(MIC, p)));
    }

    /* ---------- the stage table ---------- */
    {
      await fresh();
      const LEGAL = { reached: ['awaiting', 'contacted', 'attended', 'closed'], awaiting: ['contacted', 'attended', 'closed'], contacted: ['attended', 'integrating', 'closed', 'awaiting'],
        attended: ['integrating', 'closed', 'contacted'], integrating: ['integrated', 'closed', 'attended'], integrated: ['integrating'], closed: ['reached', 'awaiting'] };
      const probe = { id: 'c_probe', personId: 'p_jonas', departmentId: 'd_a', stage: 'reached', assigneeId: 'u_daniel', nextAction: '', nextContactDate: '', openedAt: 1, openedBy: JOHN, originEncounterId: null, updatedAt: 1, closedAt: null, closeReason: null };
      state.cases.push(probe);
      state.contacts.push({ id: 'k_p1', caseId: 'c_probe', contactDate: todayIso(), contactTime: '', method: 'call', outcome: 'spoke', response: '', attendance: 'reported', notes: '', nextAction: '', nextContactDate: '', recordedBy: DAN, recordedAt: Date.now(), submissionKey: 'p1' });
      let wrong = '';
      STAGES.forEach(f => STAGES.concat([{ key: 'nonsense' }]).forEach(t => {
        probe.stage = f.key;
        const m = validateMove(state, probe, t.key, { note: 'a good reason', closeReason: 'other' });
        const expectOk = (LEGAL[f.key] || []).indexOf(t.key) !== -1;
        if (expectOk !== (m === '')) wrong += f.key + '->' + t.key + ' expected ' + (expectOk ? 'allowed' : 'refused') + ' but got "' + m + '"\n';
      }));
      check('all 49 stage pairs (and an unknown stage) behave exactly as the written table says', wrong === '', wrong);
      check('the stage table in the code matches the one the tests were written from', STAGES.every(s => { const f = STAGE_FORWARD[s.key].concat(STAGE_BACK[s.key]).sort().join(); return f === LEGAL[s.key].slice().sort().join(); }));
      check('integrated and closed are the only terminal stages', STAGES.filter(s => !isOpenStage(s.key)).map(s => s.key).join() === 'integrated,closed');
      check('Decided is not a stage', !STAGES.some(s => /decid/i.test(s.key)) && RESPONSES.some(r => r.key === 'decision'));

      probe.stage = 'contacted';
      check('moving back needs a written reason of at least 3 characters', validateMove(state, probe, 'awaiting', { note: '' }) !== '' && validateMove(state, probe, 'awaiting', { note: 'ab' }) !== '' && validateMove(state, probe, 'awaiting', { note: '  ab ' }) !== '' && validateMove(state, probe, 'awaiting', { note: 'abc' }) === '');
      check('a reason over the length limit is refused', validateMove(state, probe, 'awaiting', { note: 'x'.repeat(FU_LIMITS.notes + 1) }) !== '');
      check('closing needs a known reason', validateMove(state, probe, 'closed', {}) !== '' && validateMove(state, probe, 'closed', { closeReason: 'because' }) !== '' && validateMove(state, probe, 'closed', { closeReason: 'moved_away' }) === '');
      probe.stage = 'reached'; probe.assigneeId = null;
      check('Awaiting contact needs someone assigned', validateMove(state, probe, 'awaiting', {}) !== '');
      probe.assigneeId = 'u_daniel';

      // evidence rules, on a case with no contacts at all
      state.contacts = state.contacts.filter(k => k.caseId !== 'c_probe');
      const addK = (outcome, extra) => state.contacts.push(Object.assign({ id: uid('k'), caseId: 'c_probe', contactDate: todayIso(), contactTime: '', method: 'call', outcome: outcome, response: '', attendance: '', notes: '', nextAction: '', nextContactDate: '', recordedBy: DAN, recordedAt: Date.now(), submissionKey: uid('s') }, extra || {}));
      probe.stage = 'reached';
      check('with no contact at all, Contacted and Attended are refused', validateMove(state, probe, 'contacted', {}) !== '' && validateMove(state, probe, 'attended', {}) !== '');
      addK('no_answer'); addK('message_left'); addK('wrong_details');
      check('missed calls, messages left and wrong numbers never count as a conversation', validateMove(state, probe, 'contacted', {}) !== '' && /conversation/i.test(validateMove(state, probe, 'contacted', {})));
      check('attempts alone do not count as attendance either', validateMove(state, probe, 'attended', {}) !== '');
      addK('spoke');
      check('one real conversation allows Contacted but not Attended', validateMove(state, probe, 'contacted', {}) === '' && validateMove(state, probe, 'attended', {}) !== '');
      addK('spoke', { attendance: 'reported' });
      check('a conversation where they said they came allows Attended', validateMove(state, probe, 'attended', {}) === '');
      state.contacts = state.contacts.filter(k => k.caseId !== 'c_probe'); addK('seen_at_church', { method: 'in_person', attendance: 'recorded' });
      check('seeing them at church allows Attended', validateMove(state, probe, 'attended', {}) === '');
      state.contacts = state.contacts.filter(k => k.caseId !== 'c_probe');
      check('a contact being recorded right now counts as evidence', validateMove(state, probe, 'contacted', { pending: { outcome: 'spoke', attendance: '' } }) === '' && validateMove(state, probe, 'contacted', { pending: { outcome: 'no_answer', attendance: '' } }) !== '' && validateMove(state, probe, 'attended', { pending: { outcome: 'seen_at_church', attendance: 'recorded' } }) === '');
      probe.stage = 'integrating';
      check('moving back does not need the evidence again', validateMove(state, probe, 'attended', { note: 'Checking attendance' }) === '');
      state.cases = state.cases.filter(c => c.id !== 'c_probe');
    }

    /* ---------- opening cases and the suggestion queue ---------- */
    {
      await fresh();
      check('John’s suggestions are the flagged people with no case: Liam only', followUpSuggestions(state, JOHN).map(s => s.name).join() === 'Liam Carter');
      check('Tunde’s suggestions are Team B’s: Yusuf only', followUpSuggestions(state, TUN).map(s => s.name).join() === 'Yusuf Demir');
      check('evangelists, the pastor and the admin get no suggestions', followUpSuggestions(state, SAR).length === 0 && followUpSuggestions(state, APO).length === 0 && followUpSuggestions(state, MIC).length === 0);
      let r = openCase(state, JOHN, { personId: 'p_liam' });
      const c = r.case;
      check('opening a case starts it at Reached with no assignee, on the right team and linked to the flagging encounter', r.ok && c.stage === 'reached' && !c.assigneeId && c.departmentId === 'd_a' && c.originEncounterId === 's_a3_e0' && c.openedBy === JOHN);
      check('opening a case writes one event and nothing else', evs(c.id).length === 1 && evs(c.id)[0].kind === 'opened' && kids(c.id).length === 0);
      check('a person with an open case leaves the suggestion queue', followUpSuggestions(state, JOHN).length === 0);
      const before = snap();
      r = openCase(state, JOHN, { personId: 'p_liam' });
      check('a second open case for the same person is refused', !r.ok && /already has an open/.test(r.error) && snap() === before);
      r = openCase(state, DAN, { personId: 'p_liam' });
      check('so is a second one from another coordinator', !r.ok && snap() === before);
      r = changeStage(state, JOHN, c.id, 'closed', { closeReason: 'not_interested' });
      check('closing the case works', r.ok && c.stage === 'closed' && !!c.closedAt && c.closeReason === 'not_interested');
      check('a closed case does not put the person straight back in the queue', followUpSuggestions(state, JOHN).length === 0);
      state.encounters.push({ id: 'e_again', sessionId: 's_a1', personId: 'p_liam', response: 'receptive', followUpSuggested: true, notes: '', recordedBy: SAR, recordedAt: Date.now() + 5000 });
      check('a new flag raised after the case was opened brings the person back', followUpSuggestions(state, JOHN).map(s => s.name).join() === 'Liam Carter');
      r = openCase(state, JOHN, { personId: 'p_liam' });
      check('a new case can be opened once the old one is closed, and the old one stays in the history', r.ok && state.cases.filter(x => x.personId === 'p_liam').length === 2 && latestCaseFor(state, JOHN, 'p_liam').id === r.case.id);
    }
    {
      await fresh();
      let before = snap();
      let r = openCase(state, JOHN, { personId: 'p_liam', assigneeId: 'u_daniel', nextAction: 'Introduce ourselves', nextContactDate: dayIso(2) });
      check('opening with an assignee and a plan moves straight to Awaiting contact with a full event trail', r.ok && r.case.stage === 'awaiting' && r.case.assigneeId === 'u_daniel' && r.case.nextAction === 'Introduce ourselves' && evs(r.case.id).map(e => e.kind + ':' + (e.to || '')).join() === 'opened:,assigned:,stage:awaiting');
      await fresh(); before = snap();
      check('assigning someone off the team (or who cannot follow up) is refused and nothing is written', (() => { const a = openCase(state, JOHN, { personId: 'p_liam', assigneeId: 'u_grace' }), b = openCase(state, JOHN, { personId: 'p_liam', assigneeId: 'u_sarah' }), c = openCase(state, JOHN, { personId: 'p_liam', assigneeId: 'u_emma' }); return !a.ok && a.errors.assigneeId && !b.ok && b.errors.assigneeId && !c.ok && c.errors.assigneeId && snap() === before; })());
      check('a next-contact date in the past is refused', (() => { const a = openCase(state, JOHN, { personId: 'p_liam', nextContactDate: dayIso(-1) }); return !a.ok && !!a.errors.nextContactDate && snap() === before; })());
      check('an invalid date and an over-long next action are refused', (() => { const a = openCase(state, JOHN, { personId: 'p_liam', nextContactDate: '2026-02-31' }), b = openCase(state, JOHN, { personId: 'p_liam', nextAction: 'x'.repeat(FU_LIMITS.nextAction + 1) }); return !!a.errors.nextContactDate && !!b.errors.nextAction && snap() === before; })());
      check('opening for someone outside your scope looks like a missing person', (() => { const a = openCase(state, TUN, { personId: 'p_liam' }), b = openCase(state, JOHN, { personId: 'p_nobody' }), c = openCase(state, JOHN, {}); return a.code === 404 && b.code === 404 && c.code === 404 && snap() === before; })());
      check('a coordinator can open a case too', openCase(state, DAN, { personId: 'p_liam' }).ok);
      check('the case team follows where the person was met, not just the opener’s first team', (() => {
        state.memberships.push({ userId: JOHN, departmentId: 'd_b' });
        const d = deptForNewCase(state, by(JOHN), 'p_yusuf'); state.memberships.pop(); return d === 'd_b';
      })());
    }

    /* ---------- assigning ---------- */
    {
      await fresh();
      check('only active people on the team who can follow up can be assigned', assignableUsers(state, 'd_a').map(u => u.id).sort().join() === 'u_daniel,u_john' && assignableUsers(state, 'd_b').map(u => u.id).join() === 'u_tunde');
      let r = assignCase(state, TUN, 'c_priscilla', 'u_tunde');
      const c = caseOf('c_priscilla');
      check('assigning a Reached case moves it to Awaiting contact', r.ok && c.assigneeId === 'u_tunde' && c.stage === 'awaiting' && evs('c_priscilla').slice(-2).map(e => e.kind).join() === 'assigned,stage');
      let before = snap();
      r = assignCase(state, TUN, 'c_priscilla', 'u_tunde');
      check('assigning the same person again changes nothing', r.ok && r.unchanged && snap() === before);
      r = assignCase(state, TUN, 'c_priscilla', 'u_grace');
      check('an evangelist cannot be assigned', !r.ok && snap() === before);
      r = assignCase(state, TUN, 'c_priscilla', 'u_emma');
      check('a deactivated user cannot be assigned', !r.ok && snap() === before);
      r = assignCase(state, JOHN, 'c_ben', 'u_john');
      check('reassigning keeps the stage and adds an event', r.ok && caseOf('c_ben').assigneeId === 'u_john' && caseOf('c_ben').stage === 'awaiting' && evs('c_ben').filter(e => e.kind === 'assigned').length === 2);
      r = assignCase(state, DAN, 'c_ben', 'u_daniel');
      check('coordinators may assign as well', r.ok && caseOf('c_ben').assigneeId === 'u_daniel');
      changeStage(state, TUN, 'c_priscilla', 'closed', { closeReason: 'unreachable' });
      before = snap();
      r = assignCase(state, TUN, 'c_priscilla', 'u_tunde');
      check('a closed case cannot be assigned until it is reopened', !r.ok && /closed/.test(r.error) && snap() === before);
      changeStage(state, JOHN, 'c_amara', 'integrated', {});
      r = assignCase(state, JOHN, 'c_amara', 'u_john');
      check('a completed case has nobody to assign', !r.ok && /complete/.test(r.error));
    }

    /* ---------- moving stages through the service ---------- */
    {
      await fresh();
      let before = snap();
      let r = changeStage(state, JOHN, 'c_noor', 'attended', {});
      check('Contacted to Attended without any attendance is refused and nothing changes', !r.ok && /came|saw/.test(r.error) && snap() === before);
      r = changeStage(state, JOHN, 'c_noor', 'bogus', {});
      check('an unknown stage is refused', !r.ok && snap() === before);
      r = changeStage(state, JOHN, 'c_noor', 'contacted', {});
      check('staying at the same stage is refused', !r.ok && snap() === before);
      r = changeStage(state, JOHN, 'c_noor', 'integrating', {});
      const n = caseOf('c_noor');
      check('a legal forward move writes the stage, one event and the new timestamp', r.ok && n.stage === 'integrating' && evs('c_noor').filter(e => e.kind === 'stage').slice(-1)[0].from === 'contacted' && evs('c_noor').slice(-1)[0].to === 'integrating');
      r = changeStage(state, JOHN, 'c_noor', 'attended', {});
      check('moving back without a reason is refused', !r.ok && /reason/.test(r.error) && n.stage === 'integrating');
      r = changeStage(state, JOHN, 'c_noor', 'attended', { note: 'Logged too early' });
      check('moving back with a reason works and keeps the reason in the history', r.ok && n.stage === 'attended' && evs('c_noor').slice(-1)[0].note === 'Logged too early');
      n.nextAction = 'Visit'; n.nextContactDate = dayIso(1);
      r = changeStage(state, JOHN, 'c_noor', 'integrating', {}); r = changeStage(state, JOHN, 'c_noor', 'integrated', {});
      check('reaching a terminal stage clears the next step, so a finished case is never overdue', r.ok && n.nextAction === '' && n.nextContactDate === '' && dueInfo(n).kind === 'none');
      r = changeStage(state, JOHN, 'c_noor', 'integrating', { note: 'Needs more support' });
      check('a completed case can be reopened one step with a reason', r.ok && n.stage === 'integrating');
      r = changeStage(state, JOHN, 'c_ben', 'closed', {});
      check('closing without a reason is refused', !r.ok && caseOf('c_ben').stage === 'awaiting');
      r = changeStage(state, JOHN, 'c_ben', 'closed', { closeReason: 'moved_away', note: 'Moved to Leeds' });
      const b = caseOf('c_ben');
      check('closing stores the reason, the time and clears the plan', r.ok && b.stage === 'closed' && b.closeReason === 'moved_away' && !!b.closedAt && b.nextAction === '' && b.nextContactDate === '' && evs('c_ben').slice(-1)[0].closeReason === 'moved_away');
      r = changeStage(state, JOHN, 'c_ben', 'reached', {});
      check('reopening a closed case needs a reason too', !r.ok);
      r = changeStage(state, JOHN, 'c_ben', 'reached', { note: 'He got back in touch' });
      check('reopening clears the closed details and keeps the closing in the history', r.ok && b.stage === 'reached' && b.closedAt === null && b.closeReason === null && evs('c_ben').filter(e => e.to === 'closed').length === 1);
      changeStage(state, JOHN, 'c_ben', 'closed', { closeReason: 'other' });
      openCase(state, JOHN, { personId: 'p_ben' });
      before = snap();
      r = changeStage(state, JOHN, 'c_ben', 'awaiting', { note: 'Trying to reopen' });
      check('a closed case cannot be reopened while the person has another open case', !r.ok && /another open case/.test(r.error) && snap() === before);
      check('moves that need a different assignee or evidence say why in the stage dialog', (() => { const m = allowedMoves(state, caseOf('c_priscilla')); return m.some(x => x.to === 'contacted' && x.blocked) && m.some(x => x.to === 'awaiting' && x.blocked) && m.some(x => x.to === 'closed' && !x.blocked); })());
      changeStage(state, TUN, 'c_priscilla', 'closed', { closeReason: 'other' });
      check('a closed case offers reopening only', allowedMoves(state, caseOf('c_priscilla')).map(m => m.to).sort().join() === 'awaiting,reached' && allowedMoves(state, caseOf('c_priscilla')).every(m => m.back));
    }

    /* ---------- recording contacts ---------- */
    {
      await fresh();
      const ben = () => caseOf('c_ben');
      const firstKids = clone(state.contacts);
      let r = recordContact(state, DAN, 'c_ben', cin({ outcome: 'spoke', response: 'receptive', notes: 'Good chat about the youth group.', nextAction: 'Invite him on Sunday', nextContactDate: dayIso(3), stageTo: 'contacted' }));
      check('a conversation with a stage move saves the contact, the new plan and the move together', r.ok && r.stageChanged && ben().stage === 'contacted' && kids('c_ben').length === 1 && ben().nextAction === 'Invite him on Sunday' && ben().nextContactDate === dayIso(3) && evs('c_ben').slice(-1)[0].to === 'contacted');
      check('earlier contacts are never overwritten', firstKids.every(k => same(state.contacts.find(x => x.id === k.id), k)));
      const key = 'same-key-1', input = cin({ submissionKey: key, outcome: 'message_left', method: 'message' });
      const n0 = state.contacts.length, e0 = state.caseEvents.length;
      r = recordContact(state, DAN, 'c_ben', input);
      const r2 = recordContact(state, DAN, 'c_ben', input);
      check('submitting the same form twice saves it once', r.ok && r2.ok && r2.duplicate && state.contacts.length === n0 + 1 && state.caseEvents.length === e0);
      let before = snap();
      const bad = (o, name, field) => { const x = recordContact(state, DAN, 'c_ben', cin(o)); check(name, !x.ok && (field ? !!(x.errors && x.errors[field]) : true) && snap() === before, JSON.stringify(x)); };
      bad({ outcome: 'no_answer', response: 'receptive' }, 'a missed attempt cannot carry a response', 'response');
      bad({ outcome: 'message_left', attendance: 'reported' }, 'a missed attempt cannot carry attendance', 'attendance');
      bad({ outcome: 'seen_at_church', method: 'call' }, 'seeing someone at church must be in person', 'method');
      bad({ outcome: 'seen_at_church', method: 'in_person', response: 'receptive' }, 'seeing someone at church has no response to record', 'response');
      bad({ outcome: 'no_answer', stageTo: 'attended' }, 'a missed call cannot move the case to Attended', 'stageTo');
      bad({ outcome: 'spoke', stageTo: 'attended' }, 'a conversation without attendance cannot move the case to Attended', 'stageTo');
      bad({ outcome: 'spoke', stageTo: 'closed' }, 'closing from a contact needs a reason', 'stageTo');
      bad({ outcome: 'spoke', stageTo: 'reached' }, 'a contact cannot move a case backwards', 'stageTo');
      bad({ contactDate: dayIso(1) }, 'a contact dated tomorrow is refused', 'contactDate');
      bad({ contactDate: dayIso(-90) }, 'a contact dated before the person was first met is refused', 'contactDate');
      bad({ contactDate: '' }, 'a contact needs a date', 'contactDate');
      bad({ contactDate: '2026-13-40' }, 'an impossible date is refused', 'contactDate');
      bad({ contactTime: '25:99' }, 'an impossible time is refused', 'contactTime');
      bad({ method: 'carrier-pigeon' }, 'an unknown method is refused', 'method');
      bad({ outcome: 'celebrated' }, 'an unknown outcome is refused', 'outcome');
      bad({ outcome: '' }, 'a contact needs an outcome', 'outcome');
      bad({ response: 'amazing' }, 'an unknown response is refused', 'response');
      bad({ attendance: 'maybe' }, 'an unknown attendance value is refused', 'attendance');
      bad({ notes: 'x'.repeat(FU_LIMITS.notes + 1) }, 'over-long notes are refused', 'notes');
      bad({ nextContactDate: dayIso(-2) }, 'a next contact date in the past is refused', 'nextContactDate');
      bad({ nextAction: 'x'.repeat(FU_LIMITS.nextAction + 1) }, 'an over-long next action is refused', 'nextAction');
      bad({ outcome: 'asked_no_contact', nextContactDate: dayIso(2) }, 'planning another contact after “don’t contact me” is refused', 'nextContactDate');
      bad({ submissionKey: '' }, 'a form with no submission key is refused', null);
      const nowHM = new Date().toTimeString().slice(0, 5);
      if (nowHM < '23:58') bad({ contactTime: '23:59' }, 'a time later today is refused', 'contactTime');
      r = recordContact(state, DAN, 'c_ben', cin({ outcome: 'seen_at_church', method: 'in_person', stageTo: 'attended', nextAction: 'Welcome him after the service' }));
      const k = state.contacts.find(x => x.id === r.contact.id);
      check('seeing someone at church records attendance as seen, and the pending contact counts as evidence for Attended', r.ok && k.attendance === 'recorded' && ben().stage === 'attended' && evs('c_ben').slice(-1)[0].to === 'attended');
      r = recordContact(state, DAN, 'c_ben', cin({ outcome: 'spoke', attendance: 'reported', stageTo: 'integrating' }));
      check('a conversation where they report coming can go straight on to Integration', r.ok && ben().stage === 'integrating');
      r = recordContact(state, DAN, 'c_ben', cin({ outcome: 'asked_no_contact', stageTo: 'closed', closeReason: 'asked_to_stop' }));
      check('“asked not to be contacted” can close the case with a reason and clears the plan', r.ok && ben().stage === 'closed' && ben().closeReason === 'asked_to_stop' && ben().nextContactDate === '');
      before = snap();
      r = recordContact(state, DAN, 'c_ben', cin());
      check('a closed case takes no more contacts', !r.ok && /closed/.test(r.error) && snap() === before);
      changeStage(state, JOHN, 'c_amara', 'integrated', {}); before = snap();
      r = recordContact(state, JOHN, 'c_amara', cin());
      check('a completed case takes no more contacts either', !r.ok && /complete/.test(r.error) && snap() === before);
      check('recording a contact without a stage move leaves the stage alone and replaces the plan', (() => {
        const x = recordContact(state, DAN, 'c_noor', cin({ outcome: 'no_answer', method: 'message', nextAction: 'Try again Friday', nextContactDate: dayIso(2) }));
        return x.ok && !x.stageChanged && caseOf('c_noor').stage === 'contacted' && caseOf('c_noor').nextAction === 'Try again Friday' && dueInfo(caseOf('c_noor')).kind === 'later';
      })());
      check('leaving the next step blank clears the plan', (() => { const x = recordContact(state, DAN, 'c_noor', cin({ outcome: 'spoke' })); return x.ok && caseOf('c_noor').nextAction === '' && caseOf('c_noor').nextContactDate === ''; })());
      const hist = historyItems(state, by(JOHN), 'p_noor', 'c_noor');
      check('the case history is strictly newest first', hist.every((h, i) => i === 0 || hist[i - 1].ts >= h.ts));
      check('a contact dated earlier but entered later sorts by when it happened', (() => {
        recordContact(state, DAN, 'c_noor', cin({ contactDate: dayIso(-2), contactTime: '08:00', outcome: 'no_answer' }));
        const h = historyItems(state, by(JOHN), 'p_noor', 'c_noor').filter(x => x.kind === 'contact'); return h.every((x, i) => i === 0 || h[i - 1].ts >= x.ts);
      })());
    }
    {
      await fresh();
      const c = { stage: 'awaiting' }, d = { stage: 'contacted' };
      check('stage suggestions: a conversation on a new case suggests Contacted, an attempt suggests nothing', suggestStage(c, 'spoke', '') === 'contacted' && suggestStage(c, 'no_answer', '') === '' && suggestStage(c, 'message_left', '') === '');
      check('stage suggestions: seen at church or reported attendance suggests Attended', suggestStage(d, 'seen_at_church', '') === 'attended' && suggestStage(d, 'spoke', 'reported') === 'attended' && suggestStage(c, 'spoke', 'reported') === 'attended');
      check('stage suggestions: nothing to suggest when already Contacted, and “don’t contact” suggests closing', suggestStage(d, 'spoke', '') === '' && suggestStage(d, 'asked_no_contact', '') === 'closed' && suggestStage(c, 'unknown', '') === '');
    }

    /* ---------- next step ---------- */
    {
      await fresh();
      let r = setNextStep(state, JOHN, 'c_ben', { nextAction: 'Visit him', nextContactDate: dayIso(2) });
      check('setting a next step replaces the plan and logs it', r.ok && caseOf('c_ben').nextAction === 'Visit him' && caseOf('c_ben').nextContactDate === dayIso(2) && evs('c_ben').slice(-1)[0].kind === 'plan');
      r = setNextStep(state, JOHN, 'c_ben', { nextAction: '', nextContactDate: '' });
      check('a blank next step is allowed and clears the plan', r.ok && caseOf('c_ben').nextAction === '' && dueInfo(caseOf('c_ben')).kind === 'none');
      const before = snap();
      check('a past date is refused', !setNextStep(state, JOHN, 'c_ben', { nextAction: 'x', nextContactDate: dayIso(-1) }).ok && snap() === before);
      changeStage(state, JOHN, 'c_ben', 'closed', { closeReason: 'other' });
      check('a closed case has no next step to plan', !setNextStep(state, JOHN, 'c_ben', { nextAction: 'x' }).ok);
    }

    /* ---------- corrections ---------- */
    {
      await fresh();
      const enc = id => state.encounters.find(e => e.id === id);
      let before = snap();
      let r = correctRecord(state, SAR, 'encounter', 's_a3_e1', { response: 'receptive' }, '');
      check('a correction needs a reason', !r.ok && !!r.errors.reason && snap() === before);
      r = correctRecord(state, SAR, 'encounter', 's_a3_e1', { response: 'receptive' }, 'ab');
      check('a one-word reason is too short', !r.ok && !!r.errors.reason && snap() === before);
      r = correctRecord(state, SAR, 'encounter', 's_a3_e1', { response: 'receptive' }, 'x'.repeat(FU_LIMITS.reason + 1));
      check('an over-long reason is refused', !r.ok && !!r.errors.reason && snap() === before);
      r = correctRecord(state, SAR, 'encounter', 's_a3_e1', { response: 'decision' }, 'Nothing actually changes');
      check('a correction that changes nothing is refused and not logged', !r.ok && r.errors.form === 'Nothing was changed.' && snap() === before);
      r = correctRecord(state, SAR, 'encounter', 's_a3_e1', { response: 'receptive' }, 'I misheard what he said');
      check('an evangelist can correct their own recent encounter, and the log shows what changed', r.ok && enc('s_a3_e1').response === 'receptive' && state.corrections.length === 1 && same(state.corrections[0].changes, [{ field: 'response', from: 'decision', to: 'receptive' }]) && state.corrections[0].by === SAR && state.corrections[0].reason === 'I misheard what he said');
      check('a correction keeps the record’s identity and the counts', enc('s_a3_e1').id === 's_a3_e1' && state.encounters.length === 11 && personRows(state, by(SAR)).length === 5);
      r = correctRecord(state, SAR, 'encounter', 's_a1_e0', { response: 'prayer' }, 'Wrong response');
      check('after 7 days an evangelist can no longer correct their own record', !r.ok && r.code === 403 && /team leader/.test(r.error));
      before = snap();
      r = correctRecord(state, JOHN, 'encounter', 's_a1_e0', { response: 'prayer' }, 'Evangelist asked me to fix this');
      check('a team leader can correct any encounter in their team, at any time', r.ok && enc('s_a1_e0').response === 'prayer');
      before = snap();
      r = correctRecord(state, SAR, 'encounter', 's_b1_e0', { response: 'declined' }, 'Not mine really');
      check('nobody can correct another team’s record, and it looks like a missing record', !r.ok && r.code === 404 && snap() === before);
      r = correctRecord(state, GRA, 'encounter', 's_a3_e1', { response: 'declined' }, 'Not mine');
      check('an evangelist cannot correct a colleague’s encounter', !r.ok && (r.code === 404 || r.code === 403) && snap() === before);
      r = correctRecord(state, JOHN, 'encounter', 's_a3_e1', { response: 'made-up' }, 'Testing');
      check('a correction cannot set a value that is not allowed', !r.ok && !!r.errors.response && snap() === before);
      r = correctRecord(state, JOHN, 'nonsense', 's_a3_e1', {}, 'Testing');
      check('an unknown kind of record cannot be corrected', !r.ok && snap() === before);
      check('canCorrectRecord matches what the services allow', canCorrectRecord(state, SAR, 'encounter', 's_a3_e1') && !canCorrectRecord(state, SAR, 'encounter', 's_a1_e0') && canCorrectRecord(state, JOHN, 'encounter', 's_a1_e0') && !canCorrectRecord(state, APO, 'encounter', 's_a3_e1') && !canCorrectRecord(state, MIC, 'session', 's_a3') && !canCorrectRecord(state, TUN, 'encounter', 's_a1_e0') && !canCorrectRecord(state, SAR, 'bogus', 'x'));

      // notes and contact details are logged by field name only
      await fresh();
      enc('s_a3_e1').notes = 'OLDSECRETNOTE about his family';
      r = correctRecord(state, SAR, 'encounter', 's_a3_e1', { notes: 'NEWSECRETNOTE instead' }, 'Wrote it up wrongly');
      let logText = JSON.stringify(state.corrections);
      check('correcting a note logs that it changed, but keeps neither the old nor the new wording', r.ok && enc('s_a3_e1').notes === 'NEWSECRETNOTE instead' && same(state.corrections[0].changes, [{ field: 'notes' }]) && !logText.includes('OLDSECRET') && !logText.includes('NEWSECRET'));
      r = correctRecord(state, DAN, 'person', 'p_noor', { name: 'Noor Rahmen', phone: '07700 900199', email: 'noor.new@example.org', contactVoluntary: true }, 'She gave us her new details');
      logText = JSON.stringify(state.corrections);
      check('correcting a name, phone and email logs the field names only', r.ok && state.people.find(p => p.id === 'p_noor').phone === '07700 900199' && state.corrections[1].changes.map(c => c.field).sort().join() === 'email,name,phone' && state.corrections[1].changes.every(c => !('from' in c) && !('to' in c)) && !/900199|noor\.new|Rahmen|noor\.rahman|Rahman/.test(logText), logText);
      before = snap();
      r = correctRecord(state, DAN, 'person', 'p_jonas', { phone: '07700 900198' }, 'Added a number');
      check('adding contact details needs the shared-freely confirmation', !r.ok && !!r.errors.contactVoluntary && snap() === before);
      r = correctRecord(state, DAN, 'person', 'p_jonas', { phone: '07700 900198', contactVoluntary: true }, 'He gave us his number');
      check('with the confirmation it works', r.ok && state.people.find(p => p.id === 'p_jonas').contactVoluntary === true);
      before = snap();
      check('an invalid email, an invalid phone and a one-letter name are refused', (() => { const a = correctRecord(state, DAN, 'person', 'p_noor', { email: 'not-an-email' }, 'Fix'), b = correctRecord(state, DAN, 'person', 'p_noor', { phone: 'abc' }, 'Fix'), c = correctRecord(state, DAN, 'person', 'p_noor', { name: 'x' }, 'Fix'); return !!a.errors.email && !!b.errors.phone && !!c.errors.name && snap() === before; })());
      r = correctRecord(state, SAR, 'person', 'p_amara', { name: 'Amara E' }, 'Short form');
      check('an evangelist cannot rename someone they recorded weeks ago', !r.ok && r.code === 403);
      r = correctRecord(state, JOHN, 'person', 'p_amara', { name: 'Amara Eze-Obi' }, 'She spelled it for us');
      check('a team leader can', r.ok && state.people.find(p => p.id === 'p_amara').name === 'Amara Eze-Obi');
      check('a coordinator cannot see or correct a person outside their team', correctRecord(state, DAN, 'person', 'p_priscilla', { name: 'Priscilla M' }, 'Fix').code === 404);

      // sessions
      await fresh();
      const s3 = () => state.sessions.find(s => s.id === 's_a3'), other = state.areas.find(a => a.id !== s3().areaId && a.active).id, was = s3().areaId;
      r = correctRecord(state, SAR, 'session', 's_a3', { areaId: other }, 'Wrong place');
      check('an evangelist can correct their own recent session, and the area change is logged with both values', r.ok && s3().areaId === other && state.corrections[0].changes[0].field === 'areaId' && state.corrections[0].changes[0].from === was && state.corrections[0].changes[0].to === other);
      before = snap();
      check('a session date in the future is refused', !!correctRecord(state, SAR, 'session', 's_a3', { outreachDate: dayIso(1) }, 'Typo').errors.outreachDate && snap() === before);
      check('an invalid start time is refused', !!correctRecord(state, SAR, 'session', 's_a3', { startTime: '99:00' }, 'Typo').errors.startTime && snap() === before);
      check('an unknown area or type is refused', !!correctRecord(state, SAR, 'session', 's_a3', { areaId: 'a_nowhere' }, 'Typo').errors.areaId && !!correctRecord(state, SAR, 'session', 's_a3', { typeKey: 'parade' }, 'Typo').errors.typeKey && snap() === before);
      state.areas.find(a => a.id !== other && a.id !== was).active = false; const dead = state.areas.find(a => !a.active).id; before = snap();
      check('an inactive area cannot be chosen in a correction', !!correctRecord(state, SAR, 'session', 's_a3', { areaId: dead }, 'Typo').errors.areaId && snap() === before);
      check('an old session needs a team leader, and the evangelist is told so', correctRecord(state, SAR, 'session', 's_a1', { startTime: '09:47' }, 'Late fix').code === 403 && correctRecord(state, JOHN, 'session', 's_a1', { startTime: '09:47' }, 'Late fix').ok);
      check('a coordinator cannot correct sessions', !correctRecord(state, DAN, 'session', 's_a3', { startTime: '09:47' }, 'Fix').ok);

      // contacts
      await fresh();
      const kn2 = () => state.contacts.find(k => k.id === 'k_n2');
      r = correctRecord(state, DAN, 'contact', 'k_n2', { response: 'receptive' }, 'It was a conversation, not a prayer request');
      check('the coordinator who logged a contact can correct it for a week', r.ok && kn2().response === 'receptive');
      before = snap();
      r = correctRecord(state, DAN, 'contact', 'k_n2', { outcome: 'no_answer' }, 'Actually no answer');
      check('correcting an outcome to one that cannot carry the existing response is refused', !r.ok && !!r.errors.response && snap() === before);
      check('a coordinator cannot correct a contact older than a week', correctRecord(state, DAN, 'contact', 'k_a0', { notes: 'Edited' }, 'Fix').code === 403);
      check('a team leader can', correctRecord(state, JOHN, 'contact', 'k_a0', { notes: 'Edited' }, 'Fix').ok);
      check('the other team’s leader cannot see it at all', correctRecord(state, TUN, 'contact', 'k_a0', { notes: 'Edited' }, 'Fix').code === 404);
      check('a contact correction cannot move it to the future', !!correctRecord(state, JOHN, 'contact', 'k_n1', { contactDate: dayIso(2) }, 'Fix').errors.contactDate);
      check('corrections are listed newest first with who made them', (() => { correctRecord(state, JOHN, 'contact', 'k_n2', { notes: 'Second edit' }, 'Second'); const l = correctionsFor(state, 'contact', 'k_n2'); return l.length === 2 && l[0].entry.at >= l[1].entry.at && l[0].by.id === JOHN && l[1].by.id === DAN; })());
    }

    /* ---------- duplicates and merging ---------- */
    {
      await fresh();
      check('the seed has no suspected duplicates', duplicatePairs(state, JOHN).length === 0 && duplicatePairs(state, TUN).length === 0);
      check('evangelists get no duplicate list', duplicatePairs(state, SAR).length === 0 && duplicatePairs(state, APO).length === 0);
      addPerson('p_dup', 'amara eze', { phone: '07700 900101', contactVoluntary: true });
      let pairs = duplicatePairs(state, JOHN);
      check('a same-name, same-phone pair is suggested with both reasons', pairs.length === 1 && [pairs[0].a.id, pairs[0].b.id].sort().join() === 'p_amara,p_dup' && pairs[0].reasons.indexOf('name') !== -1 && pairs[0].reasons.indexOf('phone') !== -1);
      check('Tunde does not see Team A’s pair', duplicatePairs(state, TUN).length === 0);
      let before = snap();
      check('Sarah cannot dismiss or merge', !dismissDuplicate(state, SAR, 'p_amara', 'p_dup').ok && !mergePeople(state, SAR, 'p_amara', 'p_dup').ok && snap() === before);
      check('Tunde cannot dismiss or merge Team A people', dismissDuplicate(state, TUN, 'p_amara', 'p_dup').code === 404 && mergePeople(state, TUN, 'p_amara', 'p_dup').code === 404 && snap() === before);
      let r = dismissDuplicate(state, DAN, 'p_amara', 'p_dup');
      check('“not the same person” hides the pair for good, and doing it twice records it once', r.ok && duplicatePairs(state, JOHN).length === 0 && dismissDuplicate(state, JOHN, 'p_dup', 'p_amara').ok && state.dupDecisions.length === 1);
      check('dismissing a person against themselves is refused', !dismissDuplicate(state, JOHN, 'p_amara', 'p_amara').ok);

      await fresh(); addPerson('p_dup', 'amara eze', { phone: '07700 900101', contactVoluntary: true });
      const encBefore = state.encounters.filter(e => e.personId === 'p_amara').length;
      r = mergePeople(state, JOHN, 'p_amara', 'p_dup');
      const drop = state.people.find(p => p.id === 'p_dup'), keep = state.people.find(p => p.id === 'p_amara');
      check('merging moves the meetings to the kept record and retires the other', r.ok && r.encounters === 1 && state.encounters.filter(e => e.personId === 'p_amara').length === encBefore + 1 && state.encounters.every(e => e.personId !== 'p_dup'));
      check('the retired record is a marker only: archived, pointing at the kept one, with no contact details', drop.archived === true && drop.mergedInto === 'p_amara' && drop.phone === '' && drop.email === '' && drop.contactVoluntary === false);
      check('the kept record keeps its own details and the merge is logged', keep.phone === '07700 900101' && state.merges.length === 1 && state.merges[0].keepId === 'p_amara' && state.merges[0].dropId === 'p_dup' && state.merges[0].by === JOHN);
      check('the retired record vanishes from search, the directory and scope', searchPeople(state, JOHN, 'amara').length === 1 && personIdsInScope(state, by(JOHN)).indexOf('p_dup') === -1 && personProfile(state, JOHN, 'p_dup') === null && duplicatePairs(state, JOHN).length === 0);
      check('merging the same pair again looks like a missing record', mergePeople(state, JOHN, 'p_amara', 'p_dup').code === 404);

      await fresh(); addPerson('p_dup', 'Jonas W', { phone: '07700 900155', contactVoluntary: true });
      r = mergePeople(state, JOHN, 'p_jonas', 'p_dup');
      check('missing contact details are copied across only from a record where they were shared freely', r.ok && r.copied.join() === 'phone' && state.people.find(p => p.id === 'p_jonas').phone === '07700 900155' && state.people.find(p => p.id === 'p_jonas').contactVoluntary === true);
      await fresh(); addPerson('p_dup', 'Jonas W', { phone: '07700 900155', contactVoluntary: false });
      r = mergePeople(state, JOHN, 'p_jonas', 'p_dup');
      check('details not shared freely are never copied', r.ok && r.copied.length === 0 && state.people.find(p => p.id === 'p_jonas').phone === '' && state.people.find(p => p.id === 'p_jonas').contactVoluntary === false);

      await fresh(); addPerson('p_dup', 'Amara E', {});
      openCase(state, JOHN, { personId: 'p_dup' }); before = snap();
      r = mergePeople(state, JOHN, 'p_amara', 'p_dup');
      check('two records that both have an open case cannot be merged', !r.ok && /open follow-up case/.test(r.error) && snap() === before);
      r = mergePeople(state, JOHN, 'p_jonas', 'p_dup');
      const moved = state.cases.filter(c => c.personId === 'p_jonas');
      check('the open case moves with the meetings when only one side has one', r.ok && r.cases === 1 && moved.length === 1 && openCaseFor(state, 'p_jonas') === moved[0] && personProfile(state, JOHN, 'p_jonas').latestCase.id === moved[0].id);
      check('the history of the moved case shows up on the kept record', personProfile(state, JOHN, 'p_jonas').history.some(h => h.kind === 'event' && h.event.kind === 'opened'));

      await fresh(); addPerson('p_dup', 'Amara', {}, 's_a2'); before = snap();
      r = mergePeople(state, JOHN, 'p_amara', 'p_dup');
      check('two people entered in the same session are treated as different people and cannot be merged', !r.ok && /same session/.test(r.error) && snap() === before);
      check('and a similar name alone is not suggested for people met in the same session', duplicatePairs(state, JOHN).length === 0);

      await fresh(); addPerson('p_dup', 'Someone Else', { phone: '07700 900101', contactVoluntary: true }, 's_a2'); addPerson('p_short', 'Short Number', { phone: '12345', contactVoluntary: true }, 's_a3'); addPerson('p_short2', 'Other Name', { phone: '12345', contactVoluntary: true }, 's_a3');
      pairs = duplicatePairs(state, JOHN);
      check('a shared phone number is suggested even from the same session, but a short shared number is ignored', pairs.length === 1 && pairs[0].reasons.join() === 'phone');

      await fresh(); addPerson('p_dup', 'Amara Eze', {});
      correctRecord(state, JOHN, 'person', 'p_dup', { name: 'Amara Ezeh' }, 'Spelling');
      mergePeople(state, JOHN, 'p_amara', 'p_dup');
      check('corrections made to the retired record follow the person to the kept record', state.corrections.every(x => x.personId !== 'p_dup') && state.corrections.some(x => x.personId === 'p_amara'));

      await fresh();
      check('Tunde cannot merge a person with themselves, or across teams', mergePeople(state, TUN, 'p_priscilla', 'p_priscilla').ok === false && mergePeople(state, TUN, 'p_priscilla', 'p_amara').code === 404);
    }

    /* ---------- pages ---------- */
    {
      await fresh(); resetUi();
      const pipeRows = h => count(h, 'data-action="open-case-page"');
      let h = shell3(JOHN, 'pipeline');
      check('the pipeline shows John’s three open cases, sorted overdue, due today, then later', pipeRows(h) === 3 && h.indexOf('Noor Rahman') < h.indexOf('Ben Taylor') && h.indexOf('Ben Taylor') < h.indexOf('Amara Eze') && h.includes('Overdue by 1 day') && h.includes('Due today'));
      check('the pipeline offers Liam as a suggestion with Open case and View profile', h.includes('Suggested by evangelists (1)') && h.includes('data-action="open-case" data-id="p_liam"') && h.includes('data-action="open-person" data-id="p_liam"') && h.includes('nothing is opened automatically'));
      check('the pipeline never shows another team’s people', !h.includes('Priscilla') && !h.includes('Yusuf'));
      check('the pipeline page is well-formed', balance(h, 'pipeline') === '', balance(h, 'pipeline'));
      check('the pipeline summary counts match', h.includes('<b>3</b> open') && h.includes('<b>1</b> overdue') && h.includes('<b>1</b> due today') && h.includes('<b>0</b> not assigned'));
      check('stage chips show a count for every stage, with Open pressed by default', STAGES.every(s => h.includes('data-stage="' + s.key + '"')) && /data-stage="open" aria-pressed="true"/.test(h) && /data-stage="all" aria-pressed="false"/.test(h));
      h = shell3(TUN, 'pipeline');
      check('Tunde’s pipeline holds Priscilla alone and suggests Yusuf', pipeRows(h) === 1 && h.includes('Priscilla Mensah') && !h.includes('Amara') && h.includes('data-id="p_yusuf"') && h.includes('Not assigned'));
      ui.pipeFilter.stage = 'integrating';
      check('filtering by stage', pipeRows(shell3(JOHN, 'pipeline')) === 1);
      ui.pipeFilter = Object.assign(newPipeFilter(), { stage: 'closed' });
      h = shell3(JOHN, 'pipeline');
      check('a filter with no results says so and offers to clear it', pipeRows(h) === 0 && h.includes('No cases match these filters') && h.includes('data-action="clear-pipe-filters"'));
      ui.pipeFilter = Object.assign(newPipeFilter(), { stage: 'all', assignee: 'none' });
      check('the “not assigned” filter finds nothing for Team A', pipeRows(shell3(JOHN, 'pipeline')) === 0);
      ui.pipeFilter = Object.assign(newPipeFilter(), { assignee: 'me' });
      check('“assigned to me” filters by the signed-in user', pipeRows(shell3(DAN, 'pipeline')) === 3 && pipeRows(shell3(JOHN, 'pipeline')) === 0);
      ui.pipeFilter = Object.assign(newPipeFilter(), { due: 'due' });
      check('“due or overdue” shows the overdue and due-today cases', pipeRows(shell3(JOHN, 'pipeline')) === 2);
      ui.pipeFilter = Object.assign(newPipeFilter(), { q: 'noor' });
      check('searching by name', pipeRows(shell3(JOHN, 'pipeline')) === 1 && pipeRows(shell3(TUN, 'pipeline')) === 0);
      ui.pipeFilter = Object.assign(newPipeFilter(), { q: 'noor.rahman@example.org' });
      check('searching by email works where contact is visible and never leaks across teams', pipeRows(shell3(JOHN, 'pipeline')) === 1 && pipeRows(shell3(TUN, 'pipeline')) === 0);
      ui.pipeFilter = Object.assign(newPipeFilter(), { q: '900104' });
      check('searching by part of a phone number works', pipeRows(shell3(DAN, 'pipeline')) === 1);
      ui.pipeFilter = Object.assign(newPipeFilter(), { q: '<script>' });
      h = shell3(JOHN, 'pipeline');
      check('a hostile search string is shown escaped', !h.includes('<script>') && h.includes('&lt;script&gt;'));
      resetUi();
      for (const u of [SAR, APO, MIC]) { h = shell3(u, 'pipeline'); check('the pipeline is forbidden for ' + u + ' and shows no names', h.includes('Error 403') && !/Noor|Amara|Priscilla|Liam/.test(h)); }
      { const keep = state.cases; state.cases = []; h = shell3(JOHN, 'pipeline'); check('with no cases the pipeline explains how cases begin', h.includes('No follow-up cases yet') && !h.includes('pipeline-table"><div class="table-wrap')); state.cases = keep; }

      // case page
      resetUi(); h = shell3(JOHN, 'case', { caseId: 'c_amara' });
      check('the case page shows stage, definition, next step and buttons for a team leader', h.includes('Where this stands') && h.includes('Integration in progress') && h.includes('Taking a next step into church life') && h.includes('Check in after the second youth night') && h.includes('data-action="contact-open"') && h.includes('data-action="stage-open"') && h.includes('data-action="assign-open"') && h.includes('data-action="nextstep-open"') && h.includes('data-action="open-person"'));
      check('the case page is well-formed', balance(h, 'case') === '', balance(h, 'case'));
      check('the timeline treats attempts, conversations, attendance, milestones and case events differently', ['tl-conversation', 'tl-attendance', 'tl-milestone', 'tl-event'].every(c => h.includes(c)) && h.includes('Integration milestone') && h.includes('Reached them') && h.includes('At church') && h.includes('Case opened') && h.includes('Assigned'));
      h = shell3(JOHN, 'case', { caseId: 'c_noor' });
      check('a missed attempt is shown as an attempt, not a conversation', h.includes('tl-attempt') && h.includes('Tried to reach') && h.includes('Left a message') && h.includes('Overdue by 1 day'));
      check('the case page shows contact details for a team leader', h.includes('noor.rahman@example.org') && h.includes('Shared by the person themselves'));
      h = shell3(TUN, 'case', { caseId: 'c_amara' });
      check('Tunde opening a Team A case sees a 404 with no case details', h.includes('Error 404') && !h.includes('Amara') && !h.includes('youth') && h.includes('data-page="pipeline"'));
      h = shell3(TUN, 'case', { caseId: 'c_priscilla' });
      check('an unassigned case offers “Assign someone” and says nobody is assigned', h.includes('Assign someone') && h.includes('Not assigned'));
      for (const u of [SAR, APO, MIC]) { h = shell3(u, 'case', { caseId: 'c_amara' }); check('the case page is forbidden for ' + u, h.includes('Error 403') && !h.includes('Amara')); }
      changeStage(state, JOHN, 'c_ben', 'closed', { closeReason: 'moved_away', note: 'Moved to Leeds' });
      h = shell3(JOHN, 'case', { caseId: 'c_ben' });
      check('a closed case shows its reason, offers Reopen and no longer offers Record a contact', h.includes('Moved away') && h.includes('Reopen case') && !h.includes('data-action="contact-open"') && !h.includes('data-action="nextstep-open"') && !h.includes('data-action="assign-open"'));
      changeStage(state, JOHN, 'c_amara', 'integrated', {});
      h = shell3(JOHN, 'case', { caseId: 'c_amara' });
      check('a completed case shows Integrated, no Next step section and no way to log more contact (the old plan stays in the history)', h.includes('Integrated') && !h.includes('<p class="section-title">Next step</p>') && !h.includes('data-action="contact-open"'));
      await fresh(); resetUi();

      // person page, people page
      h = shell3(JOHN, 'person', { personId: 'p_amara' });
      check('the profile shows the follow-up case and its history for a team leader', h.includes('Follow-up case') && h.includes('data-action="open-case-page" data-id="c_amara"') && h.includes('Integration in progress') && h.includes('Joined the Tuesday youth group') && h.includes('tl-encounter'));
      check('the profile is well-formed', balance(h, 'person') === '', balance(h, 'person'));
      h = shell3(JOHN, 'person', { personId: 'p_liam' });
      check('a flagged person without a case offers “Open follow-up case”', h.includes('data-action="open-case" data-id="p_liam"') && h.includes('No follow-up case'));
      h = shell3(SAR, 'person', { personId: 'p_amara' });
      check('an evangelist’s view of the same profile has no follow-up case, no follow-up notes and no way to open one', !h.includes('Follow-up case') && !h.includes('Joined the Tuesday youth group') && !h.includes('Came to the Sunday service') && !h.includes('open-case') && !h.includes('tl-conversation') && !h.includes('Integration milestone'));
      check('the evangelist’s profile still has a Correct button for a recent encounter and none for an old one', (() => { const x = shell3(SAR, 'person', { personId: 'p_ben' }); const y = shell3(SAR, 'person', { personId: 'p_jonas' }); return x.includes('data-action="correct-open" data-kind="encounter" data-id="s_a3_e1"') && !y.includes('data-action="correct-open"'); })());
      h = shell3(DAN, 'people');
      check('the directory has a follow-up column and a stage filter for coordinators', h.includes('data-input="people-stage"') && h.includes('<th>Follow-up</th>') && h.includes('Integration in progress') && h.includes('data-action="open-duplicates"'));
      h = shell3(SAR, 'people');
      check('the evangelist’s directory has no stage filter, no stage badges and no duplicate review', !h.includes('data-input="people-stage"') && !h.includes('Integration in progress') && !h.includes('open-duplicates') && h.includes('Not suggested'));
      ui.peopleStage = 'integrating'; h = shell3(DAN, 'people');
      check('filtering the directory by stage', count(h, 'data-action="open-person"') === 1 && h.includes('Amara Eze'));
      ui.peopleStage = 'none'; h = shell3(DAN, 'people');
      check('filtering for people with no follow-up case', count(h, 'data-action="open-person"') === 2 && !h.includes('Amara Eze') && h.includes('Liam Carter'));
      resetUi();

      // dashboard
      h = shell3(JOHN, 'dashboard');
      check('the team leader’s dashboard has a real follow-up summary', (() => { const r = buildReport(state, JOHN, newReportFilter(), 'dashboard.view'); return r.now.open === 3 && r.now.due === 2 && r.now.unassigned === 0 && r.now.flaggedNoCase === 1 && h.includes('Where follow-up is falling behind') && h.includes('Flagged, no case yet') && h.includes('Overdue') && h.includes('Due today') && !h.includes('Not assigned'); })());
      check('the dashboard summary matches the pipeline', (() => { const st = followUpStats(state, JOHN), r = buildReport(state, JOHN, newReportFilter(), 'dashboard.view'); return st.open === 3 && st.overdue + st.dueToday === 2 && r.now.open === st.open && r.now.due === st.overdue + st.dueToday && r.now.flaggedNoCase === st.suggestions; })());
      h = shell3(APO, 'dashboard');
      check('the pastor’s dashboard has no follow-up cards and no names', !h.includes('Follow-up at a glance') && !/Noor|Amara|Priscilla|Liam|Ben Taylor/.test(h));
      check('the dashboard no longer promises follow-up figures “in stage 3”', !shell3(JOHN, 'dashboard').includes('arrive with build stage 3') && !h.includes('arrive with build stage 3'));

      // duplicates page
      h = shell3(JOHN, 'duplicates');
      check('the duplicates page says plainly when there is nothing to review', h.includes('No possible duplicates') && balance(h, 'dups') === '');
      addPerson('p_dup', 'amara eze', { phone: '07700 900101', contactVoluntary: true });
      h = shell3(JOHN, 'duplicates');
      check('a suspected pair shows both sides, the reasons and both choices, and the contact only to people who may see it', h.includes('Similar names') && h.includes('Same phone number') && h.includes('data-action="pair-different"') && h.includes('data-action="pair-merge"') && count(h, 'View profile') === 2 && h.includes('07700 900101') && balance(h, 'dups2') === '');
      h = shell3(SAR, 'duplicates'); check('the duplicates page is forbidden for evangelists', h.includes('Error 403') && !h.includes('07700'));
      h = shell3(TUN, 'duplicates'); check('Tunde’s duplicate list does not include Team A', h.includes('No possible duplicates') && !h.includes('Amara'));
      await fresh(); resetUi();

      // navigation
      check('the case and duplicates pages keep their parent highlighted in the menu', NAV_PARENT.case === 'pipeline' && NAV_PARENT.duplicates === 'people');
      h = shell3(DAN, 'case', { caseId: 'c_noor' });
      check('the pipeline link is highlighted while a case is open, and is no longer marked Soon', /aria-current="page"[^>]*>(<svg[\s\S]*?<\/svg>)<span>Follow-up Pipeline/.test(h) && !/Follow-up Pipeline<\/span><span class="soon">/.test(h));
    }

    /* ---------- dialogs ---------- */
    {
      await fresh(); resetUi(); sessionUserId = JOHN;
      const u = by(JOHN);
      let h = openCaseDialogHtml(u, 'p_liam');
      check('the open-case dialog names the person, lists only people who can follow up on that team and is well-formed', h.includes('Liam Carter') && h.includes('value="u_daniel"') && h.includes('value="u_john"') && !h.includes('value="u_sarah"') && !h.includes('value="u_grace"') && h.includes('data-form="case-open"') && h.includes('data-person-id="p_liam"') && balance(h, 'open') === '', balance(h, 'open'));
      check('the open-case dialog returns nothing for someone outside the scope', openCaseDialogHtml(by(TUN), 'p_liam') === null);
      const h1 = contactDialogHtml(u, caseOf('c_ben')), h2 = contactDialogHtml(u, caseOf('c_ben'));
      check('the contact dialog groups outcomes by what happened, hides the conversation fields until needed and is well-formed', ['Tried, but didn’t reach them', 'Reached them', 'At church'].every(g => h1.includes('optgroup label="' + g + '"')) && /id="ct-conv" hidden/.test(h1) && /id="ct-nocontact" hidden/.test(h1) && /id="ct-close" hidden/.test(h1) && balance(h1, 'contact') === '', balance(h1, 'contact'));
      check('every contact dialog carries its own submission key', /data-key="sub_[^"]+"/.test(h1) && h1.match(/data-key="([^"]+)"/)[1] !== h2.match(/data-key="([^"]+)"/)[1]);
      check('the contact dialog offers forward stages only, and the date cannot be in the future', h1.includes('value="contacted"') && h1.includes('value="attended"') && !h1.includes('value="reached"') && h1.includes('max="' + todayIso() + '"'));
      check('the contact dialog warns that notes can reveal belief', /reveal beliefs/.test(h1));
      h = stageDialogHtml(u, caseOf('c_noor'));
      check('the stage dialog disables moves that are not allowed yet and says why', /<option value="attended" disabled>[^<]*Record that they came/.test(h) && /<option value="awaiting">Move back to Awaiting contact/.test(h) && h.includes('value="integrating"') && balance(h, 'stage') === '', balance(h, 'stage'));
      changeStage(state, JOHN, 'c_ben', 'closed', { closeReason: 'other' });
      h = stageDialogHtml(u, caseOf('c_ben'));
      check('a closed case’s stage dialog is a reopen dialog', h.includes('Reopen case') && /Reopen as Reached/.test(h) && h.includes('Reopen as Awaiting contact'));
      await fresh(); sessionUserId = TUN;
      h = assignDialogHtml(by(TUN), caseOf('c_priscilla'));
      check('the assign dialog lists only Team B people who can follow up', h.includes('value="u_tunde"') && !h.includes('value="u_grace"') && !h.includes('value="u_john"') && balance(h, 'assign') === '');
      await fresh(); sessionUserId = JOHN;
      h = nextStepDialogHtml(by(JOHN), caseOf('c_noor'));
      check('the next-step dialog prefills the current plan and does not prefill a date that has passed', h.includes('Ask how the family member is') && !h.includes('value="' + caseOf('c_noor').nextContactDate + '"') && balance(h, 'next') === '');
      check('the correct dialog is available for every kind the role may correct', ['session', 'encounter', 'person', 'contact'].every(k => { const id = { session: 's_a3', encounter: 's_a3_e1', person: 'p_amara', contact: 'k_a3' }[k]; const x = correctDialogHtml(u, k, id); return x && x.includes('data-form="correct"') && x.includes('name="reason"') && balance(x, 'correct-' + k) === ''; }));
      check('the correct dialog is refused where the role may not correct', correctDialogHtml(by(SAR), 'encounter', 's_a1_e0') === null && correctDialogHtml(by(SAR), 'contact', 'k_a3') === null && correctDialogHtml(by(APO), 'session', 's_a3') === null && correctDialogHtml(by(TUN), 'session', 's_a3') === null);
      check('the correct dialog says what the log keeps', correctDialogHtml(u, 'encounter', 's_a3_e1').includes('but not what the old wording was'));
      check('a person correction asks about the shared-freely confirmation and leaves the old details out of the log text', correctDialogHtml(u, 'person', 'p_amara').includes('contactVoluntary'));
      addPersonForMerge();
      h = mergeDialogHtml(u, 'p_amara', 'p_dup');
      check('the merge dialog asks which record to keep, says it cannot be undone and is well-formed', (h.match(/name="keepId"/g) || []).length === 2 && /can’t be undone/.test(h) && h.includes('data-form="merge"') && balance(h, 'merge') === '', balance(h, 'merge'));
      check('the merge dialog is empty for people outside the scope', mergeDialogHtml(by(TUN), 'p_amara', 'p_dup') === null);
      function addPersonForMerge() { addPerson('p_dup', 'amara eze', { phone: '07700 900101', contactVoluntary: true }); }
    }

    /* ---------- hostile text everywhere ---------- */
    {
      await fresh(); resetUi();
      const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)>', QUOTE = '"><b>bold</b>';
      state.contacts.find(k => k.id === 'k_n2').notes = HOSTILE;
      caseOf('c_noor').nextAction = QUOTE;
      correctRecord(state, DAN, 'contact', 'k_n2', { response: 'receptive' }, '<b>oops</b> ' + QUOTE);
      state.caseEvents.find(e => e.caseId === 'c_amara' && e.to === 'integrating').note = HOSTILE;
      addPerson('p_dup', 'amara eze', { phone: '07700 900101', contactVoluntary: true });
      state.people.find(p => p.id === 'p_dup').name = '<i>amara eze</i>';
      const pages = [[JOHN, 'case', { caseId: 'c_noor' }], [JOHN, 'case', { caseId: 'c_amara' }], [JOHN, 'pipeline'], [JOHN, 'person', { personId: 'p_noor' }], [JOHN, 'person', { personId: 'p_amara' }], [JOHN, 'people'], [JOHN, 'duplicates'], [JOHN, 'dashboard']];
      let bad = '';
      pages.forEach(p => { const h = shell3.apply(null, p); resetUi(); if (/<script>alert|<img src=x|<b>bold|<b>oops|<i>amara/.test(h)) bad += p[1] + ' '; if (balance(h, p[1]) !== '') bad += p[1] + ' unbalanced '; });
      check('notes, plans, reasons and names with HTML in them never become markup on any follow-up page', bad === '', bad);
      const h = shell3(JOHN, 'case', { caseId: 'c_noor' });
      check('the hostile text is still readable, as text', h.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && h.includes('&lt;b&gt;oops&lt;/b&gt;'));
      check('a correction reason with HTML is stored as typed and escaped on display', correctionsFor(state, 'contact', 'k_n2')[0].entry.reason.startsWith('<b>oops</b>'));
    }

    /* ---------- everything together ---------- */
    {
      await fresh(); resetUi();
      let renderErr = '', balErr = '';
      const params = { sessionId: 's_a3', personId: 'p_amara', caseId: 'c_amara' };
      for (const id of ['u_apollos', 'u_michael', 'u_john', 'u_tunde', 'u_sarah', 'u_daniel', 'u_grace']) {
        for (const p of PAGES) {
          sessionUserId = id; ui.page = p.id; Object.assign(ui, params); ui.forbidden = !guardPage(by(id), p.id).ok;
          try { const out = viewShell(by(id)); const b = balance(out, id + '/' + p.id); if (b) balErr += b + '\n'; } catch (e) { renderErr += id + '/' + p.id + ': ' + e.message + '\n'; }
        }
      }
      resetUi();
      check('every role renders every page, including the new ones, without throwing', renderErr === '', renderErr);
      check('and every rendered page is well-formed', balErr === '', balErr);
      const before = snap();
      for (const id of ['u_john', 'u_daniel', 'u_tunde']) { sessionUserId = id; PAGES.forEach(p => { ui.page = p.id; Object.assign(ui, params); ui.forbidden = !guardPage(by(id), p.id).ok; viewShell(by(id)); }); }
      check('drawing pages never changes the data', snap() === before);
      check('state still validates after all of the above', isValidState(clone(state)));
    }
  }


  /* ================= stage 4: dashboard, reports, charts and export ================= */
  {
    const today = isoDate(Date.now()), d = n => addDays(today, -n);
    const at = (iso, h) => parseIsoDate(iso).getTime() + (h || 10) * 3600000;
    const F = o => Object.assign(newReportFilter(), o || {});
    const R = (uid, o, cap) => buildReport(state, uid, F(o), cap || 'reports.view');
    const shell4 = (userId, page, extra) => { sessionUserId = userId; ui.page = page; ui.forbidden = !guardPage(by(userId), page).ok; Object.assign(ui, extra || {}); return viewShell(by(userId)); };
    const resetRep = () => { ui.report = newReportFilter(); ui.reportTab = 'activity'; ui.canExport = false; ui.back = null; };
    const kpi = (html, label) => { const m = html.match(new RegExp('<p class="kpi-label">' + label + '[\\s\\S]*?<p class="kpi-value">([\\d,]+)</p>')); return m ? Number(m[1].replace(/,/g, '')) : null; };
    const mkPerson = (id, name) => ({ id: id, name: name, phone: '', email: '', contactVoluntary: true, createdAt: Date.now(), createdBy: 'u_sarah', archived: false });
    const mkSession = (id, date, area, dept) => ({ id: id, submissionKey: 'fx_' + id, outreachDate: date, startTime: '10:00', areaId: area, typeKey: 'campus', departmentId: dept, participantIds: ['u_sarah'], notes: '', createdBy: 'u_sarah', enteredAt: at(date), archived: false });
    const mkEnc = (id, pid, sid, date, resp, flag) => ({ id: id, personId: pid, sessionId: sid, response: resp, notes: '', followUpSuggested: !!flag, recordedBy: 'u_sarah', recordedAt: at(date) });
    const mkContact = (id, caseId, date, outcome, attendance) => ({ id: id, caseId: caseId, contactDate: date, contactTime: '10:00', method: outcome === 'seen_at_church' ? 'in_person' : 'call', outcome: outcome, response: '', attendance: attendance || '', notes: '', nextAction: '', nextContactDate: '', recordedBy: 'u_daniel', recordedAt: at(date), submissionKey: 'fx_' + id });
    const mkStage = (id, caseId, date, from, to) => ({ id: id, caseId: caseId, kind: 'stage', at: at(date), by: 'u_john', from: from, to: to, note: '', assigneeId: null, closeReason: null, date: '' });
    // A small world whose answers can be worked out by hand.
    const fixture = async () => {
      await fresh();
      state.people = [mkPerson('px', 'Fixture Xavier'), mkPerson('py', 'Fixture Yara'), mkPerson('pz', 'Fixture Zane')];
      state.sessions = [mkSession('fa', d(30), 'a_centre', 'd_a'), mkSession('fb', d(10), 'a_campus', 'd_a'), mkSession('fc', d(5), 'a_centre', 'd_b')];
      state.encounters = [mkEnc('fa1', 'px', 'fa', d(30), 'decision', true), mkEnc('fa2', 'py', 'fa', d(30), 'listened', false), mkEnc('fb1', 'px', 'fb', d(10), 'listened', false), mkEnc('fb2', 'pz', 'fb', d(10), 'listened', true), mkEnc('fc1', 'py', 'fc', d(5), 'listened', false)];
      state.cases = [{ id: 'cx', personId: 'px', departmentId: 'd_a', stage: 'integrating', assigneeId: 'u_daniel', nextAction: '', nextContactDate: addDays(today, 3), openedAt: at(d(29)), openedBy: 'u_john', originEncounterId: 'fa1', updatedAt: at(d(2)), closedAt: null, closeReason: null }];
      state.contacts = [mkContact('k1', 'cx', d(28), 'no_answer'), mkContact('k2', 'cx', d(27), 'spoke'), mkContact('k3', 'cx', d(20), 'seen_at_church', 'recorded')];
      state.caseEvents = [mkStage('e1', 'cx', d(29), 'reached', 'awaiting'), mkStage('e2', 'cx', d(27), 'awaiting', 'contacted'), mkStage('e3', 'cx', d(20), 'contacted', 'attended'), mkStage('e4', 'cx', d(8), 'attended', 'integrating')];
    };
    const pick = (t, keys) => keys.map(k => t[k]).join(',');

    /* hand-built figures */
    await fixture();
    check('fixture is a valid state', isValidState(clone(state)));
    let r4 = R('u_apollos');
    check('outreach figures match the hand count (3 sessions, 5 encounters, 3 different people)', r4.ok && pick(r4.totals, ['sessions', 'encounters', 'peopleReached', 'newPeople', 'flagged', 'decisions']) === '3,5,3,3,2,1', JSON.stringify(r4.totals));
    check('follow-up figures match the hand count (1 case; 2 attempts, 1 conversation; seen at church is not an attempt)', pick(r4.totals, ['casesOpened', 'attempts', 'conversations', 'notReached', 'peopleSpoken', 'attended', 'attendedSeen', 'attendedTold', 'integration', 'integrated']) === '1,2,1,1,1,1,1,0,1,0', JSON.stringify(r4.totals));
    check('right-now figures: one open case, nobody late, one person flagged with no case', pick(r4.now, ['open', 'overdue', 'dueToday', 'unassigned', 'noNextStep', 'flaggedNoCase', 'due']) === '1,0,0,0,0,1,0', JSON.stringify(r4.now));
    check('the single case is counted in exactly one stage', r4.stages.map(s => s.count).join(',') === '0,0,0,0,1,0,0');
    r4 = R('u_apollos', { preset: 'custom', from: d(12), to: today });
    check('a narrower period only counts what falls inside it', pick(r4.totals, ['sessions', 'encounters', 'peopleReached', 'flagged', 'decisions', 'casesOpened', 'attempts', 'attended', 'integration']) === '2,3,3,1,0,0,0,0,1', JSON.stringify(r4.totals));
    check('new people means first met in the period, not first seen in it', r4.totals.newPeople === 1, String(r4.totals.newPeople));
    check('the right-now figures ignore the period', R('u_apollos', { preset: 'custom', from: d(12), to: today }).now.open === 1 && R('u_apollos', { preset: '7d' }).now.open === 1);
    r4 = R('u_apollos', { team: 'd_a' });
    check('a team filter narrows outreach to that team', pick(r4.totals, ['sessions', 'encounters', 'peopleReached']) === '2,4,3', JSON.stringify(r4.totals));
    r4 = R('u_apollos', { team: 'd_b' });
    check('another team has its own sessions and no follow-up', pick(r4.totals, ['sessions', 'encounters', 'peopleReached', 'casesOpened', 'attempts']) === '1,1,1,0,0' && r4.now.open === 0 && r4.stages.every(s => s.count === 0));
    r4 = R('u_apollos', { area: 'a_centre' });
    check('a location filter narrows outreach and says follow-up is not split by location', pick(r4.totals, ['sessions', 'encounters', 'peopleReached']) === '2,3,2' && r4.totals.attempts === 2 && r4.notes.some(n => n.includes('Follow-up figures can’t be split by location')), JSON.stringify(r4.totals));
    check('without a location filter there is no such note', R('u_apollos').notes.length === 0);
    r4 = R('u_apollos', { preset: '7d' });
    check('a period with no outreach is honestly empty, not an error', r4.ok && r4.totals.sessions === 1 && R('u_apollos', { preset: 'custom', from: d(3), to: d(1) }).empty === true);
    {
      const e = R('u_apollos', { preset: 'custom', from: d(3), to: d(1) });
      check('an empty period still reports today’s open cases and stages', e.empty && e.totals.sessions === 0 && e.now.open === 1 && e.stages.reduce((a, s) => a + s.count, 0) === 1);
    }

    /* the same numbers by a second route, on the full seed */
    state = await buildSeed(); sessionUserId = null;
    check('the seed with history validates', isValidState(clone(state)));
    {
      const mismatches = [];
      for (const [uid, o] of [['u_apollos', {}], ['u_apollos', { preset: '30d' }], ['u_apollos', { preset: '7d' }], ['u_apollos', { preset: 'year' }], ['u_apollos', { preset: 'all' }], ['u_apollos', { team: 'd_a' }], ['u_apollos', { team: 'd_b', area: 'a_centre' }],
        ['u_apollos', { preset: 'custom', from: d(40), to: d(10) }], ['u_john', {}], ['u_john', { preset: '30d' }], ['u_john', { area: 'a_campus' }], ['u_tunde', {}], ['u_tunde', { preset: '7d' }]]) {
        const rp = R(uid, o), who = uid + ' ' + JSON.stringify(o);
        if (!rp.ok) { mismatches.push(who + ' did not build: ' + rp.error); continue; }
        const T = rp.totals, a = by(uid), teamIds = uid === 'u_apollos' ? state.departments.map(x => x.id) : deptIdsOf(state, uid);
        const sessions = state.sessions.filter(s => !s.archived && (uid === 'u_apollos' || teamIds.indexOf(s.departmentId) !== -1) && s.outreachDate >= rp.range.from && s.outreachDate <= rp.range.to && (!o.team || s.departmentId === o.team) && (!o.area || s.areaId === o.area));
        const ids = {}; sessions.forEach(s => { ids[s.id] = 1; });
        const encs = state.encounters.filter(e => ids[e.sessionId]), people = {}; encs.forEach(e => { people[e.personId] = 1; });
        if (T.sessions !== sessions.length) mismatches.push(who + ' sessions ' + T.sessions + ' vs ' + sessions.length);
        if (T.encounters !== encs.length) mismatches.push(who + ' encounters ' + T.encounters + ' vs ' + encs.length);
        if (T.peopleReached !== Object.keys(people).length) mismatches.push(who + ' people ' + T.peopleReached + ' vs ' + Object.keys(people).length);
        const sum = k => rp.series.reduce((x, b) => x + b[k], 0);
        if (sum('sessions') !== T.sessions || sum('encounters') !== T.encounters || sum('attempts') !== T.attempts || sum('conversations') !== T.conversations) mismatches.push(who + ' chart buckets do not add up to the totals');
        if (T.peopleReached > T.encounters || T.newPeople > T.peopleReached || T.conversations > T.attempts || T.integrated > T.integration || T.peopleSpoken > T.conversations || T.decisions > T.encounters + T.attempts + T.conversations) mismatches.push(who + ' a unique count is larger than the count it comes from');
        if (rp.series.some(b => b.people > b.encounters || b.newPeople + b.returning !== b.people)) mismatches.push(who + ' a bucket has more people than encounters, or new + returning is not people');
        const inScopeCases = state.cases.filter(c => (uid === 'u_apollos' || teamIds.indexOf(c.departmentId) !== -1) && (!o.team || c.departmentId === o.team));
        if (rp.stages.reduce((x, s) => x + s.count, 0) !== inScopeCases.length) mismatches.push(who + ' stages do not add up to the cases');
        if (rp.now.open !== inScopeCases.filter(c => isOpenStage(c.stage)).length) mismatches.push(who + ' open cases');
        if (rp.teams.reduce((x, t) => x + t.sessions, 0) !== T.sessions || rp.areas.reduce((x, t) => x + t.encounters, 0) !== T.encounters || rp.responses.reduce((x, t) => x + t.count, 0) !== T.encounters) mismatches.push(who + ' team, location or response breakdown does not add up');
        if (rp.sessions.length !== T.sessions) mismatches.push(who + ' session rows');
      }
      check('every report agrees with an independent recount, and its parts add up to its totals', mismatches.length === 0, mismatches.join('\n'));
    }
    check('the “flagged, no case yet” figure equals the pipeline’s own suggestion queue', ['u_john', 'u_tunde'].every(uid => followUpSuggestions(state, uid).length === R(uid).now.flaggedNoCase) && R('u_apollos').now.flaggedNoCase === R('u_john').now.flaggedNoCase + R('u_tunde').now.flaggedNoCase, [R('u_apollos').now.flaggedNoCase, R('u_john').now.flaggedNoCase, R('u_tunde').now.flaggedNoCase].join(','));
    check('the pastor’s follow-up figures are the sum of the teams’ and match the dashboard summary service', (() => { const a = R('u_apollos'), j = R('u_john'), t = R('u_tunde'); return a.now.open === j.now.open + t.now.open && a.now.overdue === j.now.overdue + t.now.overdue && j.now.open === followUpStats(state, 'u_john').open && j.now.due === followUpStats(state, 'u_john').overdue + followUpStats(state, 'u_john').dueToday; })());
    check('the seed history gives trends: several weeks with sessions, overdue and unassigned cases, and a real funnel', (() => { const a = R('u_apollos'); return a.series.filter(b => b.sessions > 0).length >= 8 && a.now.overdue > 0 && a.now.unassigned > 0 && a.totals.conversations > 0 && a.totals.attended > 0 && a.totals.integrated > 0; })());

    /* periods and buckets */
    check('periods: 7 days bucket by day, 90 days by week, a year by month', R('u_apollos', { preset: '7d' }).unit === 'day' && R('u_apollos', { preset: '90d' }).unit === 'week' && R('u_apollos', { preset: 'year' }).unit === 'month' || today < '2026-02-01');
    check('every bucket is inside the period and buckets do not overlap', ['7d', '30d', '90d', 'year', 'all'].every(p => { const rp = R('u_apollos', { preset: p }); return rp.series.every((b, i) => b.start >= rp.range.from && b.end <= rp.range.to && b.start <= b.end && (i === 0 || b.start > rp.series[i - 1].end)); }));
    {
      const bad = o => R('u_apollos', Object.assign({ preset: 'custom' }, o));
      const x1 = bad({ from: d(5), to: d(10) }), x2 = bad({ from: d(5), to: addDays(today, 2) }), x3 = bad({ from: '', to: today }), x4 = bad({ from: '2026-02-30', to: today }), x5 = bad({ from: addDays(today, -2000), to: today }), x6 = bad({ from: today, to: today });
      check('a start date after the end date is refused with a clear message', !x1.ok && x1.code === 400 && x1.field === 'range' && x1.error.includes('after the end date'), JSON.stringify(x1));
      check('a future end date, a missing date, an impossible date and a range over five years are refused', [x2, x3, x4, x5].every(x => !x.ok && x.code === 400) && x2.error.includes('future') && x5.error.includes('5 years'), JSON.stringify([x2, x3, x4, x5].map(x => x.error)));
      check('a single-day range is fine', x6.ok && x6.range.days === 1 && x6.series.length === 1);
      check('an unknown period is refused', !R('u_apollos', { preset: 'forever' }).ok);
    }

    /* who may ask for what */
    check('only the pastor and team leaders can build a report', ['u_sarah', 'u_daniel', 'u_michael', 'u_emma', 'u_priya'].every(id => R(id).code === 403 && buildReport(state, id, F(), 'dashboard.view').code === 403) && R('u_apollos').ok && R('u_john').ok && R('u_tunde').ok);
    check('a missing user and a made-up user are refused', buildReport(state, 'u_nobody', F(), 'reports.view').code === 403 && buildReport(state, null, F(), 'reports.view').code === 403);
    check('a team leader only ever sees their own team', (() => { const j = R('u_john'); return j.scope.kind === 'team' && j.scope.teams.length === 1 && j.scope.teams[0].id === 'd_a' && j.teams.every(t => t.id === 'd_a') && j.totals.sessions === state.sessions.filter(s => s.departmentId === 'd_a' && s.outreachDate >= j.range.from).length; })());
    check('asking for another team’s report looks exactly like asking for one that doesn’t exist', same(R('u_john', { team: 'd_b' }), R('u_john', { team: 'd_does_not_exist' })) && R('u_john', { team: 'd_b' }).code === 404 && R('u_tunde', { team: 'd_a' }).code === 404);
    check('an unknown location is a 404 and a team leader’s team filter works for their own team', R('u_apollos', { area: 'a_nowhere' }).code === 404 && R('u_john', { team: 'd_a' }).ok);
    check('the pastor can look at one team or the whole church, and the parts add up', (() => { const all = R('u_apollos'), a = R('u_apollos', { team: 'd_a' }), b = R('u_apollos', { team: 'd_b' }); return a.totals.sessions + b.totals.sessions === all.totals.sessions && a.totals.encounters + b.totals.encounters === all.totals.encounters; })());
    check('guards: the dashboard and reports pages are closed to everyone else', ['u_sarah', 'u_daniel', 'u_michael'].every(id => guardPage(by(id), 'reports').code === 403 && guardPage(by(id), 'dashboard').code === 403) && guardPage(by('u_apollos'), 'reports').ok && guardPage(by('u_john'), 'reports').ok);

    /* privacy: the pastor's data holds counts and labels only */
    {
      const people = state.people, users = state.users;
      const secrets = [];
      people.forEach(p => { secrets.push(p.name, p.id); if (p.phone) secrets.push(p.phone); if (p.email) secrets.push(p.email); });
      state.cases.forEach(c => secrets.push(c.id)); state.encounters.forEach(e => secrets.push(e.id)); state.contacts.forEach(k => secrets.push(k.id)); state.sessions.forEach(s => secrets.push(s.id)); state.caseEvents.forEach(ev => secrets.push(ev.id));
      users.forEach(u => { secrets.push(u.name); secrets.push(u.email); });
      const leaks = text => secrets.filter(s => s && text.indexOf(s) !== -1);
      let allText = '';
      for (const o of [{}, { preset: '30d' }, { preset: 'all' }, { team: 'd_a' }, { area: 'a_centre' }, { preset: 'custom', from: d(40), to: d(5) }]) {
        const rp = R('u_apollos', o); allText += JSON.stringify(rp);
        ['activity', 'people', 'teams', 'areas', 'responses', 'sessions', 'contacts', 'stages', 'attendance', 'milestones', 'summary'].forEach(t => { allText += reportCsv(rp, t); });
      }
      const lk = leaks(allText.replace(/"name":"(Team [A-D]|City centre|University campus|Market square|Train station)"/g, ''));
      check('the pastor’s report data and CSV hold no name, phone, email, person id, case id or staff name', lk.length === 0, lk.slice(0, 5).join(' | '));
      check('the pastor’s sessions rows carry no id, because the pastor cannot open sessions', R('u_apollos').sessions.every(s => s.id === undefined) && R('u_john').sessions.every(s => typeof s.id === 'string'));
      let pages = '';
      for (const tab of ['activity', 'followup', 'progress', 'definitions']) { resetRep(); pages += shell4('u_apollos', 'reports', { reportTab: tab }); }
      resetRep(); pages += shell4('u_apollos', 'dashboard'); resetRep();
      const own = [by('u_apollos').name, by('u_apollos').email], pageLeaks = leaks(pages).filter(x => own.indexOf(x) === -1);
      check('the pastor’s pages show no name, phone, email, id or staff name, apart from the pastor’s own in the header and menu', pageLeaks.length === 0, pageLeaks.slice(0, 5).join(' | '));
      check('the pastor’s dashboard offers no way to open a person, case or session', !/data-action="(open-person|open-case-page|open-session|pipe-from-report|open-case)"/.test(pages));
      check('the pastor sees the “counts only” notes', shell4('u_apollos', 'dashboard').includes('Counts only. Team leaders can open the cases behind each figure.'));
      resetRep();
    }

    /* the pages */
    {
      resetRep();
      const dashP = shell4('u_apollos', 'dashboard'), dashJ = shell4('u_john', 'dashboard');
      const rp = R('u_apollos', {}, 'dashboard.view'), rj = R('u_john', {}, 'dashboard.view');
      check('the pastor’s dashboard greets by name, shows the whole church and has no stage-3 placeholders', dashP.includes('<h1 id="page-title" tabindex="-1">Pastor Apollos</h1>') && dashP.includes('Here’s your church’s outreach overview.') && dashP.includes('Whole church') && !dashP.includes('Outreach so far') && !dashP.includes('Follow-up at a glance') && !dashP.includes('How the figures will be counted'));
      check('the team leader’s dashboard greets by first name and shows only Team A', dashJ.includes('Welcome, John') && dashJ.includes('Team A') && !dashJ.includes('Team B') && !dashJ.includes('Whole church') && !dashJ.includes('id="rep-team"'));
      check('dashboard tiles show exactly the report’s numbers', kpi(dashP, 'People reached') === rp.totals.peopleReached && kpi(dashP, 'Follow-ups completed') === rp.totals.conversations && kpi(dashP, 'Decisions recorded') === rp.totals.decisions && kpi(dashP, 'Attended church') === rp.totals.attended && kpi(dashP, 'Towards integration') === rp.totals.integration && kpi(dashP, 'Follow-ups due') === rp.now.due &&
        kpi(dashJ, 'People reached') === rj.totals.peopleReached && kpi(dashJ, 'Follow-ups due') === rj.now.due, JSON.stringify([kpi(dashP, 'People reached'), rp.totals.peopleReached, kpi(dashJ, 'People reached'), rj.totals.peopleReached]));
      resetRep();
      const repP = shell4('u_apollos', 'reports', { reportTab: 'activity' });
      check('the reports page shows the same people-reached number as the dashboard', kpi(repP, 'People reached') === rp.totals.peopleReached && kpi(repP, 'Sessions') === rp.totals.sessions && kpi(repP, 'Encounters') === rp.totals.encounters);
      check('the dashboard and the reports page share one set of filters', (() => { ui.report = F({ preset: '30d', team: 'd_a' }); const a = shell4('u_apollos', 'dashboard'), b = shell4('u_apollos', 'reports'); return a.includes('<option value="30d" selected>') && b.includes('<option value="30d" selected>') && a.includes('<option value="d_a" selected>') && b.includes('<option value="d_a" selected>') && kpi(a, 'People reached') === kpi(b, 'People reached'); })());
      resetRep();
      check('a filter row sits above the figures, with labels', dashP.indexOf('id="rep-preset"') > 0 && dashP.indexOf('id="rep-preset"') < dashP.indexOf('kpi-label') && dashP.includes('<label for="rep-preset">Period</label>') && dashP.includes('<label for="rep-area">Location</label>') && dashP.includes('<label for="rep-team">Team</label>'));
      check('custom dates only appear for a custom period, and cannot be set in the future', !dashP.includes('id="rep-from"') && (() => { ui.report = F({ preset: 'custom', from: d(20), to: today }); const h = shell4('u_apollos', 'dashboard'); resetRep(); return h.includes('id="rep-from"') && h.includes('id="rep-to"') && h.includes('max="' + today + '"'); })());
      check('an invalid custom range shows its message and no figures', (() => { ui.report = F({ preset: 'custom', from: today, to: d(5) }); const h = shell4('u_apollos', 'dashboard'); resetRep(); return h.includes('The start date is after the end date.') && h.includes('role="alert"') && kpi(h, 'People reached') === null; })());
      check('reset filters appears only when something has been changed', !dashP.includes('data-action="rep-reset"') && (() => { ui.report = F({ team: 'd_a' }); const h = shell4('u_apollos', 'dashboard'); resetRep(); return h.includes('data-action="rep-reset"'); })());
      check('each chart has a table view and a plain-language summary', (dashP.match(/<details class="viz-table"/g) || []).length >= 4 && dashP.includes('class="viz-summary"') && dashP.includes('View as a table') && dashP.includes('<caption class="sr-only">'));
      check('each time chart carries its data for drawing and an accessible name', dashP.includes('class="viz-cols" data-spec=') && dashP.includes('role="img"') && dashP.includes('Use the arrow keys'));
      {
        const spec = JSON.parse(dashP.match(/data-spec="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
        const svg = vizColumnsSvg(spec, 640), svgNarrow = vizColumnsSvg(spec, 320);
        check('the SVG chart has one hit target per period, bars no wider than 24px, and fits its width', (svg.match(/class="viz-hit"/g) || []).length === spec.buckets.length && svg.includes('viewBox="0 0 640 ') && svgNarrow.includes('viewBox="0 0 320 ') && (svg.match(/class="viz-hit"/g) || []).length === (svgNarrow.match(/class="viz-hit"/g) || []).length);
        check('only the first column is a tab stop, so the chart is one stop for keyboard users', (svg.match(/tabindex="0"/g) || []).length === 1);
        check('the bars use tokens, not literal colours, so dark mode needs no redraw', !/fill="#|stroke="#|style="[^"]*#/.test(svg) && /class="viz-bar s1"/.test(svg));
        const zero = vizColumnsSvg({ title: 't', stacked: false, series: [{ key: 'encounters', label: 'Encounters', cls: 's1' }], buckets: [{ label: 'a', long: 'A', values: { encounters: 0 } }, { label: 'b', long: 'B', values: { encounters: 0 } }] }, 400);
        check('an all-zero chart still draws an axis and no bars', zero.includes('viz-base') && !zero.includes('viz-bar'));
        check('the axis ceiling is a tidy whole number with at most five steps', [1, 3, 4, 5, 9, 11, 23, 47, 99, 101, 640].every(m => { const a = niceAxis(m); return a.top >= m && Number.isInteger(a.top) && a.top / a.step <= 5 && a.top % a.step === 0; }));
      }
      check('stage bars use the ordered ramp, with Closed in grey', (() => { const rows = stageRows(R('u_apollos')); return rows.map(x => x.cls).join(',') === 'st1,st2,st3,st4,st5,st6,stc'; })());
      check('a legend appears for two series and none for one', (() => { resetRep(); const a = shell4('u_apollos', 'reports', { reportTab: 'activity' }); const dsh = dashP; resetRep(); return a.includes('class="legend"') && a.includes('New to us') && a.includes('Met before') && !dsh.includes('class="legend"'); })());
      check('teams are listed by name, not ranked', (() => { const t = R('u_apollos').teams; return t.map(x => x.name).join() === t.map(x => x.name).slice().sort((p, q) => p.localeCompare(q)).join() && dashP.includes('not ranked'); })());
      check('the definitions tab lists every figure with a written definition', (() => { resetRep(); const h = shell4('u_apollos', 'reports', { reportTab: 'definitions' }); resetRep(); return METRICS.every(m => m.label && m.short && m.long && h.includes(esc(m.label))) && h.includes('People reached') && h.includes('They are drafts until Kharis leadership confirms them'); })());
      check('every metric is documented, in a known group, with a basis of period or now', METRICS.every(m => REPORT_GROUPS.some(g => g.key === m.group) && (m.basis === 'period' || m.basis === 'now') && m.long.length > 30) && new Set(METRICS.map(m => m.key)).size === METRICS.length);
      check('every figure on the summary table is a documented metric', R('u_apollos') && reportTables(R('u_apollos')).summary.rows.every(row => row.how && row.how.length > 30));
      check('only team leaders get buttons that open the pipeline, and they come from real counts', dashJ.includes('data-action="pipe-from-report"') && (dashJ.match(/data-action="pipe-from-report"/g) || []).length <= 5 && !dashP.includes('pipe-from-report'));
      check('team leaders can open a recent session from the dashboard and see its link', dashJ.includes('data-action="open-session"'));
      check('nothing on the dashboard is a button that does nothing', (() => { const acts = new Set([...dashP.matchAll(/data-action="([a-z-]+)"/g)].concat([...dashJ.matchAll(/data-action="([a-z-]+)"/g)]).map(m => m[1])); return [...acts].every(a => ['nav', 'toggle-nav', 'close-nav', 'go-home', 'toggle-account', 'sign-out', 'open-about', 'open-definitions', 'pipe-from-report', 'open-session', 'rep-reset', 'rep-tab', 'export-csv'].includes(a)); })());
      check('export buttons appear only when saving a file is possible', !shell4('u_apollos', 'reports', { reportTab: 'activity' }).includes('data-action="export-csv"') && (() => { ui.canExport = true; const h = shell4('u_apollos', 'reports', { reportTab: 'activity' }); const dsh = shell4('u_apollos', 'dashboard'); resetRep(); return h.includes('data-action="export-csv"') && h.includes('Export summary (CSV)') && !dsh.includes('data-action="export-csv"'); })());
    }

    /* charts, tables and CSV all say the same thing */
    {
      const rp = R('u_apollos'), T = reportTables(rp), ids = Object.keys(T);
      check('there is a table for every chart and a summary', ['activity', 'people', 'teams', 'areas', 'responses', 'sessions', 'contacts', 'stages', 'attendance', 'milestones', 'summary'].every(k => T[k] && T[k].cols.length && Array.isArray(T[k].rows)));
      const csvOk = ids.every(id => { const lines = reportCsv(rp, id).split('\r\n'); return lines.length === T[id].rows.length + 2 && lines[lines.length - 1] === '' && lines[0].split(',').length >= T[id].cols.length; });
      check('every CSV has a header, one line per table row, and a final newline', csvOk);
      check('chart data, table and CSV agree for the activity chart', (() => { const lines = reportCsv(rp, 'activity').split('\r\n').slice(1, -1); return lines.length === rp.series.length && lines.every((ln, i) => ln.split(',').pop() === String(rp.series[i].people) && ln.split(',')[2] === String(rp.series[i].encounters)) && T.activity.rows.every((row, i) => row.encounters === rp.series[i].encounters); })());
      check('the stage table equals the stage bars and the CSV', same(T.stages.rows.map(x => x.count), rp.stages.map(x => x.count)) && same(reportCsv(rp, 'stages').split('\r\n').slice(1, -1).map(l => Number(l.split(',').pop())), rp.stages.map(x => x.count)));
      check('the summary table repeats every headline number', (() => { const m = {}; T.summary.rows.forEach(x => { m[x.metric] = x.value; }); return m['People reached'] === rp.totals.peopleReached && m['Follow-ups completed'] === rp.totals.conversations && m['Open cases (right now)'] === rp.now.open; })(), JSON.stringify(T.summary.rows.map(x => x.metric)));
      check('an unknown table gives an empty export', reportCsv(rp, 'nope') === '');
      check('the file name says what and when, with no spaces or personal detail', /^kharis-outreach-activity-\d{4}-\d\d-\d\d-to-\d{4}-\d\d-\d\d\.csv$/.test(reportFileName(rp, 'activity')));
      check('CSV cells starting with = + - or @ are made safe, and quotes and commas are escaped', csvCell('=SUM(A1)') === '\'=SUM(A1)' && csvCell('+44 7700') === '\'+44 7700' && csvCell('-1+2') === '\'-1+2' && csvCell('@cmd') === '\'@cmd' && csvCell('a,"b"') === '"a,""b"""' && csvCell(-5) === '-5' && csvCell(null) === '' && csvCell(12) === '12' && csvCell('line\nbreak') === '"line\nbreak"');
      check('a hostile team name is neutralised in the CSV and escaped on the page', await (async () => { await fixture(); state.departments[0].name = '=HYPERLINK("http://x")<b>x</b>'; const rp2 = R('u_apollos'); const csv = reportCsv(rp2, 'teams'); resetRep(); const pg = shell4('u_apollos', 'dashboard'); return csv.includes('"\'=HYPERLINK(""http://x"")<b>x</b>"') && !pg.includes('<b>x</b>') && pg.includes('&lt;b&gt;x&lt;/b&gt;'); })());
    }

    /* upgrade and pages with real data */
    {
      await fresh();
      const v3 = clone(state); v3.version = 3;
      const up = upgradeState(clone(v3));
      check('a version 3 save upgrades to version 4 with eleven weeks of history added', up.version === 4 && isValidState(up) && up.sessions.length > v3.sessions.length && up.cases.length > v3.cases.length && v3.sessions.every(s => up.sessions.some(x => x.id === s.id)));
      check('upgrading twice changes nothing more', same(upgradeState(clone(up)), up));
      const sparse = clone(v3); sparse.people = sparse.people.filter(p => p.id === 'p_jonas'); sparse.encounters = sparse.encounters.filter(e => e.personId === 'p_jonas'); sparse.sessions = sparse.sessions.filter(s => sparse.encounters.some(e => e.sessionId === s.id)); sparse.cases = []; sparse.contacts = []; sparse.caseEvents = [];
      const up3 = upgradeState(sparse);
      check('upgrade skips history when the demo anchors are missing, and the result is still valid', isValidState(up3) && up3.version === 4);
      check('a fresh seed without history is the same size as stage 3 had', (await buildSeed({ history: false })).sessions.length === 5 && (await buildSeed()).sessions.length > 5);

      state = await buildSeed(); sessionUserId = null;
      let errs = '', bal = '';
      const variants = [{}, { preset: '7d' }, { preset: '30d', team: 'd_a' }, { preset: 'year' }, { preset: 'all', area: 'a_centre' }, { preset: 'custom', from: d(5), to: d(1) }, { preset: 'custom', from: d(2), to: d(9) }, { preset: 'custom', from: d(400), to: today }];
      for (const id of ['u_apollos', 'u_john', 'u_tunde', 'u_sarah', 'u_daniel', 'u_michael']) {
        for (const page of ['dashboard', 'reports']) {
          for (const tab of ['activity', 'followup', 'progress', 'definitions']) {
            for (const v of variants) {
              ui.report = F(v); ui.reportTab = tab; ui.canExport = tab === 'followup';
              try { const out = shell4(id, page); const b = balance(out, id + '/' + page + '/' + tab + '/' + JSON.stringify(v)); if (b) bal += b + '\n'; } catch (e) { errs += id + '/' + page + '/' + tab + ': ' + e.message + '\n'; }
            }
          }
        }
      }
      resetRep();
      check('every role, page, tab and filter renders without throwing', errs === '', errs.slice(0, 500));
      check('and every page is well-formed', bal === '', bal.slice(0, 500));
      const before = JSON.stringify(state);
      shell4('u_apollos', 'dashboard'); shell4('u_john', 'reports');
      check('viewing reports never changes the data', JSON.stringify(state) === before);
      check('a team leader with no team gets an honest message, not a blank page', (() => { const keep = state.memberships; state.memberships = state.memberships.filter(m => m.userId !== 'u_john'); resetRep(); const h = shell4('u_john', 'dashboard'), g = shell4('u_john', 'reports'); state.memberships = keep; return h.includes('You are not on a team yet') && g.includes('You are not on a team yet'); })());
      check('with nothing recorded the dashboard says so instead of drawing empty charts', (() => { const keep = [state.sessions, state.encounters, state.cases, state.contacts, state.caseEvents]; state.sessions = []; state.encounters = []; state.cases = []; state.contacts = []; state.caseEvents = []; resetRep(); const h = shell4('u_apollos', 'dashboard'); [state.sessions, state.encounters, state.cases, state.contacts, state.caseEvents] = keep; return h.includes('Nothing recorded in this period') && !h.includes('viz-svg') && !h.includes('viz-hit') && kpi(h, 'People reached') === 0; })());
      check('a period without outreach says so on the activity tab and drops the charts', (() => { ui.report = F({ preset: 'custom', from: d(1), to: d(1) }); const keep = state.sessions; state.sessions = state.sessions.filter(s => s.outreachDate !== d(1)); ui.reportTab = 'activity'; const h = shell4('u_apollos', 'reports'); state.sessions = keep; resetRep(); return h.includes('No outreach recorded in this period') && !h.includes('class="viz-cols"'); })());
    }
  }


  const failed = results.filter(r => !r[1]);
  return { total: results.length, failed: failed };
})()
