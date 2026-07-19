// ══════════════════════════════════════════════════
// SAVED ACCOUNTS / QUICK SWITCH — native app only (Capacitor Android).
// Stores a small list of previously logged-in accounts' Supabase refresh
// tokens in @capacitor/preferences (native Android SharedPreferences), so
// the user can switch between them without re-entering a password.
//
// NOTE: Preferences is backed by plain (non-encrypted) Android
// SharedPreferences — this is NOT secure/encrypted storage. Acceptable here
// because this is a personal, lock-screen-protected phone, but call it out
// explicitly so it isn't later mistaken for Keystore-backed encrypted storage.
//
// This is a separate, explicit, multi-slot address book the user opts into
// per-account (Save / Not now) — it does not replace or duplicate the
// Supabase JS client's own automatic, single-slot localStorage session
// persistence (see supabase-client.js), which continues to track whichever
// session is currently active.
// ══════════════════════════════════════════════════
import { sb } from './supabase-client.js';
import { state } from './state.js';
import { esc } from './ui-helpers.js';

const STORAGE_KEY = 'basebi.savedAccounts';

function isNative(){ return !!window.Capacitor?.isNativePlatform?.(); }
function prefs(){ return window.Capacitor?.Plugins?.Preferences; }

async function getSavedAccounts(){
  if(!isNative()) return [];
  const p = prefs(); if(!p) return [];
  const { value } = await p.get({ key: STORAGE_KEY });
  if(!value) return [];
  try { return JSON.parse(value) || []; } catch { return []; }
}
async function setSavedAccounts(list){
  const p = prefs(); if(!p) return;
  await p.set({ key: STORAGE_KEY, value: JSON.stringify(list) });
}

async function upsertAccount(session, email){
  const list = await getSavedAccounts();
  const entry = {
    email,
    refresh_token: session.refresh_token,
    access_token: session.access_token,
    last_used: Date.now(),
  };
  const idx = list.findIndex(a => a.email === email);
  if(idx >= 0) list[idx] = entry; else list.push(entry);
  await setSavedAccounts(list);
}

export async function removeAccount(email){
  const list = await getSavedAccounts();
  await setSavedAccounts(list.filter(a => a.email !== email));
}

export async function switchToAccount(email){
  const list = await getSavedAccounts();
  const entry = list.find(a => a.email === email);
  if(!entry) return;
  const { error } = await sb.auth.setSession({
    access_token: entry.access_token,
    refresh_token: entry.refresh_token,
  });
  if(error){
    await removeAccount(email);
    alert(`Could not switch to ${email} — the saved session has expired. Please log in again.`);
    location.reload();
    return;
  }
  await upsertAccount((await sb.auth.getSession()).data.session, email);
  location.reload();
}

// Called only from a fresh password login (submitLoginJob's success branch),
// never from a silently-restored session — see supabase-client.js's
// onFreshLogin/onAuthenticated split for why.
export async function maybeShowSaveAccountPrompt(session, email){
  if(!isNative() || !prefs()) return;
  const list = await getSavedAccounts();
  const already = list.some(a => a.email === email);
  if(already){
    // Not new consent — just keep the already-approved entry's token fresh,
    // since Supabase rotates refresh tokens on use and an untouched saved
    // token can otherwise go stale purely from normal logins on this device.
    await upsertAccount(session, email);
    return;
  }
  const overlay = document.getElementById('saveAccountPromptOverlay');
  if(!overlay) return;
  document.getElementById('saveAccountPromptEmail').textContent = email;
  overlay.classList.add('open');
  const close = () => overlay.classList.remove('open');
  document.getElementById('saveAccountPromptSkipBtn').onclick = close;
  document.getElementById('saveAccountPromptSaveBtn').onclick = async () => {
    await upsertAccount(session, email);
    close();
    renderMobSavedAccountsList();
  };
}

export async function renderMobSavedAccountsList(){
  const label = document.getElementById('mobSavedAccountsLabel');
  const listEl = document.getElementById('mobSavedAccountsList');
  if(!label || !listEl) return;
  if(!isNative() || !prefs()){ label.style.display = 'none'; listEl.innerHTML = ''; return; }

  const accounts = await getSavedAccounts();
  if(!accounts.length){ label.style.display = 'none'; listEl.innerHTML = ''; return; }

  label.style.display = '';
  listEl.innerHTML = accounts
    .slice()
    .sort((a, b) => b.last_used - a.last_used)
    .map(a => {
      const isCurrent = a.email === state.currentUserEmail;
      return `<div class="mob-saved-account-row" data-email="${esc(a.email)}">
        <div class="mob-saved-account-left" data-action="switch">
          <div class="mob-saved-account-avatar"></div>
          <div>
            <div class="mob-saved-account-email">${esc(a.email)}</div>
            ${isCurrent ? '<div class="mob-saved-account-badge">Current</div>' : ''}
          </div>
        </div>
        ${isCurrent ? '' : '<span class="mob-saved-account-remove" data-action="remove">✕</span>'}
      </div>`;
    }).join('');

  listEl.querySelectorAll('[data-action="switch"]').forEach(el => {
    el.onclick = () => {
      const email = el.closest('.mob-saved-account-row').dataset.email;
      if(email === state.currentUserEmail) return;
      switchToAccount(email);
    };
  });
  listEl.querySelectorAll('[data-action="remove"]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const email = el.closest('.mob-saved-account-row').dataset.email;
      await removeAccount(email);
      renderMobSavedAccountsList();
    };
  });
}
